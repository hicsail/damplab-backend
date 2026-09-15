import { Injectable, Logger } from '@nestjs/common';
import mongoose from 'mongoose';
import { AclidScreening, HomologyScreening, HomologyScreeningStatus, Job } from './job.model';
import { JobService } from './job.service';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowNodeService } from '../workflow/services/node.service';
import { DampLabServices } from '../services/damplab-services.services';
import { SecureDnaService } from '../securedna/securedna.service';
import { Region } from '../securedna/region';
import { MAX_SECUREDNA_SEQUENCE_BATCH } from '../securedna/securedna.constants';
import { AclidScreenRecord, AclidService } from '../aclid/aclid.service';
import { ACLID_MIN_SEQUENCE_LENGTH, customerStatusFromAclid, homologyStatusFromAclidRegulatory, isAclidLengthEligible, parseHomologyMode, rollupHomologyStatuses } from '../aclid/aclid-status.util';
import { getMultiValueParamIds } from '../workflow/utils/form-data.util';
import { SCREENED_FIELDS_BY_SERVICE } from './job-screening.constants';
import { getFormStringFromEntries, looksLikeNucleotideSequence, normalizeFormDataToArray, ScreeningTarget } from './job-screening.util';
import { screeningSliceName } from './job-screening-name.util';

/**
 * Homology screening for a job: find the customer-supplied sequences, send them
 * to a screening provider, record the verdict on the job.
 *
 * Two providers, selected by `BIOSECURITY_HOMOLOGY_MODE` (see
 * `parseHomologyMode`): Aclid, which also gives us the screen the customer's KYC
 * hangs off, and SecureDNA. `aclid` uses SecureDNA only as a backup, for an
 * Aclid that produced no verdict; `both` runs them independently and rolls the
 * two verdicts into one Homology row; `securedna` keeps the Homology row
 * SecureDNA's alone but still creates an Aclid screen when Aclid is keyed,
 * because KYC needs one.
 *
 * Screening runs on submission and is never awaited by the caller — a slow or
 * unreachable provider must not be able to hold up a customer's checkout. That
 * is the whole reason the job carries an IN_PROGRESS state.
 */
@Injectable()
export class JobScreeningService {
  private readonly logger = new Logger(JobScreeningService.name);

  constructor(
    private readonly jobService: JobService,
    private readonly workflowService: WorkflowService,
    private readonly workflowNodeService: WorkflowNodeService,
    private readonly dampLabServices: DampLabServices,
    private readonly secureDnaService: SecureDnaService,
    private readonly aclidService: AclidService
  ) {}

  /**
   * Every screenable sequence on a job, in workflow then node then field order.
   *
   * A field whose content does not look like DNA is skipped rather than sent —
   * see `looksLikeNucleotideSequence`.
   */
  async collectScreeningTargets(job: Job): Promise<ScreeningTarget[]> {
    const workflows = await this.workflowService.findByIds((job.workflows ?? []) as mongoose.Types.ObjectId[]);
    const targets: ScreeningTarget[] = [];

    for (const workflow of workflows) {
      const workflowId = String(workflow._id);
      const nodeIds = (workflow.nodes ?? []).map((n: unknown) => String((n as { _id?: unknown })._id ?? n));
      const nodes = await this.workflowNodeService.getByIDs(nodeIds);
      const byId = new Map(nodes.map((n) => [String(n._id), n]));

      for (const nodeId of nodeIds) {
        const node = byId.get(nodeId);
        if (!node?.service) continue;
        const service = await this.dampLabServices.findOne(String(node.service));
        if (!service) continue;

        const fields = SCREENED_FIELDS_BY_SERVICE.get(service.name);
        if (!fields) continue;

        const entries = normalizeFormDataToArray(node.formData, getMultiValueParamIds(service.parameters));
        for (const field of fields) {
          const seq = getFormStringFromEntries(entries, field);
          if (!seq || !looksLikeNucleotideSequence(seq)) continue;
          targets.push({ name: screeningSliceName(workflowId, node.id, field), seq });
        }
      }
    }

    return targets;
  }

