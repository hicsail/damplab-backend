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
import { ACLID_TERMINAL_STATUSES, AclidCustomerPendingError, AclidCustomerRecord, AclidFeatureNotEnabledError, AclidScreenPendingError, AclidScreenRecord, AclidService } from '../aclid/aclid.service';
import { ACLID_MIN_SEQUENCE_LENGTH, homologyStatusFromAclidScreen, isAclidLengthEligible, jobCustomerStatusFromLeg, parseHomologyMode, rollupHomologyStatuses } from '../aclid/aclid-status.util';
import { getMultiValueParamIds } from '../workflow/utils/form-data.util';
import { WorkflowParameterFilesService } from '../workflow/services/workflow-parameter-files.service';
import { ScreeningRunPatch, ScreeningRunService } from './screening-run.service';
import { CustomerScreeningStatus, ScreeningRunAclidLeg, ScreeningRunCustomerLeg, ScreeningRunTrigger } from './screening-run.model';
import { fitAclidLeg } from './screening-run.util';
import { headerIndexesFor, readTableRecords, TABLE_FILE_MAX_BYTES, TableRecords } from '../workflow/utils/table-file';
import { TABLE_UPLOAD_KEY_PREFIX } from '../workflow/utils/table-answers';
import { fileRecord, flattenValues, hasParentSegment, isTableType, sampleSheetKeyOf } from '../workflow/utils/sample-sheet.util';
import { computeScreeningFingerprint, FlaggedAnswer, flaggedAnswerValue, screeningCustomerDetails } from './screening-fingerprint.util';
import {
  FlaggedParam,
  isScreenedParameter,
  looksLikeNucleotideSequence,
  normalizeFormDataToArray,
  normalizeSequenceString,
  ScreeningCollection,
  ScreeningTarget,
  screeningStringsFromValue
} from './job-screening.util';
import { columnSlugs, multiValueSliceName, screeningSliceName, tableCellSliceName } from './job-screening-name.util';

/**
 * Submission and resubmission start a screen in the background when this is true. It is off:
 * staff's "Run screening" / "Rerun screening" is what starts screening, and the only trigger
 * that also runs the customer leg. Pairs with BIOSECURITY_ENABLED in the UI's ClientView.tsx.
 */
export const AUTO_SCREENING_ENABLED = false;

