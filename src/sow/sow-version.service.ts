import { Injectable, Logger, Inject, forwardRef, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { SOW, SOWDocument, SOWStatus, SOWAdjustmentType, DocumentBlocker, SowActionGate } from './sow.model';
import { SowVersion, SowVersionDocument, SowVersionInputs, SowVersionService as SowVersionServiceLine, SowField, SowFieldKind, SowPeriod, SowConsent } from './sow-version.model';
import { adjustmentAmount, adjustmentMultiplier, buildCalculatedFields, calculateFieldValues, normalizeIncomingFields, SowDocumentContext } from './sow-field-calculator';
import { SOW_FIELD_CATALOG, findFieldDefinition } from './sow-field-defaults';
import { SOWService } from './sow.service';
import { SaveSowVersionInput } from './dto/save-sow-version.input';
import { SignSowInput } from './dto/sign-sow.input';
import { User } from '../auth/user.interface';
import { JobState } from '../job/job.model';
import { SowTextPresetService } from '../sow-preset/sow-text-preset.service';

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
    private readonly presetService: SowTextPresetService
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
    const adjustments = (inputs.adjustments ?? []).map((a) => `${a.type}:${a.description}:${Number(a.amount).toFixed(2)}`).join('|');
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
   * The newest version that still counts — what the editor opens and what the
   * transitions act on. Discarded drafts are skipped: after abandoning one, staff
   * must land back on real content rather than the draft they just threw away.
   */
  async getCurrentVersion(sowId: string): Promise<SowVersionDocument | null> {
    return this.versionModel
      .findOne({ sowId: String(sowId), isDiscarded: false })
      .sort({ versionNumber: -1 })
      .exec();
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
    return this.versionModel.findOne({ sowId: String(sowId), versionNumber }).exec();
  }

  async listVersions(sowId: string, opts: { visibleOnly?: boolean; includeDiscarded?: boolean } = {}): Promise<SowVersionDocument[]> {
    const filter: Record<string, unknown> = { sowId: String(sowId) };
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

    const created = await this.versionModel.create({
      sow: new mongoose.Types.ObjectId(sowId),
      sowId,
      versionNumber,
      fields,
      inputs,
      status,
      visibleToCustomer,
      note: opts.note,
      isDiscarded: false,
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
    changes: { status: SOWStatus; note?: string; clientSignature?: SowConsent; staffSignature?: SowConsent; sentToCustomerAt?: Date; makeActive: boolean },
    author: { sub: string; name: string }
  ): Promise<SowVersionDocument> {
    const sowId = String(sow._id);
    // Sending is the only one of these four transitions that is itself "a
    // send" — sign/finalize/cancel record an event against the version
    // already in force, so they only bump the sub-revision.
    const versionNumber = await this.nextVersionNumber(sowId, { bumpMajor: changes.status === SOWStatus.SENT });

    const created = await this.versionModel.create({
      sow: new mongoose.Types.ObjectId(sowId),
      sowId,
      versionNumber,
      fields: from.fields,
      inputs: from.inputs,
      status: changes.status,
      visibleToCustomer: changes.makeActive,
      sentToCustomerAt: changes.sentToCustomerAt ?? from.sentToCustomerAt,
      clientSignature: changes.clientSignature ?? from.clientSignature,
      staffSignature: changes.staffSignature ?? from.staffSignature,
      note: changes.note,
      isDiscarded: false,
      createdBy: author.sub,
      createdByName: author.name,
      createdAt: new Date()
    });

    const update: Record<string, unknown> = { currentVersionNumber: versionNumber, status: changes.status };
    if (changes.makeActive) update.activeVersionNumber = versionNumber;
    await this.sowModel.findByIdAndUpdate(sowId, { $set: update }).exec();

    return created;
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
    const sow = await this.requireSow(sowId);
    if (!sow.activeVersionNumber) return null;
    return this.getVersion(sowId, sow.activeVersionNumber);
  }

  /**
   * Saves staff edits as a new DRAFT.
   *
   * Never moves activeVersionNumber: a draft above a signed or finalized version
   * leaves that version in force until someone explicitly sends it, which is what
   * lets staff iterate on a signed SOW without invalidating the signature.
   */
  async saveVersion(sowId: string, input: SaveSowVersionInput, author: { sub: string; name: string }): Promise<SowVersionDocument> {
    // Called for the 404 it throws: nothing below reads the SOW itself.
    await this.requireSow(sowId);
    const current = await this.getCurrentVersion(sowId);
    const currentNumber = current?.versionNumber ?? 0;

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
      isDiscarded: false,
      note,
      createdBy: author.sub,
      createdByName: author.name,
      createdAt: new Date()
    });

    await this.sowModel.findByIdAndUpdate(sowId, { $set: { currentVersionNumber: versionNumber, documentStale: false, updatedAt: new Date() } }).exec();

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
    const sow = await this.requireSow(sowId);
    const version = await this.getVersion(sowId, versionNumber);
    if (!version) throw new NotFoundException(`Version ${versionNumber} not found`);

    if (version.visibleToCustomer || versionNumber <= (sow.activeVersionNumber ?? 0)) {
      throw new BadRequestException('Only unsent drafts above the active version can be discarded.');
    }

    // Discarding requires something to fall back to. On a SOW that has only ever
    // had one draft there is nothing behind it, and discarding would leave the
    // SOW with no document at all — no text for staff to open or customers to read.
    const survivors = await this.versionModel.countDocuments({ sowId: String(sowId), isDiscarded: false, versionNumber: { $ne: versionNumber } }).exec();
    if (survivors === 0) {
      throw new BadRequestException('This is the only version of the document, so it cannot be discarded. Edit it instead.');
    }

    await this.versionModel.updateOne({ _id: version._id }, { $set: { isDiscarded: true } }).exec();

    // Fall back to the newest surviving version so the editor reopens on real content.
    const newest = await this.versionModel.findOne({ sowId, isDiscarded: false }).sort({ versionNumber: -1 }).exec();
    const updated = await this.sowModel.findByIdAndUpdate(sowId, { $set: { currentVersionNumber: newest?.versionNumber ?? 0, status: newest?.status ?? SOWStatus.DRAFT } }, { new: true }).exec();

    if (updated) await this.refreshDocumentStale(sowId);
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
        return 'Accept this job before sending its Statement of Work — the customer needs to have agreed to the spec the prices come from.';
      case DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE:
        return 'This job changed after it was accepted. Re-accept it, then recalculate and save the document, before sending.';
      case DocumentBlocker.DOCUMENT_STALE:
        return "This document still bills the job's earlier figures. Recalculate the Fee Schedule and save before sending.";
      case DocumentBlocker.DRAFT_INCOMPLETE:
        return missingFields.length > 0 ? `Complete the following before sending to the customer: ${missingFields.join(', ')}.` : 'This SOW has no document to send.';
      case DocumentBlocker.NO_DRAFT_TO_SEND:
        return 'This version has already been issued. Edit the document to start a new draft before sending again.';
      case DocumentBlocker.UNSENT_DRAFT:
        return 'A newer draft sits above the version the customer signed. Send it and have them sign it before countersigning.';
      case DocumentBlocker.AWAITING_CUSTOMER_SIGNATURE:
        return 'The customer has not signed the version in force yet.';
      default:
        return 'This SOW cannot move to its next stage yet.';
    }
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
  async actionGate(sowId: string): Promise<SowActionGate> {
    const sow = await this.requireSow(sowId);
    const current = await this.getCurrentVersion(sowId);
    const active = await this.getActiveVersion(sowId);
    const job = await this.sowService.getJobForSow(sow);

    // Shared by both actions: the spec has to be agreed, and the document has to
    // reflect it.
    const specBlockers: DocumentBlocker[] = [];
    const accepted = (job as any)?.acceptedBillingFingerprint;
    if (!job || (job as any).state !== JobState.ACCEPTED || !accepted) {
      specBlockers.push(DocumentBlocker.NOT_ACCEPTED);
    } else if ((await this.sowService.jobBillingFingerprint(job as any)) !== accepted) {
      specBlockers.push(DocumentBlocker.JOB_CHANGED_SINCE_ACCEPTANCE);
    }
    if (sow.documentStale) specBlockers.push(DocumentBlocker.DOCUMENT_STALE);

    const missingFields = SowVersionService.missingRequiredFields(current?.fields ?? []);
    const sendBlockers = [...specBlockers];
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

    const countersignBlockers = [...specBlockers];
    if (!active || active.status !== SOWStatus.SIGNED) {
      countersignBlockers.push(DocumentBlocker.AWAITING_CUSTOMER_SIGNATURE);
    } else if (sow.currentVersionNumber > sow.activeVersionNumber) {
      // Staff have revised the document since the customer signed. Countersigning
      // now would finalize a version the lab has already moved on from.
      countersignBlockers.push(DocumentBlocker.UNSENT_DRAFT);
    }

    return {
      canSend: sendBlockers.length === 0,
      sendBlockers,
      canCountersign: countersignBlockers.length === 0,
      countersignBlockers,
      missingFields
    };
  }

  /** Issues the current draft to the customer. */
  async sendToCustomer(sowId: string, author: { sub: string; name: string }): Promise<SowVersionDocument> {
    const sow = await this.requireSow(sowId);
    const current = await this.getCurrentVersion(sowId);
    if (!current) throw new BadRequestException('This SOW has no document to send.');
    if (current.status !== SOWStatus.DRAFT) throw new BadRequestException(`Only a draft can be sent; v${current.versionNumber} is ${current.status}.`);

    // The gate the UI shows, enforced here too: the resolved field is a
    // convenience for disabling a button, never the thing that decides.
    const gate = await this.actionGate(sowId);
    if (!gate.canSend) {
      throw new BadRequestException(SowVersionService.blockerMessage(gate.sendBlockers, gate.missingFields));
    }

    const now = new Date();
    return this.appendVersion(sow, current, { status: SOWStatus.SENT, sentToCustomerAt: now, makeActive: true, note: 'Sent to customer' }, author);
  }

  /**
   * Records the customer's assent to the version in force.
   *
   * Requires the version the signer was looking at to still be the active one, so
   * a stale tab cannot sign a document that has since been superseded.
   */
  async sign(sowId: string, input: SignSowInput, user: User): Promise<SowVersionDocument> {
    const sow = await this.requireSow(sowId);
    const active = await this.getActiveVersion(sowId);
    if (!active) throw new BadRequestException('This SOW has not been sent to you yet.');

    if (active.versionNumber !== input.versionNumber) {
      throw new ConflictException(`You are viewing v${input.versionNumber} but v${active.versionNumber} is now in force. Reload to review the current version before signing.`);
    }
    if (active.status !== SOWStatus.SENT) {
      throw new BadRequestException(`v${active.versionNumber} is ${active.status} and cannot be signed.`);
    }
    if (!input.name?.trim()) throw new BadRequestException('A typed name is required to sign.');

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

    return this.appendVersion(sow, active, { status: SOWStatus.SIGNED, clientSignature: signature, makeActive: true, note: `Signed by ${signature.name}` }, { sub: user.sub, name: signature.name });
  }

  /** Staff countersignature; locks the signed version as the final record. */
  async finalize(sowId: string, name: string, author: { sub: string; name: string }): Promise<SowVersionDocument> {
    const sow = await this.requireSow(sowId);
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

    const signature: SowConsent = {
      name: name.trim(),
      signedAt: new Date(),
      consentedGroups: [SowFieldKind.CALCULATED, SowFieldKind.PROSE, SowFieldKind.CUSTOM],
      sectionInitials: [],
      bySub: author.sub
    };

    return this.appendVersion(sow, active, { status: SOWStatus.FINAL, staffSignature: signature, makeActive: true, note: `Countersigned by ${signature.name}` }, author);
  }

  async cancel(sowId: string, note: string | undefined, author: { sub: string; name: string }): Promise<SowVersionDocument> {
    const sow = await this.requireSow(sowId);
    const current = await this.getCurrentVersion(sowId);
    if (!current) throw new BadRequestException('This SOW has no document to cancel.');
    if (current.status === SOWStatus.CANCELLED) throw new BadRequestException('This SOW is already cancelled.');

    return this.appendVersion(sow, current, { status: SOWStatus.CANCELLED, makeActive: true, note: note ?? 'Cancelled' }, author);
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