  /**
   * Screen a job and record the outcome. Safe to call without awaiting: it
   * resolves rather than rejects, having written a terminal status either way.
   */
  async screenJob(jobId: string, userSub: string): Promise<HomologyScreening> {
    const job = await this.jobService.findById(jobId);
    if (!job) {
      this.logger.warn(`Screening skipped: job ${jobId} not found`);
      return this.record(jobId, {
        status: HomologyScreeningStatus.UNAVAILABLE,
        startedAt: new Date(),
        completedAt: new Date(),
        sequenceCount: 0,
        detail: 'Job not found'
      });
    }

    let targets: ScreeningTarget[];
    try {
      targets = await this.collectScreeningTargets(job);
    } catch (error) {
      return this.unavailable(jobId, 0, `Could not read the job's sequences: ${messageOf(error)}`);
    }

    if (targets.length === 0) {
      if (this.aclidService.isConfigured()) {
        await this.recordAclid(jobId, {
          screenId: null,
          homologyStatus: HomologyScreeningStatus.UNAVAILABLE,
          sequenceCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          detail: 'No screenable sequences'
        });
      }
      return this.record(jobId, {
        status: HomologyScreeningStatus.UNAVAILABLE,
        startedAt: new Date(),
        completedAt: new Date(),
        sequenceCount: 0,
        detail: 'No Gibson Assembly or Modular Cloning sequences on this job'
      });
    }
    if (targets.length > MAX_SECUREDNA_SEQUENCE_BATCH) {
      return this.unavailable(jobId, targets.length, `Too many sequences for one batch (max ${MAX_SECUREDNA_SEQUENCE_BATCH})`);
    }

    const startedAt = new Date();
    await this.record(jobId, { status: HomologyScreeningStatus.IN_PROGRESS, startedAt, sequenceCount: targets.length });

    const aclidConfigured = this.aclidService.isConfigured();
    const mode = parseHomologyMode(process.env.BIOSECURITY_HOMOLOGY_MODE, aclidConfigured);

    // Whenever Aclid is keyed we screen with it, whatever the mode: the screen
    // is what the customer's KYC hangs off. `parseHomologyMode` has already
    // forced `securedna` when it is not keyed.
    const aclid = aclidConfigured
      ? await this.runAclid(
          jobId,
          targets.filter((t) => isAclidLengthEligible(t.seq)),
          startedAt
        )
      : null;

    // In `aclid` mode SecureDNA backs Aclid up whenever Aclid produced no
    // verdict: it errored, it finished without a regulatory status, or it had
    // nothing long enough to screen. A real `controlled` / `not_controlled`
    // verdict is an answer, not a reason to ask a second provider.
    const secureDna = mode === 'aclid' && aclid?.outcome === 'verdict' ? null : await this.runSecureDna(jobId, userSub, targets, startedAt);

    // `securedna` mode keeps the Homology row SecureDNA's alone even though an
    // Aclid screen exists for KYC.
    const aclidLeg = mode === 'securedna' ? null : aclid;

    const statuses: HomologyScreeningStatus[] = [];
    if (aclidLeg) statuses.push(aclidLeg.homologyStatus);
    if (secureDna) statuses.push(secureDna.status);

    const details: string[] = [];
    if (aclidLeg) {
      details.push(secureDna && mode === 'aclid' ? backupLine(aclidLeg) : aclidLeg.detail);
    }
    if (secureDna?.detail) details.push(secureDna.detail);

    return this.record(jobId, {
      status: rollupHomologyStatuses(statuses),
      startedAt,
      completedAt: new Date(),
      batchId: secureDna?.batchId ?? null,
      sequenceCount: secureDna?.sequenceCount ?? aclidLeg?.sequenceCount ?? targets.length,
      detail: details.length ? details.join('; ') : null
    });
  }

  /**
   * Screen with Aclid and record `job.aclidScreening`. Returns what the Homology
   * row needs from this leg. Only `outcome: 'verdict'` means Aclid answered; the
   * other outcomes are never Passed or Failed.
   */
  private async runAclid(jobId: string, aclidTargets: ScreeningTarget[], startedAt: Date): Promise<AclidLeg> {
    if (aclidTargets.length === 0) {
      const detail = `Sequences shorter than ${ACLID_MIN_SEQUENCE_LENGTH} bp`;
      await this.recordAclid(jobId, {
        screenId: null,
        homologyStatus: HomologyScreeningStatus.UNAVAILABLE,
        sequenceCount: 0,
        startedAt,
        completedAt: new Date(),
        detail
      });
      return {
        outcome: 'no-eligible-sequences',
        homologyStatus: HomologyScreeningStatus.UNAVAILABLE,
        detail: `Aclid skipped: ${detail.toLowerCase()}`,
        error: null,
        sequenceCount: 0
      };
    }

    let screen: AclidScreenRecord;
    try {
      screen = await this.aclidService.screenInline({
        name: `damplab-job-${jobId}`,
        sequences: aclidTargets.map((t) => ({ name: t.name, sequence: t.seq }))
      });
    } catch (error) {
      const reason = messageOf(error);
      this.logger.error(`Aclid screening failed for job ${jobId}: ${reason}`);
      await this.recordAclid(jobId, {
        screenId: null,
        homologyStatus: HomologyScreeningStatus.UNAVAILABLE,
        sequenceCount: aclidTargets.length,
        startedAt,
        completedAt: new Date(),
        detail: `Aclid unavailable: ${reason}`
      });
      return {
        outcome: 'error',
        homologyStatus: HomologyScreeningStatus.UNAVAILABLE,
        detail: `Aclid unavailable: ${reason}`,
        error: reason,
        sequenceCount: aclidTargets.length
      };
    }

    const homologyStatus = homologyStatusFromAclidRegulatory(screen.regulatoryStatus);
    const verdict = screen.regulatoryStatus ?? `screen ${screen.status} without a regulatory status`;
    await this.recordAclid(jobId, {
      screenId: screen.id,
      homologyStatus,
      regulatoryStatus: screen.regulatoryStatus,
      verificationStatus: screen.verificationStatus,
      decisionStatus: screen.decisionStatus,
      verificationCompletedAt: parseTimestamp(screen.verificationCompletedAt),
      sequenceCount: aclidTargets.length,
      startedAt,
      completedAt: new Date(),
      detail: screen.regulatoryStatus ? null : `Aclid ${verdict}`
    });

    // A terminal screen can come back with no `regulatory_status` at all —
    // `failed`, `deleted` and `archived` all resolve rather than throw. That is
    // no verdict, so it wants a backup just as much as an error does.
    return {
      outcome: screen.regulatoryStatus ? 'verdict' : 'error',
      homologyStatus,
      detail: `Aclid ${verdict}`,
      error: screen.regulatoryStatus ? null : verdict,
      sequenceCount: aclidTargets.length
    };
  }