export interface ScreenJobOptions {
  trigger?: ScreeningRunTrigger;
  /** Display name of whoever asked; null for a screen nobody asked for by name. */
  triggeredBy?: string | null;
}

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
 * While AUTO_SCREENING_ENABLED is off, staff's rerun starts screening. Screening is never
 * awaited by a customer-facing caller — a slow or unreachable provider must not be able to
 * hold up a customer's checkout. That is the whole reason the job carries an IN_PROGRESS state.
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
    private readonly aclidService: AclidService,
    private readonly files: WorkflowParameterFilesService,
    private readonly screeningRuns: ScreeningRunService
  ) {}

  /**
   * Every screenable sequence on a job, in workflow, node, then parameter order: the value of
   * each Text parameter flagged `screening: true`, and every non-empty cell of each
   * `screeningFields` column of a flagged Table's uploaded file (row by row). The flags are read
   * from the live effective parameters — set parameters included — never from the node's
   * snapshot, which predates them. A value that does not look like DNA is counted, not sent.
   */
  async collectScreeningTargets(job: Job): Promise<ScreeningCollection> {
    const collection: ScreeningCollection = { targets: [], skippedCount: 0, notes: [] };
    const push = (name: string, seq: string, label: string): void => {
      if (!looksLikeNucleotideSequence(seq)) {
        collection.skippedCount++;
        return;
      }
      collection.targets.push({ name, seq, label });
    };

    for await (const { workflowId, nodeId, service, param, value } of this.flaggedParameters(job)) {
      const paramName = typeof param.name === 'string' && param.name.trim() !== '' ? param.name.trim() : param.id;
      const paramLabel = `${service.name} › ${paramName}`;
      if (param.type === 'string') {
        const values = screeningStringsFromValue(value);
        const multi = param.allowMultipleValues === true;
        values.forEach((seq, i) =>
          push(multi ? multiValueSliceName(workflowId, nodeId, param.id, i + 1) : screeningSliceName(workflowId, nodeId, param.id), seq, multi ? `${paramLabel} › value ${i + 1}` : paramLabel)
        );
      } else if (isTableType(param.type)) {
        await this.collectTableTargets(collection, push, { workflowId, nodeId, param, paramLabel, value });
      }
    }
    return collection;
  }

  /**
   * Every parameter flagged `screening: true` on a job, with the stored answer to it (undefined
   * when none), in workflow, node, then parameter order. Shared by target collection and the
   * fingerprint so both agree on what is flagged. Reads live effective parameters, never the
   * node's snapshot.
   */
  private async *flaggedParameters(job: Job): AsyncGenerator<{ workflowId: string; nodeId: string; service: { name: string }; param: FlaggedParam; value: unknown }> {
    const workflows = await this.workflowService.findByIds((job.workflows ?? []) as mongoose.Types.ObjectId[]);
    for (const workflow of workflows) {
      const workflowId = String(workflow._id);
      const nodeIds = (workflow.nodes ?? []).map((n: unknown) => String((n as { _id?: unknown })._id ?? n));
      const nodes = await this.workflowNodeService.getByIDs(nodeIds);
      const byId = new Map(nodes.map((n) => [String(n._id), n]));

      for (const id of nodeIds) {
        const node = byId.get(id);
        if (!node?.service) continue;
        const service = await this.dampLabServices.findOne(String(node.service));
        if (!service) continue;
        const parameters: unknown[] = Array.isArray(service.parameters) ? service.parameters : [];
        const entries = normalizeFormDataToArray(node.formData, getMultiValueParamIds(parameters));

        for (const param of parameters) {
          if (!isScreenedParameter(param)) continue;
          yield { workflowId, nodeId: node.id, service, param, value: entries.find((entry) => entry.id === param.id)?.value };
        }
      }
    }
  }

  /**
   * A fingerprint of what a screen would cover: every flagged answer that has a value, and the
   * customer details sent to Aclid. A table is fingerprinted by file key and name, never read.
   * A thrown read propagates; callers decide.
   */
  async screeningFingerprint(job: Job): Promise<string> {
    const answers: FlaggedAnswer[] = [];
    for await (const { nodeId, param, value } of this.flaggedParameters(job)) {
      const values = flaggedAnswerValue(param.type, value);
      if (values.length > 0) answers.push({ nodeId, paramId: param.id, values });
    }
    return computeScreeningFingerprint(answers, screeningCustomerDetails(job));
  }

  /**
   * A flagged Table's uploaded file(s). Reads only keys under `workflow-parameters/` with no
   * `..` segment — the guard `countNewTableAnswers` applies — because `readObject` reads
   * whatever it is given. A file that is not uploaded or cannot be read, and a screening column
   * the file lacks, are noted on the run and do not fail it (behaviour 2).
   */
  private async collectTableTargets(
    collection: ScreeningCollection,
    push: (name: string, seq: string, label: string) => void,
    args: { workflowId: string; nodeId: string; param: { id: string; screeningFields?: unknown }; paramLabel: string; value: unknown }
  ): Promise<void> {
    const fields = Array.isArray(args.param.screeningFields) ? args.param.screeningFields.filter((f): f is string => typeof f === 'string' && f.trim() !== '') : [];
    const files = flattenValues(args.value).filter((v) => v !== null && v !== undefined && v !== '');
    for (let f = 0; f < files.length; f++) {
      const record = fileRecord(files[f]);
      const filename = typeof record?.filename === 'string' && record.filename !== '' ? record.filename : 'the uploaded file';
      const fieldId = files.length > 1 ? `${args.param.id}_f${f + 1}` : args.param.id;
      const label = files.length > 1 ? `${args.paramLabel} › file ${f + 1}` : args.paramLabel;
      const key = sampleSheetKeyOf(files[f]);
      if (!key || !key.startsWith(TABLE_UPLOAD_KEY_PREFIX) || hasParentSegment(key)) {
        collection.notes.push(`${label}: ${filename} was not uploaded, so it was not screened`);
        continue;
      }
      let table: TableRecords;
      try {
        table = await readTableRecords(await this.files.readObject(key, TABLE_FILE_MAX_BYTES));
      } catch (error) {
        collection.notes.push(`${label}: could not read ${filename} (${messageOf(error)})`);
        continue;
      }
      // Every column whose header matches a screening field, once each, in column order: two columns
      // may share a header (exactly or by case) and a sequence in either must be screened.
      const matched = new Set<number>();
      for (const field of fields) {
        const indexes = headerIndexesFor(table.header, field);
        if (indexes.length === 0) collection.notes.push(`${label}: ${filename} has no column “${field}”`);
        else indexes.forEach((index) => matched.add(index));
      }
      const present = [...matched].sort((a, b) => a - b);
      const slugs = columnSlugs(present.map((index) => table.header[index]));
      table.grid.forEach((row, rowIndex) => {
        present.forEach((index, c) => {
          const cell = (row[index] ?? '').trim();
          if (cell !== '') push(tableCellSliceName(args.workflowId, args.nodeId, fieldId, rowIndex + 1, slugs[c]), cell, `${label} › row ${rowIndex + 1} › ${table.header[index]}`);
        });
      });
    }
  }

  /**
   * Screen a job and record the outcome. Safe to call without awaiting: it resolves rather
   * than rejects, having written a terminal status either way. Writes exactly one screening
   * run once the job is found (behaviour 6); the job's own rows are written exactly as before
   * (behaviour 7). Run writes are best-effort and never change the outcome.
   */
  async screenJob(jobId: string, userSub: string, options: ScreenJobOptions = {}): Promise<HomologyScreening> {
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

    // Taken before anything else so a value edited mid-run reads STALE. A fingerprint that cannot
    // be read is stored as null and screening goes on.
    let fingerprint: string | null = null;
    try {
      fingerprint = await this.screeningFingerprint(job);
    } catch (error) {
      this.logger.error(`Could not fingerprint job ${jobId} for its screening run: ${messageOf(error)}`);
    }
    const runId = await this.openRun(jobId, options, fingerprint);
    try {
      return await this.screenWithRun(job, jobId, userSub, runId, options);
    } catch (error) {
      // A job-row write (or anything else) threw: the run must not stay In Progress forever.
      // Close it, then rethrow so the caller sees exactly what it saw before runs existed.
      await this.closeRun(runId, { status: HomologyScreeningStatus.UNAVAILABLE, detail: messageOf(error), unscreenedNotes: [messageOf(error)] });
      throw error;
    }
  }

  /** Everything `screenJob` does once the run is open. A throw here is closed by the caller. */
  private async screenWithRun(job: Job, jobId: string, userSub: string, runId: string | null, options: ScreenJobOptions): Promise<HomologyScreening> {
    let collection: ScreeningCollection;
    try {
      collection = await this.collectScreeningTargets(job);
    } catch (error) {
      const recorded = await this.unavailable(jobId, 0, `Could not read the job's sequences: ${messageOf(error)}`);
      await this.finishRun(job, jobId, runId, options, null, { status: recorded.status, detail: recorded.detail ?? null, unscreenedNotes: [recorded.detail ?? ''], sequenceCount: 0 });
      return recorded;
    }
    const { targets } = collection;
    await this.updateRun(runId, {
      sequences: targets.map((t) => ({ name: t.name, label: t.label, length: normalizeSequenceString(t.seq).length, aclidEligible: isAclidLengthEligible(t.seq) })),
      sequenceCount: targets.length,
      skippedCount: collection.skippedCount
    });

    if (targets.length === 0) {
      let aclidRun: ScreeningRunAclidLeg | null = null;
      if (this.aclidService.isConfigured()) {
        await this.recordAclid(jobId, {
          screenId: null,
          homologyStatus: HomologyScreeningStatus.UNAVAILABLE,
          sequenceCount: 0,
          startedAt: new Date(),
          completedAt: new Date(),
          detail: 'No screenable sequences'
        });
        aclidRun = { screenId: null, homologyStatus: HomologyScreeningStatus.UNAVAILABLE, detail: 'No screenable sequences' };
      }
      const recorded = await this.record(jobId, {
        status: HomologyScreeningStatus.UNAVAILABLE,
        startedAt: new Date(),
        completedAt: new Date(),
        sequenceCount: 0,
        detail: 'No screenable DNA sequences on this job'
      });
      await this.finishRun(job, jobId, runId, options, null, {
        status: recorded.status,
        detail: runDetail(recorded.detail, collection),
        aclid: aclidRun,
        unscreenedNotes: collection.notes,
        sequenceCount: 0
      });
      return recorded;
    }
    if (targets.length > MAX_SECUREDNA_SEQUENCE_BATCH) {
      const recorded = await this.unavailable(jobId, targets.length, `Too many sequences for one batch (max ${MAX_SECUREDNA_SEQUENCE_BATCH})`);
      await this.finishRun(job, jobId, runId, options, null, {
        status: recorded.status,
        detail: runDetail(recorded.detail, collection),
        unscreenedNotes: collection.notes,
        sequenceCount: targets.length
      });
      return recorded;
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

    // In `aclid` mode SecureDNA backs Aclid up only when Aclid produced no
    // verdict: the call errored, the screen failed or was removed without a
    // regulatory status, or nothing was long enough to screen. A succeeded
    // screen is a pass even when `regulatory_status` is empty — that is a
    // clear result, not a reason to ask SecureDNA.
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

    const recorded = await this.record(jobId, {
      status: rollupHomologyStatuses(statuses),
      startedAt,
      completedAt: new Date(),
      batchId: secureDna?.batchId ?? null,
      sequenceCount: secureDna?.sequenceCount ?? aclidLeg?.sequenceCount ?? targets.length,
      detail: details.length ? details.join('; ') : null
    });
    await this.finishRun(job, jobId, runId, options, aclid?.run.screenId ?? null, {
      status: recorded.status,
      detail: runDetail(recorded.detail, collection),
      unscreenedNotes: collection.notes,
      sequenceCount: targets.length,
      // The run keeps Aclid's leg whenever Aclid screened, even in `securedna` mode where the
      // Homology row ignores it: the screen exists, and KYC hangs off it.
      aclid: aclid ? fitAclidLeg(aclid.run) : null,
      secureDna: secureDna ? { batchId: secureDna.batchId ?? null, status: secureDna.status, detail: secureDna.detail ?? null } : null
    });
    return recorded;
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
        sequenceCount: 0,
        run: { screenId: null, homologyStatus: HomologyScreeningStatus.UNAVAILABLE, detail }
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

      // A screen we created but stopped watching is still a screen. Record its
      // id and call the record In Progress, so KYC can start and a later
      // refresh can finish the verdict; throwing the id away strands both.
      const pending = error instanceof AclidScreenPendingError ? error.screen : null;
      const detail = pending ? 'Aclid screen still running' : `Aclid unavailable: ${reason}`;
      await this.recordAclid(jobId, {
        screenId: pending?.id ?? null,
        homologyStatus: pending ? HomologyScreeningStatus.IN_PROGRESS : HomologyScreeningStatus.UNAVAILABLE,
        regulatoryStatus: pending?.regulatoryStatus ?? null,
        verificationStatus: pending?.verificationStatus ?? null,
        decisionStatus: pending?.decisionStatus ?? null,
        verificationCompletedAt: parseTimestamp(pending?.verificationCompletedAt ?? null),
        sequenceCount: aclidTargets.length,
        startedAt,
        completedAt: pending ? null : new Date(),
        detail
      });
      return {
        // The Homology row takes UNAVAILABLE either way: a screen that has not
        // answered yet contributes no verdict, and a row left In Progress by
        // this leg would have nothing to complete it.
        outcome: 'error',
        homologyStatus: HomologyScreeningStatus.UNAVAILABLE,
        detail,
        error: reason,
        sequenceCount: aclidTargets.length,
        run: {
          screenId: pending?.id ?? null,
          homologyStatus: pending ? HomologyScreeningStatus.IN_PROGRESS : HomologyScreeningStatus.UNAVAILABLE,
          status: pending?.status ?? null,
          regulatoryStatus: pending?.regulatoryStatus ?? null,
          verificationStatus: pending?.verificationStatus ?? null,
          decisionStatus: pending?.decisionStatus ?? null,
          raw: pending?.raw ?? null,
          detail
        }
      };
    }

    const homologyStatus = homologyStatusFromAclidScreen(screen);

    // `failed`, `deleted`, and `archived` can resolve with no regulatory
    // status, and a status we do not recognise is not an answer either. Those
    // still want the SecureDNA backup. A succeeded screen does not.
    const answered = homologyStatus !== HomologyScreeningStatus.UNAVAILABLE;
    const reason = screen.regulatoryStatus ? `screen ${screen.status} reported ${screen.regulatoryStatus}` : `screen ${screen.status} without a regulatory status`;
    const verdictLine = answered ? (screen.regulatoryStatus ? `Aclid ${screen.regulatoryStatus}` : 'Aclid passed') : `Aclid ${reason}`;

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
      detail: answered ? null : verdictLine
    });

    const { details, error: detailsError } = await this.aclidDetails(screen);

    return {
      outcome: answered ? 'verdict' : 'error',
      homologyStatus,
      detail: verdictLine,
      error: answered ? null : reason,
      sequenceCount: aclidTargets.length,
      run: {
        ...aclidLegFields(screen, homologyStatus),
        details,
        detail: [answered ? null : verdictLine, detailsError].filter((part): part is string => !!part).join('; ') || null
      }
    };
  }

  /**
   * Screen with SecureDNA. Returns the row it would write rather than writing it,
   * so the caller can roll it up with Aclid's verdict first.
   */
  private async runSecureDna(jobId: string, userSub: string, targets: ScreeningTarget[], startedAt: Date): Promise<HomologyScreening> {
    try {
      const batch = await this.secureDnaService.screenSequences({
        sequences: targets.map(({ name, seq }) => ({ name, seq })),
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

  /**
   * Aclid's per-sequence details for a screen that succeeded. Null while Aclid answers 204 —
   * the next refresh tries again. A failed call keeps the verdict and says why (behaviour 13).
   */
  private async aclidDetails(screen: AclidScreenRecord): Promise<{ details: Record<string, unknown> | null; error: string | null }> {
    if (screen.status !== 'succeeded') return { details: null, error: null };
    try {
      return { details: await this.aclidService.getScreenDetails(screen.id), error: null };
    } catch (error) {
      return { details: null, error: `Aclid details unavailable: ${messageOf(error)}` };
    }
  }

  /**
   * `refreshJobAclidScreening` read the job's screen again: bring the run that sent it up to
   * date — the verdict fields, the raw report, and the details once the screen has succeeded
   * and the run has none yet. Updates that run, never a new one; a screen no run carries (a
   * job screened before runs existed) is left alone. Best-effort, like every run write.
   */
  async recordAclidRefresh(screen: AclidScreenRecord): Promise<void> {
    try {
      const run = await this.screeningRuns.findByAclidScreenId(screen.id);
      if (!run) return;
      const homologyStatus = homologyStatusFromAclidScreen(screen);
      // A screen that has not finished is still running, not "without a regulatory status".
      const running = homologyStatus === HomologyScreeningStatus.UNAVAILABLE && !ACLID_TERMINAL_STATUSES.has(String(screen.status));
      const leg: Partial<ScreeningRunAclidLeg> = {
        ...aclidLegFields(screen, running ? HomologyScreeningStatus.IN_PROGRESS : homologyStatus),
        detail: running ? 'Aclid screen still running' : homologyStatus === HomologyScreeningStatus.UNAVAILABLE ? `Aclid screen ${screen.status} without a regulatory status` : null
      };
      const fitted = fitAclidLeg({ ...(run.aclid ?? {}), ...leg } as ScreeningRunAclidLeg);
      const write: Partial<ScreeningRunAclidLeg> = { ...leg, raw: fitted.raw, detail: fitted.detail };
      // Only a new FAILED lowers the run. A slow screen that now passes lifts a run that was only
      // waiting on it, and never one SecureDNA failed or one SecureDNA alone decides.
      const lift =
        homologyStatus === HomologyScreeningStatus.PASSED &&
        run.status === HomologyScreeningStatus.UNAVAILABLE &&
        run.aclid?.homologyStatus === HomologyScreeningStatus.IN_PROGRESS &&
        run.secureDna?.status !== HomologyScreeningStatus.FAILED &&
        parseHomologyMode(process.env.BIOSECURITY_HOMOLOGY_MODE, this.aclidService.isConfigured()) !== 'securedna';
      const patch: ScreeningRunPatch = homologyStatus === HomologyScreeningStatus.FAILED ? { status: HomologyScreeningStatus.FAILED } : lift ? { status: HomologyScreeningStatus.PASSED } : {};
      const runId = String((run as { _id?: unknown })._id);
      await this.screeningRuns.updateAclidLeg(runId, write, patch);
      // The details call can take 30 s; the verdict is already written, so it runs behind the caller.
      if (screen.status === 'succeeded' && !run.aclid?.details) void this.backfillAclidDetails(runId, screen, { ...(run.aclid ?? {}), ...write } as ScreeningRunAclidLeg);
    } catch (error) {
      this.logger.error(`Could not update the screening run for Aclid screen ${screen.id}: ${messageOf(error)}`);
    }
  }

  /**
   * Re-read the newest run's customer leg from Aclid, so a review resolved there clears without a
   * new screen. Never starts a screen and never throws. A failed read keeps the stored status and
   * writes only `detail`: an API error, or Aclid switching the check off, must not unblock a leg
   * that was NEEDS_REVIEW. Resolves the job's `customerStatus` for the leg as stored afterwards.
   */
  async refreshCustomerLeg(jobId: string): Promise<HomologyScreeningStatus> {
    try {
      const run = await this.screeningRuns.findNewestForJob(jobId);
      const stored = run?.customer;
      if (!run || !stored) return HomologyScreeningStatus.UNAVAILABLE;
      const runId = String((run as { _id?: unknown })._id);
      if (!stored.requesterId) return jobCustomerStatusFromLeg(stored.status);
      try {
        const leg = customerLegFromRecord(await this.aclidService.getCustomer(stored.requesterId));
        await this.screeningRuns.updateCustomerLeg(runId, leg);
        return jobCustomerStatusFromLeg(leg.status);
      } catch (error) {
        const detail = messageOf(error);
        if (!(error instanceof AclidFeatureNotEnabledError)) this.logger.error(`Could not re-read Aclid customer ${stored.requesterId} for job ${jobId}: ${detail}`);
        await this.screeningRuns.updateCustomerLeg(runId, { detail });
        return jobCustomerStatusFromLeg(stored.status);
      }
    } catch (error) {
      this.logger.error(`Could not refresh the customer leg for job ${jobId}: ${messageOf(error)}`);
      return HomologyScreeningStatus.UNAVAILABLE;
    }
  }

  /** Fetch and store a succeeded screen's details after the verdict write. Never rejects. */
  private async backfillAclidDetails(runId: string, screen: AclidScreenRecord, written: ScreeningRunAclidLeg): Promise<void> {
    try {
      const { details, error } = await this.aclidDetails(screen);
      const base = written.detail ?? null;
      const fitted = fitAclidLeg({ ...written, details, detail: error ? (base ? `${base}; ${error}` : error) : base });
      await this.screeningRuns.updateAclidLeg(runId, { details: fitted.details, raw: fitted.raw, detail: fitted.detail });
    } catch (error) {
      this.logger.error(`Could not store Aclid details for screen ${screen.id}: ${messageOf(error)}`);
    }
  }

  private async openRun(jobId: string, options: ScreenJobOptions, fingerprint: string | null): Promise<string | null> {
    try {
      return await this.screeningRuns.create({
        jobId,
        trigger: options.trigger ?? ScreeningRunTrigger.SUBMISSION,
        triggeredBy: options.triggeredBy ?? null,
        status: HomologyScreeningStatus.IN_PROGRESS,
        startedAt: new Date(),
        sequenceCount: 0,
        skippedCount: 0,
        sequences: [],
        fingerprint
      });
    } catch (error) {
      this.logger.error(`Could not open a screening run for job ${jobId}: ${messageOf(error)}`);
      return null;
    }
  }

  private async updateRun(runId: string | null, patch: ScreeningRunPatch): Promise<void> {
    if (!runId) return;
    try {
      await this.screeningRuns.update(runId, patch);
    } catch (error) {
      this.logger.error(`Could not update screening run ${runId}: ${messageOf(error)}`);
    }
  }

  /**
   * Close a run. On a staff rerun the customer leg runs first, so the run completes only once it
   * has settled; a customer-triggered screen never posts a customer and stores no leg.
   */
  private async finishRun(job: Job, jobId: string, runId: string | null, options: ScreenJobOptions, screenId: string | null, patch: ScreeningRunPatch): Promise<void> {
    const customer = options.trigger === ScreeningRunTrigger.RERUN ? await this.runCustomerLeg(job, jobId, screenId) : null;
    await this.closeRun(runId, { ...patch, customer });
  }

  /** Post the customer to Aclid against this run's screen and keep the job's `customerStatus` in step. */
  private async runCustomerLeg(job: Job, jobId: string, screenId: string | null): Promise<ScreeningRunCustomerLeg> {
    const leg = screenId ? await this.screenCustomer(job, screenId) : customerLeg(CustomerScreeningStatus.NOT_RUN);
    await this.jobService.setAclidCustomerStatus(jobId, jobCustomerStatusFromLeg(leg.status));
    return leg;
  }

  /** Never throws: every failure becomes a leg status. */
  private async screenCustomer(job: Job, screenId: string): Promise<ScreeningRunCustomerLeg> {
    let requesterId: string | null = null;
    try {
      const { name, company, email } = screeningCustomerDetails(job);
      requesterId = (await this.aclidService.createCustomer({ name, company, email, screenId })).requesterId;
      return customerLegFromRecord(await this.aclidService.pollCustomer(requesterId));
    } catch (error) {
      if (error instanceof AclidCustomerPendingError) return { ...customerLegFromRecord(error.customer), status: CustomerScreeningStatus.IN_PROGRESS };
      if (error instanceof AclidFeatureNotEnabledError) return customerLeg(CustomerScreeningStatus.NOT_AVAILABLE, { requesterId, detail: CUSTOMER_NOT_ENABLED_DETAIL });
      this.logger.error(`Aclid customer screening failed for job ${String(job._id)}: ${messageOf(error)}`);
      return customerLeg(CustomerScreeningStatus.UNAVAILABLE, { requesterId, detail: messageOf(error) });
    }
  }

  private closeRun(runId: string | null, patch: ScreeningRunPatch): Promise<void> {
    return this.updateRun(runId, { ...patch, completedAt: new Date() });
  }

  /** Dispatch without blocking the caller. Errors are recorded, never thrown. */
  screenJobInBackground(jobId: string, userSub: string): void {
    if (!AUTO_SCREENING_ENABLED) return;
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
      // Until the customer leg writes it (a staff rerun only).
      customerStatus: HomologyScreeningStatus.UNAVAILABLE
    });
  }
}

const CUSTOMER_NOT_ENABLED_DETAIL = 'Customer screening is not enabled for this Aclid account';

/** A customer leg with every field present, so the stored shape is uniform. */
function customerLeg(status: CustomerScreeningStatus, fields: Partial<ScreeningRunCustomerLeg> = {}): ScreeningRunCustomerLeg {
  return { status, requesterId: null, verdict: null, decisionStatus: null, checks: null, counts: null, raw: null, detail: null, ...fields };
}

function customerLegFromRecord(record: AclidCustomerRecord): ScreeningRunCustomerLeg {
  return customerLeg(record.status, {
    requesterId: record.requesterId,
    verdict: record.verdict,
    decisionStatus: record.decisionStatus,
    checks: record.checks as unknown as ScreeningRunCustomerLeg['checks'],
    counts: record.counts,
    raw: record.raw
  });
}

/** What the Homology row takes from the Aclid leg. Only `verdict` is an answer. */
interface AclidLeg {
  outcome: 'verdict' | 'error' | 'no-eligible-sequences';
  homologyStatus: HomologyScreeningStatus;
  detail: string;
  /** Why there is no verdict, when the reason is a failure rather than a skip. */
  error: string | null;
  sequenceCount: number;
  /** What the screening run stores for this leg. */
  run: ScreeningRunAclidLeg;
}

/** Homology-row wording for a SecureDNA run that stood in for Aclid. */
function backupLine(aclid: AclidLeg): string {
  return aclid.outcome === 'error' ? `SecureDNA backup after Aclid error: ${aclid.error}` : 'SecureDNA (no Aclid-eligible sequences)';
}

/** The verdict fields of an Aclid leg, from a screen record. */
function aclidLegFields(screen: AclidScreenRecord, homologyStatus: HomologyScreeningStatus): ScreeningRunAclidLeg {
  return {
    screenId: screen.id,
    homologyStatus,
    status: screen.status,
    regulatoryStatus: screen.regulatoryStatus,
    verificationStatus: screen.verificationStatus,
    decisionStatus: screen.decisionStatus,
    matchCount: screen.matchCount ?? null,
    materialCount: screen.materialCount ?? null,
    findings: screen.findings,
    materialSummary: screen.materialSummary ?? null,
    raw: screen.raw ?? null
  };
}

/** A run's detail line: the job row's detail, then what collection skipped or could not read. */
function runDetail(recorded: string | null | undefined, collection: ScreeningCollection): string | null {
  const parts = [recorded ?? null, collection.skippedCount ? `${collection.skippedCount} value${collection.skippedCount === 1 ? '' : 's'} skipped: not DNA` : null, ...collection.notes];
  const line = parts.filter((part): part is string => !!part).join('; ');
  return line || null;
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
