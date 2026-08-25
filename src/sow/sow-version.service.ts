import { Injectable, Logger, Inject, forwardRef, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { SOW, SOWDocument, SOWStatus, SOWAdjustmentType, DocumentBlocker, SowActionGate } from './sow.model';
import { SowVersion, SowVersionDocument, SowVersionInputs, SowVersionService as SowVersionServiceLine, SowField, SowFieldKind, SowPeriod, SowConsent } from './sow-version.model';
import { adjustmentAmount, adjustmentMultiplier, buildCalculatedFields, calculateFieldValues, normalizeIncomingFields, SowDocumentContext } from './sow-field-calculator';
import { SOW_FIELD_CATALOG, findFieldDefinition } from './sow-field-defaults';
import { SOWService } from './sow.service';
import { assertSowContractWritable } from './sow-access';
import { SaveSowVersionInput } from './dto/save-sow-version.input';
import { SignSowInput } from './dto/sign-sow.input';
import { User } from '../auth/user.interface';
import { JobState } from '../job/job.model';
import { SowTextPresetService } from '../sow-preset/sow-text-preset.service';
import { JobVersionService } from '../job-version/job-version.service';
import { ActivityService } from '../activity/activity.service';
import { CommentService } from '../comment/comment.service';
import { CommentAuthorType } from '../comment/comment.model';

/**
 * Inputs as they arrive from the editor: the same shape as SowVersionInputs but
 * with everything optional, since a preview may be requested mid-edit before all
 * controls have been touched.
 */
export type SowInputsLike = Partial<Omit<SowVersionInputs, 'services' | 'periods'>> & {
  services?: Array<{ serviceId: string; name: string; description?: string; cost: number; unitCost?: number }>;
  periods?: Array<{ startDate: Date; durationDays: number; label?: string }>;
  /** Mirrors SaveSowVersionInput: preview the refreshed figures rather than the carried-forward ones. */
  refreshFeeSchedule?: boolean;
};

/**
 * Creation, transitions and bookkeeping for immutable SOW versions.
 *
 * Every operation that changes the document appends a version; nothing is ever
 * updated in place. Which version each audience sees is decided by two pointers
 * on the parent SOW — currentVersionNumber (staff) and activeVersionNumber
 * (customer) — so staff can iterate on a draft above a signed version without
 * invalidating the signature.
 */
@Injectable()
export class SowVersionService {
  private readonly logger = new Logger(SowVersionService.name);

  constructor(
    @InjectModel(SowVersion.name) private readonly versionModel: Model<SowVersionDocument>,
    @InjectModel(SOW.name) private readonly sowModel: Model<SOWDocument>,
    @Inject(forwardRef(() => SOWService)) private readonly sowService: SOWService,
    private readonly presetService: SowTextPresetService,
    private readonly activityService: ActivityService,
    private readonly jobVersionService: JobVersionService,
    @Inject(forwardRef(() => CommentService)) private readonly commentService: CommentService
  ) {}

  /**
   * buildContext plus the prose blocks a fresh section is generated from.
   *
   * Kept separate from the static buildContext, which the migration calls with no
   * Nest container around it and which must stay synchronous.
   */
  private async contextWithPresets(sow: SOW, job?: { jobId?: string; name?: string } | null): Promise<SowDocumentContext> {
    return { ...SowVersionService.buildContext(sow, job), prosePresetText: await this.presetService.defaultTextByKey() };
  }

  /**
   * Parses the free-text duration the old flow stored ("14 days", "5 weeks") into
   * whole days. Weeks are the only non-day unit that ever appeared; anything
   * unrecognised falls back to the leading integer, then to zero.
   */
  static parseDurationDays(duration: unknown): number {
    if (typeof duration === 'number' && Number.isFinite(duration)) return Math.max(0, Math.round(duration));
    if (typeof duration !== 'string') return 0;
    const match = duration.trim().match(/^(\d+(?:\.\d+)?)\s*(\w+)?/);
    if (!match) return 0;
    const n = Number(match[1]);
    if (!Number.isFinite(n)) return 0;
    const unit = (match[2] ?? 'day').toLowerCase();
    if (unit.startsWith('week')) return Math.round(n * 7);
    if (unit.startsWith('month')) return Math.round(n * 30);
    return Math.round(n);
  }

  /**
   * The structured drivers behind a SOW's document, read off the SOW itself.
   * Used to seed version 1 and, on later saves, as the baseline the editor loads.
   *
   * SPECIAL_TERM adjustments are dropped: they contributed nothing to any total
   * (see SOWService.calculateAdjustmentsTotal), so an amount typed against one
   * silently vanished. The migration preserves their wording as a custom field.
   */
  static deriveInputs(sow: SOW, job?: { customerCategory?: string } | null): SowVersionInputs {
    const timeline = sow.timeline ?? ({} as any);
    const durationDays = SowVersionService.parseDurationDays(timeline.duration);
    const periods: SowPeriod[] = timeline.startDate ? [{ startDate: new Date(timeline.startDate), durationDays, label: undefined }] : [];

    return {
      projectManager: sow.resources?.projectManager ?? '',
      projectLead: sow.resources?.projectLead ?? '',
      periods,
      sowTitle: sow.sowTitle ?? '',
      scopeOfWork: sow.scopeOfWork ?? [],
      deliverables: sow.deliverables ?? [],
      services: (sow.services ?? []).map((s) => ({
        serviceId: String(s.serviceId ?? s._id ?? ''),
        name: s.name ?? 'Service',
        description: s.description ?? '',
        cost: Number(s.cost ?? 0),
        unitCost: s.unitCost,
        multiplier: s.multiplier,
        runCount: s.runCount
      })),
      adjustments: (sow.pricing?.adjustments ?? [])
        .filter((a) => a.type !== SOWAdjustmentType.SPECIAL_TERM)
        .map((a) => ({
          type: a.type,
          description: a.description ?? '',
          amount: Number(a.amount ?? 0),
          unitAmount: a.unitAmount,
          multiplier: a.multiplier,
          category: a.category,
          reason: a.reason
        })),
      baseCost: Number(sow.pricing?.baseCost ?? 0),
      totalCost: Number(sow.pricing?.totalCost ?? 0),
      customerCategory: job?.customerCategory
    };
  }

  /**
   * The Fee Schedule half of a version's inputs: service lines, pricing category,
   * and the totals that follow from them.
   *
   * A SOW version is a static record. Its figures therefore carry forward from
   * the previous version unchanged — a staff member fixing a typo in the prose
   * must not silently reprice the document — and move only when staff explicitly
   * refresh the Fee Schedule, which is what `refresh` means here.
   *
   * `live` is job truth (deriveInputs off the current billing core). Note the
   * client never names a figure either way: refreshing is a boolean intent, and
   * the numbers always come from the server's own derivation.
   */
  static feeScheduleInputs(
    live: SowVersionInputs,
    previous: SowVersionInputs | null | undefined,
    refresh: boolean
  ): Pick<SowVersionInputs, 'services' | 'customerCategory' | 'baseCost' | 'totalCost'> {
    // A previous version with no lines at all is a migrated or pre-versioning
    // record, not a document that genuinely bills nothing. Carrying it forward
    // would silently zero the fee schedule, so fall back to job truth.
    const canCarry = previous != null && (previous.services ?? []).length > 0;
    const source = refresh || !canCarry ? live : (previous as SowVersionInputs);
    const services = source.services ?? [];
    const baseCost = services.reduce((sum, svc) => sum + (Number(svc.cost) || 0), 0);

    // Adjustments are document-owned and always current, so the total is the
    // carried-forward base plus whatever the document says today.
    const totalCost = (live.adjustments ?? []).reduce((sum, a) => sum + (a.type === SOWAdjustmentType.DISCOUNT ? -Math.abs(Number(a.amount) || 0) : Math.abs(Number(a.amount) || 0)), baseCost);

    return { services, customerCategory: source.customerCategory, baseCost: Math.round(baseCost * 100) / 100, totalCost: Math.round(totalCost * 100) / 100 };
  }

  static buildContext(sow: SOW, job?: { jobId?: string; name?: string } | null): SowDocumentContext {
    return {
      sowNumber: sow.sowNumber,
      date: sow.date ? new Date(sow.date) : undefined,
      jobDisplayId: (job as any)?.jobId ?? sow.jobId,
      jobName: sow.jobName,
      clientName: sow.clientName,
      clientEmail: sow.clientEmail,
      clientInstitution: sow.clientInstitution,
      clientAddress: sow.clientAddress
    };
  }

  /**
   * The half of the billing core the *job* owns: service lines and the pricing
   * category. Adjustments and totals are deliberately excluded — those are
   * staff-authored on the document, and staff are free to change them without
   * re-opening the customer's agreement to the spec.
   *
   * This is what the accept-before-send gate compares: a job whose fingerprint
   * still matches the one stamped at acceptance is a job the lab has agreed to
   * as it currently stands.
   */
  static jobBillingFingerprint(services: Array<Pick<SowVersionServiceLine, 'serviceId' | 'name' | 'cost' | 'unitCost' | 'multiplier'>> | null | undefined, customerCategory?: string | null): string {
    const lines = (services ?? []).map((s) => `${s.serviceId}:${s.name}:${Number(s.cost).toFixed(2)}:${s.unitCost == null ? '' : Number(s.unitCost).toFixed(2)}:${s.multiplier ?? ''}`).join('|');
    return [lines, customerCategory ?? ''].join('#');
  }

  /**
   * What the Fee Schedule depends on. Two versions with the same fingerprint
   * would render the same figures, so a change here — and only here — means the
   * document has fallen behind the billing core.
   *
   * Delegates the job-owned half to jobBillingFingerprint so the two can never
   * drift into disagreeing about what a service line's identity is.
   */
  static billingFingerprint(inputs: Pick<SowVersionInputs, 'services' | 'adjustments' | 'baseCost' | 'totalCost' | 'customerCategory'>): string {
    const jobHalf = SowVersionService.jobBillingFingerprint(inputs.services, inputs.customerCategory);
    const adjustments = (inputs.adjustments ?? [])
      .map((a) =>
        JSON.stringify([
          a.type,
          a.description,
          a.category ?? '',
          a.reason ?? '',
          a.unitAmount == null ? '' : Number(a.unitAmount).toFixed(2),
          a.multiplier == null ? '' : Number(a.multiplier).toFixed(6),
          Number(a.amount).toFixed(2)
        ])
      )
      .join('|');
    return [jobHalf, adjustments, Number(inputs.baseCost ?? 0).toFixed(2), Number(inputs.totalCost ?? 0).toFixed(2)].join('#');
  }

  /**
   * versionNumber encodes its own "<sent-count>.<sub-revision>" display label —
   * major*MINOR_WIDTH + minor — rather than that label being a second, separately
   * computed value. One number for a version to have, not two that can drift
   * apart or fall out of sync depending on which code path produced it.
   *
   * MINOR_WIDTH is headroom, not a hard limit read back out: nothing ever divides
   * or reads a raw versionNumber except encode/decode, so there is no overflow
   * to guard against, only an assumption (at most 999 saves between sends) that
   * would need revisiting if ever seriously threatened.
   */
  private static readonly MINOR_WIDTH = 1000;

  static encodeVersionNumber(major: number, minor: number): number {
    return major * SowVersionService.MINOR_WIDTH + minor;
  }

  static decodeVersionNumber(versionNumber: number): { major: number; minor: number } {
    return { major: Math.floor(versionNumber / SowVersionService.MINOR_WIDTH), minor: versionNumber % SowVersionService.MINOR_WIDTH };
  }

  /** Human-facing "<sent-count>.<sub-revision>" label, e.g. "1.2". */
  static displayVersionLabel(versionNumber: number): string {
    const { major, minor } = SowVersionService.decodeVersionNumber(versionNumber);
    return `${major}.${minor}`;
  }

  /**
   * The accepted job version a new SOW version derives from, when there is a
   * valid one.
   *
   * Provenance only — the version number identifies the content exactly, since
   * job versions are immutable. Returns nothing when the job is not cleanly
   * accepted, in which case the document simply records no source and the job's
   * own blockers gate it.
   */
  private async validAcceptedSource(job: any): Promise<{ sourceJobVersionNumber?: number }> {
    const sourceJobVersionNumber = job?.acceptedJobVersionNumber;
    if (job?.state !== JobState.ACCEPTED || typeof sourceJobVersionNumber !== 'number') return {};

    const jobId = String(job?._id ?? job?.jobId ?? '');
    const source = await this.jobVersionService.getContentVersion(jobId, sourceJobVersionNumber);
    if (!source || !JobVersionService.isVisibleToCustomer(source)) return {};

    const latest = await this.jobVersionService.getLatestContentVersion(jobId);
    if (latest?.versionNumber !== sourceJobVersionNumber) return {};

    return { sourceJobVersionNumber };
  }

  /**
   * A version the parent pointers name, or null.
   *
   * Pure. A staged row — written, but whose pointer CAS has not been won — reads
   * as absent, which is fail-closed: a half-finished send is not a document
   * anyone should be shown. `reconcile` is what completes it.
   */
  private async readClaimedVersion(sow: SOWDocument, versionNumber: number): Promise<SowVersionDocument | null> {
    const version = await this.versionModel.findOne({ sowId: String(sow._id), versionNumber, isStaged: { $ne: true } }).exec();
    return version ?? null;
  }

  /**
   * Finishes any write that crashed between winning the parent-pointer CAS and
   * promoting its row, then delivers whatever lifecycle activity is still owed.
   *
   * Called from the mutations, and from `actionGate` for staff only. It must not
   * run on a customer read: repairing state is not something rendering a page
   * should do, and every customer-reachable field would otherwise write.
   *
   * A staged row the pointers name is one whose CAS did succeed — the pointer
   * moving is the proof — so promoting it is completing a decision already made,
   * not making a new one.
   */
  async reconcile(sowId: string): Promise<void> {
    const sow = await this.sowModel.findById(sowId).exec();
    if (!sow) return;

    for (const versionNumber of new Set([sow.currentVersionNumber, sow.activeVersionNumber])) {
      if (!versionNumber) continue;
      const staged = await this.versionModel.findOne({ sowId: String(sowId), versionNumber, isStaged: true }).exec();
      if (!staged) continue;

      const visibleToCustomer = sow.activeVersionNumber === versionNumber && staged.status !== SOWStatus.DRAFT;
      await this.versionModel.updateOne({ _id: staged._id, isStaged: true }, { $set: { isStaged: false, visibleToCustomer } }).exec();
      staged.isStaged = false;
      staged.visibleToCustomer = visibleToCustomer;
    }

    const owed = await this.versionModel.find({ sowId: String(sowId), isStaged: { $ne: true }, activityEventType: { $exists: true }, activityDeliveredAt: { $exists: false } }).exec();
    for (const version of owed) await this.deliverLifecycleActivity(version, sow);
  }

  /**
   * The newest version that still counts — what the editor opens and what the
   * transitions act on.
   */
  async getCurrentVersion(sowId: string): Promise<SowVersionDocument | null> {
    const sow = await this.sowModel.findById(sowId).exec();
    if (!sow?.currentVersionNumber) return null;
    return this.readClaimedVersion(sow, sow.currentVersionNumber);
  }

  /**
   * Next free version number, counting discarded drafts.
   *
   * A send bumps the whole number and resets the sub-revision; anything else — a
   * plain save, a signature, a countersignature, a cancellation — just bumps the
   * sub-revision. Numbers are never reused: discarding v1.3 rolls the current
   * pointer back to v1.2, but the next save must still be v1.4 — reusing 1.3
   * would collide with the discarded row on the unique {sowId, versionNumber}
   * index, and would make the history read as though the abandoned draft had
   * been edited into existence.
   *
   * The very first version of a SOW is the one exception to "minor starts at
   * 0": it starts at 1 (so "0.1", not "0.0"). currentVersionNumber and
   * activeVersionNumber use bare 0 to mean "no version yet" (see
   * getActiveVersion), and encode(0, 0) is also 0 — reusing it for a real
   * version would make the very first draft indistinguishable from "nothing
   * exists yet" everywhere that sentinel is checked.
   */
  private async nextVersionNumber(sowId: string, opts: { bumpMajor: boolean }): Promise<number> {
    const highest = await this.versionModel
      .findOne({ sowId: String(sowId) })
      .sort({ versionNumber: -1 })
      .exec();
    if (!highest) return SowVersionService.encodeVersionNumber(opts.bumpMajor ? 1 : 0, opts.bumpMajor ? 0 : 1);
    const { major, minor } = SowVersionService.decodeVersionNumber(highest.versionNumber);
    return opts.bumpMajor ? SowVersionService.encodeVersionNumber(major + 1, 0) : SowVersionService.encodeVersionNumber(major, minor + 1);
  }

  async getVersion(sowId: string, versionNumber: number): Promise<SowVersionDocument | null> {
    const sow = await this.sowModel.findById(sowId).exec();
    if (!sow) return null;
    return this.readClaimedVersion(sow, versionNumber);
  }

  async listVersions(sowId: string, opts: { visibleOnly?: boolean; includeDiscarded?: boolean } = {}): Promise<SowVersionDocument[]> {
    const filter: Record<string, unknown> = { sowId: String(sowId), isStaged: { $ne: true } };
    if (opts.visibleOnly) filter.visibleToCustomer = true;
    if (!opts.includeDiscarded) filter.isDiscarded = false;
    return this.versionModel.find(filter).sort({ versionNumber: -1 }).exec();
  }

  /**
   * Writes version 1 for a SOW that has none. Idempotent: returns the existing
   * current version if one is already present, so callers on the create path and
   * the migration can both use it without racing.
   */
  async createInitialVersion(
    sow: SOW,
    job: { customerCategory?: string; jobId?: string; name?: string } | null,
    createdBy: string,
    opts: { fields?: SowField[]; status?: SOWStatus; visibleToCustomer?: boolean; note?: string } = {}
  ): Promise<SowVersionDocument> {
    const sowId = String((sow as any)._id);
    const existing = await this.getCurrentVersion(sowId);
    if (existing) return existing;

    const inputs = SowVersionService.deriveInputs(sow, job);
    const ctx = await this.contextWithPresets(sow, job);
    const fields = opts.fields ?? buildCalculatedFields(inputs, ctx);
    const status = opts.status ?? SOWStatus.DRAFT;
    const visibleToCustomer = opts.visibleToCustomer ?? status !== SOWStatus.DRAFT;
    // A version created already issued (migration, or an opts.status override)
    // counts as its own send — same rule sendToCustomer applies going forward.
    const versionNumber = await this.nextVersionNumber(sowId, { bumpMajor: status !== SOWStatus.DRAFT });
    const source = await this.validAcceptedSource(job);

    const created = await this.versionModel.create({
      sow: new mongoose.Types.ObjectId(sowId),
      sowId,
      versionNumber,
      fields,
      inputs,
      status,
      visibleToCustomer,
      ...source,
      note: opts.note,
      isDiscarded: false,
      isStaged: false,
      createdBy,
      createdByName: createdBy,
      createdAt: new Date()
    });

    await this.sowModel
      .findByIdAndUpdate(sowId, {
        $set: {
          currentVersionNumber: versionNumber,
          activeVersionNumber: visibleToCustomer ? versionNumber : 0,
          documentStale: false
        }
      })
      .exec();

    return created;
  }

  // -------------------------------------------------------------------------
  // Transitions. Each appends a version; none mutates an existing one.
  // -------------------------------------------------------------------------

  private async requireSow(sowId: string): Promise<SOWDocument> {
    const sow = await this.sowModel.findById(sowId).exec();
    if (!sow) throw new NotFoundException(`SOW with ID ${sowId} not found`);
    return sow;
  }

  /**
   * Appends a version cloned from `from`, changing only status and the fields the
   * caller names. Used by send / sign / finalize / cancel, which record an event
   * rather than a content change — so their diff against the previous version is
   * empty and the history reads as a clean audit trail.
   */
  private async appendVersion(
    sow: SOWDocument,
    from: SowVersionDocument,
    changes: {
      status: SOWStatus;
      expectedStatus: SOWStatus;
      sourcePointer: 'currentVersionNumber' | 'activeVersionNumber';
      note?: string;
      clientSignature?: SowConsent;
      staffSignature?: SowConsent;
      sentToCustomerAt?: Date;
      makeActive: boolean;
      activityEventType?: 'SOW_SENT' | 'SOW_SIGNED' | 'SOW_FINALIZED';
    },
    author: { sub: string; name: string }
  ): Promise<SowVersionDocument> {
    const sowId = String(sow._id);
    if (sow.status !== changes.expectedStatus || sow[changes.sourcePointer] !== from.versionNumber) {
      throw new ConflictException('This SOW changed after its lifecycle gate was evaluated. Reload and try again.');
    }
    // Sending is the only one of these four transitions that is itself "a
    // send" — sign/finalize/cancel record an event against the version
    // already in force, so they only bump the sub-revision.
    const versionNumber = await this.nextVersionNumber(sowId, { bumpMajor: changes.status === SOWStatus.SENT });
    const activityOperationId = changes.activityEventType ? `${changes.activityEventType}:${sowId}:${versionNumber}` : undefined;

    let created: SowVersionDocument;
    try {
      created = await this.versionModel.create({
        sow: new mongoose.Types.ObjectId(sowId),
        sowId,
        versionNumber,
        fields: from.fields,
        inputs: from.inputs,
        status: changes.status,
        // The row remains fail-closed until the parent pointer CAS claims it.
        visibleToCustomer: false,
        sourceJobVersionNumber: from.sourceJobVersionNumber,
        sentToCustomerAt: changes.sentToCustomerAt ?? from.sentToCustomerAt,
        clientSignature: changes.clientSignature ?? from.clientSignature,
        staffSignature: changes.staffSignature ?? from.staffSignature,
        note: changes.note,
        activityEventType: changes.activityEventType,
        activityOperationId,
        // Staged, not discarded: this row is a write in flight, and is excluded
        // from every read until the parent pointer CAS below claims it.
        isStaged: true,
        isDiscarded: false,
        createdBy: author.sub,
        createdByName: author.name,
        createdAt: new Date()
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        throw new ConflictException('This SOW changed while the lifecycle transition was being recorded. Reload and try again.');
      }
      throw error;
    }

    const update: Record<string, unknown> = { currentVersionNumber: versionNumber, status: changes.status };
    if (changes.makeActive) update.activeVersionNumber = versionNumber;
    const claimed = await this.sowModel
      .findOneAndUpdate(
        {
          _id: sowId,
          currentVersionNumber: sow.currentVersionNumber,
          activeVersionNumber: sow.activeVersionNumber,
          status: changes.expectedStatus
        },
        { $set: update },
        { new: true }
      )
      .exec();
    if (!claimed) {
      // This row was never reachable through the parent pointers and was created
      // non-visible. Delete it as compensation; if deletion itself fails it
      // remains fail-closed and absent from customer-visible history.
      try {
        await this.versionModel.deleteOne({ _id: created._id, visibleToCustomer: false, isStaged: true }).exec();
      } finally {
        throw new ConflictException('This SOW changed after its lifecycle gate was evaluated. Reload and try again.');
      }
    }

    if (changes.makeActive) {
      await this.versionModel.updateOne({ _id: created._id, isStaged: true }, { $set: { visibleToCustomer: true, isStaged: false } }).exec();
      created.visibleToCustomer = true;
      created.isStaged = false;
    } else {
      await this.versionModel.updateOne({ _id: created._id, isStaged: true }, { $set: { isStaged: false } }).exec();
      created.isStaged = false;
    }

    await this.deliverLifecycleActivity(created, claimed);
    return created;
  }

  private activityMessage(version: SowVersionDocument, sow: SOW): string {
    const label = sow.sowNumber || String((sow as any)._id);
    switch (version.activityEventType) {
      case 'SOW_SENT':
        return `SOW "${label}" was sent to the customer`;
      case 'SOW_SIGNED':
        return `SOW "${label}" was signed by the customer`;
      case 'SOW_FINALIZED':
        return `SOW "${label}" was finalized`;
      default:
        return `SOW "${label}" lifecycle changed`;
    }
  }

  private async deliverLifecycleActivity(version: SowVersionDocument, sow: SOW): Promise<void> {
    if (version.isStaged || !version.activityEventType || !version.activityOperationId || version.activityDeliveredAt) return;
    try {
      await this.activityService.createEventIdempotent({
        type: version.activityEventType,
        operationId: version.activityOperationId,
        message: this.activityMessage(version, sow),
        actorDisplayName: version.createdByName,
        jobId: sow.jobId,
        sowId: version.sowId,
        sowVersionNumber: version.versionNumber
      });
      const deliveredAt = new Date();
      await this.versionModel.updateOne({ _id: version._id }, { $set: { activityDeliveredAt: deliveredAt } }).exec();
      version.activityDeliveredAt = deliveredAt;
    } catch (error: any) {
      this.logger.warn(`Activity delivery remains pending for ${version.activityOperationId}: ${error?.message ?? error}`);
    }
  }

  /**
   * Recomputes the generated text for a set of in-progress inputs, without
   * touching the database.
   *
   * Billing figures come from the stored SOW rather than the request, so a
   * preview cannot be used to display prices the billing core does not hold.
   * Returns generated values only; the editor owns everything else.
   */
  async previewCalculatedValues(sowId: string, inputs: SowInputsLike): Promise<Array<{ key: string; calculatedValue: string }>> {
    const sow = await this.requireSow(sowId);
    const job = await this.sowService.getJobForSow(sow);
    const stored = SowVersionService.deriveInputs(sow, job);
    const currentVersion = await this.getCurrentVersion(String((sow as any)._id));

    const merged: SowVersionInputs = {
      ...stored,
      projectManager: inputs.projectManager ?? stored.projectManager,
      projectLead: inputs.projectLead ?? stored.projectLead,
      periods: (inputs.periods ?? stored.periods ?? []).map((p) => ({ startDate: new Date(p.startDate), durationDays: p.durationDays, label: p.label })),
      sowTitle: inputs.sowTitle ?? stored.sowTitle,
      scopeOfWork: inputs.scopeOfWork ?? stored.scopeOfWork,
      deliverables: inputs.deliverables ?? stored.deliverables,
      // The same choice the save path makes, so the preview quotes the figures a
      // save would actually store: carried forward from the current version
      // unless staff have hit Recalculate.
      ...SowVersionService.feeScheduleInputs(stored, currentVersion?.inputs, inputs.refreshFeeSchedule === true),
      // Unsaved adjustment edits are previewed from the same derivation the save
      // path applies, so the preview quotes the figure the save would store
      // rather than whatever total the client happened to send with it.
      adjustments: (inputs.adjustments ?? stored.adjustments ?? [])
        .filter((a) => a.type !== SOWAdjustmentType.SPECIAL_TERM)
        .map((a) => ({ ...a, amount: adjustmentAmount(a), multiplier: a.unitAmount == null ? a.multiplier : adjustmentMultiplier(a) }))
    };

    merged.baseCost = (merged.services ?? []).reduce((sum, s) => sum + (Number(s.cost) || 0), 0);
    merged.totalCost = (merged.adjustments ?? []).reduce(
      (sum, a) => sum + (a.type === SOWAdjustmentType.DISCOUNT ? -Math.abs(Number(a.amount) || 0) : Math.abs(Number(a.amount) || 0)),
      merged.baseCost
    );

    const ctx = await this.contextWithPresets(sow, job);
    const values = calculateFieldValues(merged, ctx);

    // Prose sections answer with the snapshot they were generated from, not with
    // today's block — the same rule the calculator applies on save (see
    // baselineValue). Without it the editor would quietly adopt an edited block
    // on open, for every section the staff member had not overridden, and the
    // next save would stamp them all "Edited".
    const current = await this.getCurrentVersion(String((sow as any)._id));
    const previousByKey = new Map((current?.fields ?? []).map((f) => [f.key, f]));

    return Object.entries(values).map(([key, calculatedValue]) => {
      const def = findFieldDefinition(key);
      if (def?.kind !== SowFieldKind.PROSE) return { key, calculatedValue };
      return { key, calculatedValue: previousByKey.get(key)?.calculatedValue ?? calculatedValue };
    });
  }

  /** The version the customer is bound by, or null before anything is issued. */
  async getActiveVersion(sowId: string): Promise<SowVersionDocument | null> {
    const sow = await this.sowModel.findById(sowId).exec();
    if (!sow?.activeVersionNumber) return null;
    const version = await this.readClaimedVersion(sow, sow.activeVersionNumber);
    // visibleToCustomer is the gate on the version in force: this is what the
    // customer-facing activeVersion field resolves through.
    return version?.visibleToCustomer ? version : null;
  }

  /**
   * Saves staff edits as a new DRAFT.
   *
   * Never moves activeVersionNumber: a draft above a signed or finalized version
   * leaves that version in force until someone explicitly sends it, which is what
   * lets staff iterate on a signed SOW without invalidating the signature.
   */
  async saveVersion(sowId: string, input: SaveSowVersionInput, author: { sub: string; name: string }): Promise<SowVersionDocument> {
    await this.reconcile(sowId);
    const baseSow = await this.requireSow(sowId);
    const current = await this.getCurrentVersion(sowId);
    const currentNumber = current?.versionNumber ?? 0;

    // Exactly one party may hold the document. A version out for signature has
    // to be withdrawn first; a countersigned one is not editable at all.
    const activeBeforeSave = await this.getActiveVersion(sowId);
    assertSowContractWritable(activeBeforeSave?.status);

    // Editing a signed document voids the signature it carries. The customer
    // assented to specific words, so the alternative is countersigning terms
    // they never agreed to — which the gate used to catch late, at countersign
    // time, rather than here where the change actually happens.
    const voidsSignature = activeBeforeSave?.status === SOWStatus.SIGNED;

    if (input.baseVersionNumber !== currentNumber) {
      throw new ConflictException(`This SOW has moved on since you opened it (you have v${input.baseVersionNumber}, it is now v${currentNumber}). Reload to see the newer version before saving.`);
    }

    // Non-nullable in the schema already stops an omitted note; this catches the
    // whitespace-only one, which would satisfy the type and tell a reader nothing.
    const note = input.note?.trim();
    if (!note) throw new BadRequestException('Describe what you changed before saving.');

    // Adjustments first: the fee schedule text is generated from the billing
    // core, so they have to be written before the document is composed or the
    // saved text would describe the previous totals.
    //
    // Service lines are not sent — they come from the job spec via the workflow
    // sync, and `deriveInputs` below reads them back off the SOW. That is what
    // makes a plain Save the way a document catches up with a changed job.
    const hasBillingEdits = input.inputs.adjustments !== undefined;
    // Captured before the write so a lost pointer CAS below can put the billing
    // core back. Deleting the staged version row alone is not enough: the SOW's
    // figures would have moved with no version recording them, which the gate
    // then reads as a permanently stale document.
    const pricingBeforeBillingEdits = hasBillingEdits ? (baseSow.toObject?.() ?? baseSow).pricing : undefined;
    if (hasBillingEdits) {
      await this.sowService.applyDocumentBilling(sowId, {
        adjustments: (input.inputs.adjustments ?? []).map((a) => ({
          type: a.type,
          description: a.description,
          amount: a.amount,
          unitAmount: a.unitAmount,
          multiplier: a.multiplier,
          category: a.category,
          reason: a.reason
        })) as any
      });
    }

    const fresh = await this.requireSow(sowId);
    const job = await this.sowService.getJobForSow(fresh);

    // Editable inputs come from the request; billing figures are read back from
    // the SOW after the write above, so the version records what was actually
    // stored rather than what the client claimed.
    const derived = SowVersionService.deriveInputs(fresh, job);
    // Fee Schedule figures are a static record: they carry forward from the
    // previous version unless staff explicitly refreshed them. See
    // feeScheduleInputs for why this is a flag rather than figures on the wire.
    const feeSchedule = SowVersionService.feeScheduleInputs(derived, current?.inputs, input.refreshFeeSchedule === true);
    const inputs: SowVersionInputs = {
      ...derived,
      ...feeSchedule,
      projectManager: input.inputs.projectManager ?? '',
      projectManagerId: input.inputs.projectManagerId ?? undefined,
      projectLead: input.inputs.projectLead ?? '',
      projectLeadId: input.inputs.projectLeadId ?? undefined,
      periods: (input.inputs.periods ?? []).map((p) => ({ startDate: new Date(p.startDate), durationDays: p.durationDays, label: p.label })),
      sowTitle: input.inputs.sowTitle ?? '',
      scopeOfWork: input.inputs.scopeOfWork ?? [],
      deliverables: input.inputs.deliverables ?? []
    };

    const ctx = await this.contextWithPresets(fresh, job);
    const fields = normalizeIncomingFields(
      (input.fields ?? []).map((f) => ({ key: f.key, label: f.label ?? '', value: f.value ?? '', isEnabled: f.isEnabled !== false, requiresInitials: f.requiresInitials === true } as SowField)),
      inputs,
      ctx,
      current?.fields ?? []
    );
    const source = await this.validAcceptedSource(job);

    // A save is never itself a send, whatever status the version it's built on
    // was in — that's what lets staff revise a sent/signed/finalized SOW.
    const versionNumber = await this.nextVersionNumber(sowId, { bumpMajor: false });
    const created = await this.versionModel.create({
      sow: new mongoose.Types.ObjectId(sowId),
      sowId,
      versionNumber,
      fields,
      inputs,
      status: SOWStatus.DRAFT,
      visibleToCustomer: false,
      ...source,
      // Excluded from every read until its parent pointer CAS wins below.
      isStaged: true,
      isDiscarded: false,
      // A new draft never inherits a signature: it is not the document that was
      // signed. Carried explicitly rather than by omission so the intent reads.
      clientSignature: undefined,
      staffSignature: undefined,
      note,
      createdBy: author.sub,
      createdByName: author.name,
      createdAt: new Date()
    });

    const claimed = await this.sowModel
      .findOneAndUpdate(
        {
          _id: sowId,
          currentVersionNumber: baseSow.currentVersionNumber,
          activeVersionNumber: baseSow.activeVersionNumber,
          status: baseSow.status
        },
        {
          $set: {
            currentVersionNumber: versionNumber,
            status: SOWStatus.DRAFT,
            // Voiding drops the signed version out of force. The row itself is
            // immutable and stays in history as the record of what was signed;
            // only the pointer moves, so there is no longer a document the
            // customer is on the hook for.
            ...(voidsSignature ? { activeVersionNumber: 0 } : {}),
            documentStale: false,
            updatedAt: new Date()
          }
        },
        { new: true }
      )
      .exec();
    if (!claimed) {
      try {
        await this.versionModel.deleteOne({ _id: created._id, visibleToCustomer: false, isStaged: true }).exec();
        // Put the billing core back. Without this the adjustments written above
        // survive a save that never landed, leaving the document billing figures
        // no version accounts for.
        if (pricingBeforeBillingEdits !== undefined) {
          await this.sowService.restoreDocumentBilling(sowId, pricingBeforeBillingEdits);
        }
      } finally {
        throw new ConflictException('This SOW changed while your draft was being saved. Reload and try again.');
      }
    }
    await this.versionModel.updateOne({ _id: created._id, isStaged: true }, { $set: { isStaged: false } }).exec();
    created.isStaged = false;

    if (voidsSignature) {
      await this.postSowComment(
        baseSow,
        `sow-signature-voided:${sowId}:${versionNumber}`,
        // Third person throughout: this thread is read by staff and the client
        // alike, so "you" addresses the wrong reader half the time.
        'The Statement of Work the client signed has been revised by the lab, so that signature no longer applies. A new version will be issued for the client to review and sign.',
        author
      );
    }

    // Auto-assign Project Lead to unassigned workflow nodes
    const previousLeadId = current?.inputs?.projectLeadId;
    await this.sowService.autoAssignProjectLead(fresh.jobId, input.inputs.projectLeadId, input.inputs.projectLead, previousLeadId);

    return created;
  }

  /**
   * Marks an unsent draft as discarded. Drafts at or below the active pointer are
   * part of the issued record and cannot be discarded.
   */
  async discardDraft(sowId: string, versionNumber: number): Promise<SOW> {
    await this.reconcile(sowId);
    const sow = await this.requireSow(sowId);
    const version = await this.getVersion(sowId, versionNumber);
    if (!version) throw new NotFoundException(`Version ${versionNumber} not found`);

    if (version.visibleToCustomer || versionNumber <= (sow.activeVersionNumber ?? 0)) {
      throw new BadRequestException('Only unsent drafts above the active version can be discarded.');
    }

    // Discarding requires something to fall back to. On a SOW that has only ever
    // had one draft there is nothing behind it, and discarding would leave the
    // SOW with no document at all — no text for staff to open or customers to read.
    const survivors = await this.versionModel.countDocuments({ sowId: String(sowId), isDiscarded: false, isStaged: { $ne: true }, versionNumber: { $ne: versionNumber } }).exec();
    if (survivors === 0) {
      throw new BadRequestException('This is the only version of the document, so it cannot be discarded. Edit it instead.');
    }

    // Discarding the current draft has to move the pointer off it; discarding an
    // older unsent draft leaves the pointer where it is. Only the first has a
    // window worth protecting.
    let updated: SOWDocument | null;
    if (sow.currentVersionNumber === versionNumber) {
      // Fall back to the newest surviving version so the editor reopens on real content.
      const newest = await this.versionModel
        .findOne({ sowId, isDiscarded: false, isStaged: { $ne: true }, versionNumber: { $ne: versionNumber } })
        .sort({ versionNumber: -1 })
        .exec();

      // The pointer moves off the row first, and only a won CAS licenses the
      // discard. Marking the row first would mean a crash in between left a
      // discarded version still named by currentVersionNumber — a document that
      // reads as both abandoned and in force. This way the worst case is a live
      // row nobody points at, which the next save simply supersedes.
      updated = await this.sowModel
        .findOneAndUpdate({ _id: sowId, currentVersionNumber: versionNumber }, { $set: { currentVersionNumber: newest?.versionNumber ?? 0, status: newest?.status ?? SOWStatus.DRAFT } }, { new: true })
        .exec();
      if (!updated) {
        throw new ConflictException('This SOW changed while the draft was being discarded. Reload and try again.');
      }
    } else {
      updated = sow;
    }

    await this.versionModel.updateOne({ _id: version._id }, { $set: { isDiscarded: true } }).exec();

    await this.refreshDocumentStale(sowId);
    return updated as SOW;
  }

  /**
   * Fields the document cannot be sent without: hidden or empty means the
   * customer would see a blank or missing section (Engagement Resources with no
   * Project Manager or Project Lead selected, for instance).
   */
  private static missingRequiredFields(fields: SowField[]): string[] {
    const byKey = new Map(fields.map((f) => [f.key, f]));
    return SOW_FIELD_CATALOG.filter((def) => !def.allowsEmpty)
      .filter((def) => {
        const field = byKey.get(def.key);
        return !field || !field.isEnabled || !field.value?.trim();
      })
      .map((def) => def.label);
  }

  /** One sentence naming the first thing standing in the way, and how to clear it. */
  static blockerMessage(blockers: DocumentBlocker[], missingFields: string[] = []): string {
    switch (blockers[0]) {
      case DocumentBlocker.NOT_ACCEPTED:
        return 'Accept this job before continuing with its Statement of Work — the customer needs to have agreed to the spec the prices come from.';
      case DocumentBlocker.ACCEPTED_SOURCE_UNAVAILABLE:
        return 'The accepted job version is missing or was not published to the customer. Re-accept the job, save a new SOW draft, and reissue it.';
      case DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE:
        return 'This job changed after it was accepted. Re-accept it, then recalculate and save a new SOW draft before reissuing it.';
      case DocumentBlocker.DOCUMENT_STALE:
        return "This document still bills the job's earlier figures. Recalculate the Fee Schedule and save a new draft before continuing.";
      case DocumentBlocker.DRAFT_INCOMPLETE:
        return missingFields.length > 0 ? `Complete the following before sending to the customer: ${missingFields.join(', ')}.` : 'This SOW has no document to send.';
      case DocumentBlocker.NO_DRAFT_TO_SEND:
        return 'This version has already been issued. Edit the document to start a new draft before sending again.';
      case DocumentBlocker.STALE_SIGN_VERSION:
        return 'This version is no longer the one in force. Reload to review the current Statement of Work before signing.';
      case DocumentBlocker.AWAITING_SENT_VERSION:
        return 'There is no Statement of Work awaiting your signature. The lab may have withdrawn it to make changes.';
      case DocumentBlocker.AWAITING_CUSTOMER_SIGNATURE:
        return 'The customer has not signed the version in force yet.';
      default:
        return 'This SOW cannot move to its next stage yet.';
    }
  }

  /**
   * What stands between this SOW and the customer, shared by all three actions.
   *
   * "Has the job changed since it was accepted?" is a version-number comparison,
   * not a content hash: job content is versioned and immutable, so the accepted
   * version number identifies it exactly. Under the exclusive-control rule
   * nothing can change while a job is ACCEPTED anyway, so this should never
   * fire — it is kept as cheap defence-in-depth against a write path that
   * escaped the gate, which is the one failure that would otherwise be silent.
   *
   * Pricing is different and still needs a real fingerprint: a category change
   * or a catalogue edit moves the figures without touching a job version.
   */
  private static contractBlockers(args: { sow: SOW; job: any; version: SowVersionDocument | null; acceptedSource: any; latestContent: any; currentBillingFingerprint?: string }): DocumentBlocker[] {
    const { sow, job, version, acceptedSource, latestContent, currentBillingFingerprint } = args;
    const blockers: DocumentBlocker[] = [];
    const hasAcceptance = job?.state === JobState.ACCEPTED && typeof job?.acceptedJobVersionNumber === 'number' && !!job?.acceptedBillingFingerprint;

    const liveInputs = SowVersionService.deriveInputs(sow, job);
    const documentBillingStale = !!version && SowVersionService.billingFingerprint(liveInputs) !== SowVersionService.billingFingerprint(version.inputs ?? ({} as SowVersionInputs));
    const feeScheduleStale = sow.documentStale || (hasAcceptance && currentBillingFingerprint !== job.acceptedBillingFingerprint) || documentBillingStale;

    if (!hasAcceptance) {
      blockers.push(DocumentBlocker.NOT_ACCEPTED);
      if (feeScheduleStale) blockers.push(DocumentBlocker.DOCUMENT_STALE);
      return blockers;
    }

    // The accepted version still has to exist and be something the customer can
    // see — they cannot be bound by a spec that was never published to them.
    if (!acceptedSource || !JobVersionService.isVisibleToCustomer(acceptedSource) || !latestContent) {
      blockers.push(DocumentBlocker.ACCEPTED_SOURCE_UNAVAILABLE);
      if (feeScheduleStale) blockers.push(DocumentBlocker.DOCUMENT_STALE);
      return blockers;
    }

    if (latestContent.versionNumber !== job.acceptedJobVersionNumber) {
      blockers.push(DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE);
    }

    if (feeScheduleStale) blockers.push(DocumentBlocker.DOCUMENT_STALE);
    return blockers;
  }

  /**
   * Which lifecycle actions this SOW currently permits.
   *
   * One rule for the whole lifecycle: the job spec must be agreed (accepted, and
   * unchanged since) and the document must match it. Signing is not a branch —
   * a signed version is immutable, so a later job change simply runs the same
   * rule again and the customer re-signs. Countersigning adds two conditions of
   * its own, both of which say the same thing: you may only countersign the
   * exact document the customer signed, and only while it is still current.
   *
   * DOCUMENT_STALE blocks both actions rather than warning, because
   * appendVersion copies a version's fields verbatim: without it, staff could
   * issue — or finalize — prose whose Fee Schedule contradicts the figures
   * invoices bill from.
   */
  async actionGate(sowId: string, expectedSignVersionNumber?: number, opts: { reconcile?: boolean } = {}): Promise<SowActionGate> {
    // Staff-only, and off by default. This is the one read that repairs a write
    // that crashed mid-transition, and staff open the status card and editor
    // routinely — but a customer viewing their job must never write.
    if (opts.reconcile) await this.reconcile(sowId);
    const sow = await this.requireSow(sowId);
    const current = await this.getCurrentVersion(sowId);
    const active = await this.getActiveVersion(sowId);
    const job = await this.sowService.getJobForSow(sow);
    const jobId = String((job as any)?._id ?? (job as any)?.jobId ?? '');
    const acceptedSource = typeof (job as any)?.acceptedJobVersionNumber === 'number' ? await this.jobVersionService.getContentVersion(jobId, (job as any).acceptedJobVersionNumber) : null;
    const latestContent = job ? await this.jobVersionService.getLatestContentVersion(jobId) : null;
    const currentBillingFingerprint = job ? await this.sowService.jobBillingFingerprint(job as any) : undefined;
    const sharedFor = (version: SowVersionDocument | null): DocumentBlocker[] =>
      SowVersionService.contractBlockers({
        sow,
        job,
        version,
        acceptedSource,
        latestContent,
        currentBillingFingerprint
      });

    const missingFields = SowVersionService.missingRequiredFields(current?.fields ?? []);
    const sendBlockers = sharedFor(current);
    // Mutually exclusive, and in this order: no document at all, a document that
    // has already gone out, then a draft with gaps in it. The second is what
    // sendToCustomer's own `current.status !== DRAFT` check enforces — the gate
    // has to agree with it or it would promise a send the server refuses.
    if (!current) {
      sendBlockers.push(DocumentBlocker.DRAFT_INCOMPLETE);
    } else if (current.status !== SOWStatus.DRAFT) {
      sendBlockers.push(DocumentBlocker.NO_DRAFT_TO_SEND);
    } else if (missingFields.length > 0) {
      sendBlockers.push(DocumentBlocker.DRAFT_INCOMPLETE);
    }

    // The customer can sign exactly the version in force, and only while it is
    // out for signature. Staff cannot draft over it — they withdraw it first,
    // which drops it out of force and lands here as AWAITING_SENT_VERSION.
    const signBlockers = sharedFor(active);
    if (active?.status === SOWStatus.SENT && expectedSignVersionNumber != null && active.versionNumber !== expectedSignVersionNumber) {
      // They are holding a version that has been superseded — typically staff
      // withdrew it and reissued a revision while the page was open.
      signBlockers.push(DocumentBlocker.STALE_SIGN_VERSION);
    } else if (!active || active.status !== SOWStatus.SENT) {
      signBlockers.push(DocumentBlocker.AWAITING_SENT_VERSION);
    }

    // Editing a signed document now voids the signature at the moment of the
    // edit, so a draft can never sit above a signature that is still good.
    const countersignBlockers = sharedFor(active);
    if (!active || active.status !== SOWStatus.SIGNED) {
      countersignBlockers.push(DocumentBlocker.AWAITING_CUSTOMER_SIGNATURE);
    }

    return {
      canSend: sendBlockers.length === 0,
      sendBlockers,
      canSign: signBlockers.length === 0,
      signBlockers,
      canCountersign: countersignBlockers.length === 0,
      countersignBlockers,
      missingFields
    };
  }

  /**
   * Posts a SOW lifecycle note into the customer's job thread.
   *
   * SOW transitions otherwise emit activity events, which only staff read. When
   * something changes what the customer is being asked to do — a withdrawal, a
   * voided signature — it has to reach the one channel they see. Idempotent on
   * the caller's key so a retry cannot post twice.
   */
  private async postSowComment(sow: SOW, operationId: string, content: string, author: { sub: string; name: string }): Promise<void> {
    try {
      await this.commentService.createIdempotent({
        jobId: String(sow.jobId),
        operationId,
        content,
        author: author.name,
        authorType: CommentAuthorType.STAFF,
        isInternal: false
      } as any);
    } catch (error: any) {
      // The document change is what matters and it has already landed; a failed
      // note must not roll it back or fail the caller.
      this.logger.warn(`Could not post SOW comment ${operationId}: ${error?.message ?? error}`);
    }
  }

  /**
   * Takes a sent document back so staff can edit it.
   *
   * The customer stops being able to sign the moment this lands, and is told so
   * — the alternative is a document that silently refuses their signature. The
   * sent version stays in history; only the active pointer moves.
   */
  async withdrawFromCustomer(sowId: string, reason: string, author: { sub: string; name: string }): Promise<SOW> {
    await this.reconcile(sowId);
    const sow = await this.requireSow(sowId);
    const active = await this.getActiveVersion(sowId);
    if (active?.status !== SOWStatus.SENT) {
      throw new BadRequestException('Only a Statement of Work that is out for signature can be withdrawn.');
    }
    const note = reason?.trim();
    if (!note) throw new BadRequestException('Give a reason for withdrawing this Statement of Work.');

    // Hand the lab back an editable draft of what was sent, rather than leaving
    // currentVersionNumber on a SENT row that can neither be edited nor reissued.
    // Withdrawing to make a change should land staff in the editor, on the
    // content the customer saw.
    await this.appendVersion(
      sow,
      active,
      {
        status: SOWStatus.DRAFT,
        expectedStatus: SOWStatus.SENT,
        sourcePointer: 'currentVersionNumber',
        makeActive: false,
        note: 'Withdrawn from the customer'
      },
      author
    );

    // Nothing is in force with the customer any more. The sent version stays in
    // history; only the pointer moves.
    const claimed = await this.sowModel.findOneAndUpdate({ _id: sowId, activeVersionNumber: active.versionNumber }, { $set: { activeVersionNumber: 0, updatedAt: new Date() } }, { new: true }).exec();
    if (!claimed) {
      throw new ConflictException('This SOW changed while it was being withdrawn. Reload and try again.');
    }

    await this.postSowComment(
      claimed,
      `sow-withdrawn:${sowId}:${active.versionNumber}`,
      `The Statement of Work sent to the client has been withdrawn by the lab and is no longer available to sign.\n\n${note}`,
      author
    );
    return claimed;
  }

  /** Issues the current draft to the customer. */
  async sendToCustomer(sowId: string, author: { sub: string; name: string }): Promise<SowVersionDocument> {
    await this.reconcile(sowId);
    const sow = await this.requireSow(sowId);
    const expectedParent = {
      currentVersionNumber: sow.currentVersionNumber,
      activeVersionNumber: sow.activeVersionNumber,
      status: sow.status
    };
    const current = await this.getCurrentVersion(sowId);
    if (!current) throw new BadRequestException('This SOW has no document to send.');
    if (current.status !== SOWStatus.DRAFT) throw new BadRequestException(`Only a draft can be sent; v${current.versionNumber} is ${current.status}.`);

    // The gate the UI shows, enforced here too: the resolved field is a
    // convenience for disabling a button, never the thing that decides.
    const gate = await this.actionGate(sowId);
    if (!gate.canSend) {
      throw new BadRequestException(SowVersionService.blockerMessage(gate.sendBlockers, gate.missingFields));
    }

    const fresh = await this.requireSow(sowId);
    if (fresh.currentVersionNumber !== expectedParent.currentVersionNumber || fresh.activeVersionNumber !== expectedParent.activeVersionNumber || fresh.status !== expectedParent.status) {
      throw new ConflictException('This SOW changed after its send gate was evaluated. Reload and try again.');
    }
    const gatedDraft = await this.getVersion(sowId, fresh.currentVersionNumber);
    if (!gatedDraft || gatedDraft.status !== SOWStatus.DRAFT) {
      throw new ConflictException('The draft selected by the send gate is no longer current. Reload and try again.');
    }

    const now = new Date();
    return this.appendVersion(
      fresh,
      gatedDraft,
      {
        status: SOWStatus.SENT,
        expectedStatus: SOWStatus.DRAFT,
        sourcePointer: 'currentVersionNumber',
        sentToCustomerAt: now,
        makeActive: true,
        activityEventType: 'SOW_SENT',
        note: 'Sent to customer'
      },
      author
    );
  }

  /**
   * Records the customer's assent to the version in force.
   *
   * Requires the version the signer was looking at to still be the active one, so
   * a stale tab cannot sign a document that has since been superseded.
   */
  async sign(sowId: string, input: SignSowInput, user: User): Promise<SowVersionDocument> {
    await this.reconcile(sowId);
    const sow = await this.requireSow(sowId);
    const expectedParent = {
      currentVersionNumber: sow.currentVersionNumber,
      activeVersionNumber: sow.activeVersionNumber,
      status: sow.status
    };
    if (!input.name?.trim()) throw new BadRequestException('A typed name is required to sign.');

    const gate = await this.actionGate(sowId, input.versionNumber);
    if (!gate.canSign) {
      const message = SowVersionService.blockerMessage(gate.signBlockers, gate.missingFields);
      // Looking at a version that is no longer the one in force is a stale view,
      // not a bad request — the client should reload rather than correct itself.
      if (gate.signBlockers.includes(DocumentBlocker.STALE_SIGN_VERSION)) throw new ConflictException(message);
      throw new BadRequestException(message);
    }

    const fresh = await this.requireSow(sowId);
    if (fresh.currentVersionNumber !== expectedParent.currentVersionNumber || fresh.activeVersionNumber !== expectedParent.activeVersionNumber || fresh.status !== expectedParent.status) {
      throw new ConflictException('This SOW changed after its signing gate was evaluated. Reload and try again.');
    }
    const active = await this.getVersion(sowId, input.versionNumber);
    if (!active) throw new ConflictException('The sent SOW version selected by the signing gate no longer exists. Reload and try again.');

    // Every group of sections present in the document must be acknowledged, so a
    // client cannot sign while silently omitting, say, the custom sections.
    const required = new Set((active.fields ?? []).filter((f) => f.isEnabled).map((f) => f.kind));
    const consented = new Set(input.consentedGroups ?? []);
    const missing = [...required].filter((k) => !consented.has(k));
    if (missing.length > 0) {
      throw new BadRequestException(`Please confirm every section before signing. Missing: ${missing.join(', ')}.`);
    }

    // Sections staff flagged requiresInitials each need their own typed initials,
    // on top of the one overall consent checkbox.
    const initialsByKey = new Map((input.sectionInitials ?? []).map((s) => [s.key, s.initials?.trim() ?? '']));
    const enabledRequiringInitials = (active.fields ?? []).filter((f) => f.isEnabled && f.requiresInitials);
    const missingInitials = enabledRequiringInitials.filter((f) => !initialsByKey.get(f.key));
    if (missingInitials.length > 0) {
      throw new BadRequestException(`Please initial the following before signing: ${missingInitials.map((f) => f.label).join(', ')}.`);
    }
    const sectionInitials = enabledRequiringInitials.map((f) => ({ key: f.key, label: f.label, initials: initialsByKey.get(f.key) ?? '' }));

    const signature: SowConsent = {
      name: input.name.trim(),
      signedAt: new Date(),
      consentedGroups: [...consented] as SowFieldKind[],
      sectionInitials,
      bySub: user.sub
    };

    return this.appendVersion(
      fresh,
      active,
      {
        status: SOWStatus.SIGNED,
        expectedStatus: SOWStatus.SENT,
        sourcePointer: 'activeVersionNumber',
        clientSignature: signature,
        makeActive: true,
        activityEventType: 'SOW_SIGNED',
        note: `Signed by ${signature.name}`
      },
      { sub: user.sub, name: signature.name }
    );
  }

  /** Staff countersignature; locks the signed version as the final record. */
  async finalize(sowId: string, name: string, author: { sub: string; name: string }): Promise<SowVersionDocument> {
    await this.reconcile(sowId);
    const sow = await this.requireSow(sowId);
    const expectedParent = {
      currentVersionNumber: sow.currentVersionNumber,
      activeVersionNumber: sow.activeVersionNumber,
      status: sow.status
    };
    const active = await this.getActiveVersion(sowId);
    if (!active) throw new BadRequestException('This SOW has nothing to finalize.');
    if (active.status !== SOWStatus.SIGNED) throw new BadRequestException(`Only a signed SOW can be finalized; v${active.versionNumber} is ${active.status}.`);
    if (!name?.trim()) throw new BadRequestException('A name is required to countersign.');

    // A countersignature closes the agreement, so it may only land on the exact
    // document the customer signed, and only while that document still matches
    // the job. A stale figure or a draft sitting above the signed version both
    // mean the lab has moved on from what was agreed — the revision has to go
    // out and come back signed first.
    const gate = await this.actionGate(sowId);
    if (!gate.canCountersign) {
      throw new BadRequestException(SowVersionService.blockerMessage(gate.countersignBlockers, gate.missingFields));
    }

    const fresh = await this.requireSow(sowId);
    if (fresh.currentVersionNumber !== expectedParent.currentVersionNumber || fresh.activeVersionNumber !== expectedParent.activeVersionNumber || fresh.status !== expectedParent.status) {
      throw new ConflictException('This SOW changed after its finalize gate was evaluated. Reload and try again.');
    }
    const gatedSigned = await this.getVersion(sowId, fresh.activeVersionNumber);
    if (!gatedSigned || gatedSigned.status !== SOWStatus.SIGNED) {
      throw new ConflictException('The signed SOW version selected by the finalize gate is no longer active. Reload and try again.');
    }

    const signature: SowConsent = {
      name: name.trim(),
      signedAt: new Date(),
      consentedGroups: [SowFieldKind.CALCULATED, SowFieldKind.PROSE, SowFieldKind.CUSTOM],
      sectionInitials: [],
      bySub: author.sub
    };

    return this.appendVersion(
      fresh,
      gatedSigned,
      {
        status: SOWStatus.FINAL,
        expectedStatus: SOWStatus.SIGNED,
        sourcePointer: 'activeVersionNumber',
        staffSignature: signature,
        makeActive: true,
        activityEventType: 'SOW_FINALIZED',
        note: `Countersigned by ${signature.name}`
      },
      author
    );
  }

  async cancel(sowId: string, note: string | undefined, author: { sub: string; name: string }): Promise<SowVersionDocument> {
    await this.reconcile(sowId);
    const sow = await this.requireSow(sowId);
    const current = await this.getCurrentVersion(sowId);
    if (!current) throw new BadRequestException('This SOW has no document to cancel.');
    if (current.status === SOWStatus.CANCELLED) throw new BadRequestException('This SOW is already cancelled.');

    const cancelled = await this.appendVersion(
      sow,
      current,
      {
        status: SOWStatus.CANCELLED,
        expectedStatus: sow.status,
        sourcePointer: 'currentVersionNumber',
        makeActive: true,
        note: note ?? 'Cancelled'
      },
      author
    );

    // Cancelling is customer-facing — it withdraws a document they may have been
    // asked to sign — so it is announced the same way a withdrawal is.
    await this.postSowComment(
      sow,
      `sow-cancelled:${String(sow._id)}:${cancelled.versionNumber}`,
      `This Statement of Work has been cancelled by the lab and is no longer in effect.${note?.trim() ? `\n\n${note.trim()}` : ''}`,
      author
    );
    return cancelled;
  }

  /**
   * Recomputes documentStale after the billing core moves.
   *
   * Deliberately never touches a version. Rewriting the current version would
   * mutate an immutable record; auto-creating one would spam the history on every
   * workflow edit. Instead staff see a banner and decide whether to revise — so
   * adding a workflow to a job with a signed SOW leaves that SOW exactly as
   * signed.
   */
  async refreshDocumentStale(sowId: string): Promise<boolean> {
    const sow = await this.sowModel.findById(sowId).exec();
    if (!sow) return false;

    const current = await this.getCurrentVersion(String(sowId));
    if (!current) {
      // No document yet: nothing can be out of date.
      if (sow.documentStale) await this.sowModel.findByIdAndUpdate(sowId, { $set: { documentStale: false } }).exec();
      return false;
    }

    const live = SowVersionService.deriveInputs(sow, { customerCategory: current.inputs?.customerCategory });
    const stale = SowVersionService.billingFingerprint(live) !== SowVersionService.billingFingerprint(current.inputs ?? ({} as SowVersionInputs));

    if (stale !== sow.documentStale) {
      await this.sowModel.findByIdAndUpdate(sowId, { $set: { documentStale: stale } }).exec();
    }
    return stale;
  }
}