  /**
   * Screen with SecureDNA. Returns the row it would write rather than writing it,
   * so the caller can roll it up with Aclid's verdict first.
   */
  private async runSecureDna(jobId: string, userSub: string, targets: ScreeningTarget[], startedAt: Date): Promise<HomologyScreening> {
    try {
      const batch = await this.secureDnaService.screenSequences({
        sequences: targets,
        region: Region.ALL,
        providerReference: `damplab-job-${jobId}`,
        jobId,
        userId: userSub
      });

      await this.jobService.appendScreeningBatchId(jobId, new mongoose.Types.ObjectId(batch.id));

      const denied = batch.synthesisPermission !== 'granted';
      const errorCount = batch.errors.length;
      const flaggedSequences = batch.sequences.filter((s) => s.threats.length > 0).length;

      // SecureDNA errors are diagnostics about the request, not hazard hits: a
      // batch that errored did not really screen, so it is unavailable rather
      // than a failure attributable to the customer's sequence.
      if (errorCount > 0 && !denied) {
        return {
          status: HomologyScreeningStatus.UNAVAILABLE,
          startedAt,
          completedAt: new Date(),
          batchId: batch.id,
          sequenceCount: targets.length,
          detail: `SecureDNA reported ${errorCount} error(s)`
        };
      }

      return {
        status: denied ? HomologyScreeningStatus.FAILED : HomologyScreeningStatus.PASSED,
        startedAt,
        completedAt: new Date(),
        batchId: batch.id,
        sequenceCount: targets.length,
        detail: denied ? `SecureDNA denied synthesis${flaggedSequences ? ` — ${flaggedSequences} of ${targets.length} sequence(s) flagged` : ''}` : null
      };
    } catch (error) {
      this.logger.error(`Homology screening failed for job ${jobId}: ${messageOf(error)}`);
      return {
        status: HomologyScreeningStatus.UNAVAILABLE,
        startedAt,
        completedAt: new Date(),
        batchId: null,
        sequenceCount: targets.length,
        detail: messageOf(error)
      };
    }
  }

  /** Dispatch without blocking the caller. Errors are recorded, never thrown. */
  screenJobInBackground(jobId: string, userSub: string): void {
    void this.screenJob(jobId, userSub).catch((error) => {
      this.logger.error(`Unhandled screening failure for job ${jobId}: ${messageOf(error)}`);
    });
  }

  private unavailable(jobId: string, sequenceCount: number, detail: string, batchId?: string, startedAt?: Date): Promise<HomologyScreening> {
    return this.record(jobId, {
      status: HomologyScreeningStatus.UNAVAILABLE,
      startedAt: startedAt ?? new Date(),
      completedAt: new Date(),
      batchId: batchId ?? null,
      sequenceCount,
      detail
    });
  }

  private async record(jobId: string, screening: HomologyScreening): Promise<HomologyScreening> {
    await this.jobService.setHomologyScreening(jobId, screening);
    return screening;
  }

  /** `customerStatus` is stored, not resolved, so the UI reads one field. */
  private async recordAclid(jobId: string, screening: Omit<AclidScreening, 'customerStatus'>): Promise<void> {
    await this.jobService.setAclidScreening(jobId, {
      ...screening,
      customerStatus: customerStatusFromAclid({
        screenId: screening.screenId,
        decisionStatus: screening.decisionStatus,
        verificationStatus: screening.verificationStatus,
        screenHomologyStatus: screening.homologyStatus
      })
    });
  }
}

/** What the Homology row takes from the Aclid leg. Only `verdict` is an answer. */
interface AclidLeg {
  outcome: 'verdict' | 'error' | 'no-eligible-sequences';
  homologyStatus: HomologyScreeningStatus;
  detail: string;
  /** Why there is no verdict, when the reason is a failure rather than a skip. */
  error: string | null;
  sequenceCount: number;
}

/** Homology-row wording for a SecureDNA run that stood in for Aclid. */
function backupLine(aclid: AclidLeg): string {
  return aclid.outcome === 'error' ? `SecureDNA backup after Aclid error: ${aclid.error}` : 'SecureDNA (no Aclid-eligible sequences)';
}

function parseTimestamp(raw: string | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  const response = (error as { response?: { message?: string } })?.response?.message;
  return response ?? String(error);
}
