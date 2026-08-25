import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SOW, SOWDocument, SOWStatus } from './sow.model';
import { CreateSOWInput } from './dto/create-sow.input';
import { UpdateSOWInput } from './dto/update-sow.input';
import { JobService } from '../job/job.service';
import { Job } from '../job/job.model';
import { DampLabServices } from '../services/damplab-services.services';
import { calculateServiceCostBreakdown, extractRunCount, CustomerCategory } from '../pricing/service-pricing.util';
import { SowVersionService } from './sow-version.service';
import { labCalendarDay, adjustmentAmount, adjustmentMultiplier } from './sow-field-calculator';
import { WorkflowService } from '../workflow/workflow.service';
import { WorkflowNodeService } from '../workflow/services/node.service';

@Injectable()
export class SOWService {
  private readonly logger = new Logger(SOWService.name);

  constructor(
    @InjectModel(SOW.name) private readonly sowModel: Model<SOWDocument>,
    private readonly dampLabServices: DampLabServices,
    @Inject(forwardRef(() => JobService))
    private readonly jobService: JobService,
    // Circular by design: SOWService creates version 1, and SowVersionService
    // writes billing changes back through SOWService. Both sides need forwardRef.
    @Inject(forwardRef(() => SowVersionService))
    private readonly sowVersionService: SowVersionService,
    @Inject(forwardRef(() => WorkflowService))
    private readonly workflowService: WorkflowService,
    @Inject(forwardRef(() => WorkflowNodeService))
    private readonly workflowNodeService: WorkflowNodeService
  ) {}

  /**
   * Server-assigned SOW number for a new SOW. Clients must not supply sowNumber.
   * Prefer `SOW <5-digit job display id>` when the job has one and it is unused; otherwise global sequence.
   */
  private async resolveSowNumberForNewSow(job: Job): Promise<string> {
    const display = (job as any).jobId as string | undefined;
    if (display != null && String(display).trim() !== '') {
      const digits = String(display).replace(/\D/g, '');
      const core = digits || String(display).trim();
      const candidate = `SOW ${core.padStart(5, '0')}`;
      const taken = await this.sowModel.findOne({ sowNumber: candidate }).exec();
      if (!taken) {
        return candidate;
      }
    }
    return this.generateSOWNumber();
  }

  /** The numeric part of a SOW number, or null if it does not parse. */
  static parseSowNumber(sowNumber: unknown): number | null {
    if (typeof sowNumber !== 'string') return null;
    const match = sowNumber.match(/SOW\s+(\d+)/i);
    if (!match) return null;
    const n = parseInt(match[1], 10);
    return Number.isFinite(n) ? n : null;
  }

  /** Every SOW number uses this width, so ordering and formatting stay consistent. */
  static formatSowNumber(n: number): string {
    return `SOW ${String(n).padStart(5, '0')}`;
  }

  /**
   * Next SOW number in sequence.
   *
   * The highest existing number is found numerically, not by sorting the strings.
   * A string sort over mixed widths ranks "SOW 013" above "SOW 00099", so the old
   * implementation could pick a lower number as the maximum and hand back one that
   * was already taken — which the unique index then rejects, failing SOW creation
   * outright. Numbers are also emitted at one consistent width now; the two
   * formats that used to coexist were what made the sort ambiguous.
   */
  async generateSOWNumber(): Promise<string> {
    const existing = await this.sowModel.find({}, { sowNumber: 1 }).lean().exec();
    const numbers = existing.map((s) => SOWService.parseSowNumber((s as { sowNumber?: string }).sowNumber)).filter((n): n is number => n !== null);
    let next = (numbers.length ? Math.max(...numbers) : 0) + 1;

    // Defensive: legacy rows whose number does not parse are invisible above, so
    // step past anything already taken rather than colliding on the unique index.
    const taken = new Set(existing.map((s) => (s as { sowNumber?: string }).sowNumber));
    while (taken.has(SOWService.formatSowNumber(next))) next += 1;

    return SOWService.formatSowNumber(next);
  }

  /**
   * Validate SOW data
   */
  private validateSOWData(input: CreateSOWInput | UpdateSOWInput): void {
    // Validate scope of work
    if ('scopeOfWork' in input && input.scopeOfWork && input.scopeOfWork.length === 0) {
      throw new BadRequestException('scopeOfWork cannot be empty');
    }

    // Validate deliverables
    if ('deliverables' in input && input.deliverables && input.deliverables.length === 0) {
      throw new BadRequestException('deliverables cannot be empty');
    }

    // Validate services
    if ('services' in input && input.services && input.services.length === 0) {
      throw new BadRequestException('services cannot be empty');
    }

    // Validate timeline
    if ('timeline' in input && input.timeline) {
      const { startDate, endDate } = input.timeline;
      if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
        throw new BadRequestException('endDate must be after startDate');
      }
    }

    // Validate pricing
    if ('pricing' in input && input.pricing) {
      const { baseCost, adjustments, totalCost } = input.pricing;

      if (baseCost !== undefined && baseCost < 0) {
        throw new BadRequestException('baseCost cannot be negative');
      }

      if (totalCost !== undefined && totalCost < 0) {
        throw new BadRequestException('totalCost cannot be negative');
      }

      // Calculate expected total cost
      if (baseCost !== undefined && adjustments && totalCost !== undefined) {
        const adjustmentsTotal = adjustments.reduce((sum, adj) => {
          if (adj.type === 'DISCOUNT') {
            return sum - adj.amount;
          } else if (adj.type === 'ADDITIONAL_COST') {
            return sum + adj.amount;
          }
          return sum;
        }, 0);

        const expectedTotal = baseCost + adjustmentsTotal;
        // Allow small floating point differences (0.01)
        if (Math.abs(expectedTotal - totalCost) > 0.01) {
          throw new BadRequestException(`totalCost (${totalCost}) does not match baseCost (${baseCost}) + adjustments (${adjustmentsTotal})`);
        }
      }
    }
  }

  /**
   * Transform service input to SOWService format
   */
  private async transformServices(services: CreateSOWInput['services'], customerCategory?: CustomerCategory): Promise<SOW['services']> {
    return Promise.all(
      services.map(async (service) => {
        const serviceRecord = await this.dampLabServices.findOne(service.id);
        if (!serviceRecord || serviceRecord.isDeleted === true) {
          throw new NotFoundException(`Service with ID ${service.id} not found`);
        }
        // The fallback is a *unit* price, so prefer an incoming unitCost: passing a
        // line total here would see it multiplied a second time.
        const { unitCost, multiplier, cost } = calculateServiceCostBreakdown(serviceRecord, service.formData, service.unitCost ?? service.cost, customerCategory);
        const runCount = extractRunCount(service.formData);
        return {
          _id: service.id,
          serviceId: service.id,
          name: service.name,
          description: service.description,
          cost,
          unitCost,
          multiplier,
          category: service.category,
          runCount
        };
      })
    );
  }

  private calculateBaseCost(services: SOW['services']): number {
    return services.reduce((sum, service) => sum + (service.cost ?? 0), 0);
  }

  private calculateAdjustmentsTotal(adjustments: SOW['pricing']['adjustments']): number {
    return adjustments.reduce((sum, adj) => {
      if (adj.type === 'DISCOUNT') {
        return sum - adj.amount;
      } else if (adj.type === 'ADDITIONAL_COST') {
        return sum + adj.amount;
      }
      return sum;
    }, 0);
  }

  private calculateTotalCost(baseCost: number, adjustments: SOW['pricing']['adjustments']): number {
    return baseCost + this.calculateAdjustmentsTotal(adjustments);
  }

  private validatePricingConsistency(pricing: CreateSOWInput['pricing'] | UpdateSOWInput['pricing'] | undefined, baseCost: number, totalCost: number): void {
    if (!pricing) return;
    if (pricing.baseCost !== undefined && Math.abs(pricing.baseCost - baseCost) > 0.01) {
      throw new BadRequestException(`baseCost (${pricing.baseCost}) does not match calculated baseCost (${baseCost})`);
    }
    if (pricing.totalCost !== undefined && Math.abs(pricing.totalCost - totalCost) > 0.01) {
      throw new BadRequestException(`totalCost (${pricing.totalCost}) does not match calculated totalCost (${totalCost})`);
    }
  }

  /**
   * Transform pricing adjustments
   */
  private transformPricingAdjustments(adjustments: CreateSOWInput['pricing']['adjustments']): SOW['pricing']['adjustments'] {
    return adjustments.map((adj) => ({
      _id: adj.type + '-' + Date.now() + '-' + Math.random(),
      type: adj.type,
      description: adj.description,
      // The client's `amount` is never trusted where it can be derived: a caller
      // that sends a unit amount gets the product, computed here.
      amount: adjustmentAmount(adj),
      unitAmount: adj.unitAmount == null ? undefined : Number(adj.unitAmount),
      multiplier: adj.unitAmount == null ? undefined : adjustmentMultiplier(adj),
      category: adj.category,
      reason: adj.reason
    }));
  }

  /**
   * The SOW service lines a job's workflows currently imply, in node order.
   *
   * The single source of service-line figures: the workflow sync writes these
   * onto the SOW, and the accept-before-send gate fingerprints them to decide
   * whether the spec still matches what staff accepted. Lives here rather than
   * on JobResolver because both of those callers need it and neither owns it.
   */
  async collectSowServiceInputs(job: Job, existingServices: any[] = []): Promise<any[]> {
    const orderedNodes: any[] = [];
    for (const workflowId of job.workflows ?? []) {
      const workflow = await this.workflowService.findById(String(workflowId));
      if (!workflow) continue;

      const nodeIds = (workflow.nodes ?? []).map((n: any) => String(n));
      if (!nodeIds.length) continue;

      const nodes = await this.workflowNodeService.getByIDs(nodeIds);
      const byId = new Map(nodes.map((n: any) => [String(n._id), n]));

      for (const nodeId of nodeIds) {
        const node = byId.get(nodeId);
        if (node) orderedNodes.push(node);
      }
    }

    return orderedNodes.map((node: any, idx: number) => {
      const existing = existingServices[idx];
      const serviceId = String(node.service?._id ?? node.service);

      return {
        id: serviceId,
        name: existing?.name ?? node.label ?? 'Service',
        description: existing?.description ?? node.label ?? 'Service',
        // A unit price, not a line total: transformServices multiplies whatever
        // arrives here by the node's multiplier when the service record carries
        // no price of its own.
        //
        // The job's node price always wins. The stored SOW figure used to be
        // preferred, which was correct while the SOW editor could override a
        // unit price — but it also meant a workflow edit that should reprice a
        // line silently didn't, leaving a stale figure on the document forever.
        // Service lines are no longer document-editable, so there is nothing on
        // the SOW side worth preserving here.
        unitCost: node.price ?? 0,
        cost: node.price ?? 0,
        category: existing?.category ?? 'molecular-biology',
        formData: node.formData ?? []
      };
    });
  }

  /**
   * The job's billing fingerprint: what the accept-before-send gate compares.
   *
   * Deliberately derived from the job's own workflows (collectSowServiceInputs)
   * rather than from sow.services, for two reasons. Acceptance usually happens
   * before a SOW exists, so there is nothing on the document side to read; and
   * both sides of the comparison have to be computed the same way or every
   * check would report drift that isn't there.
   *
   * Consequence, intended: an admin catalogue price edit moves what
   * transformServices writes onto the SOW but moves neither node.price nor the
   * category, so it does not re-lock the send. The document's own staleness
   * signal covers that case.
   */
  async jobBillingFingerprint(job: Job): Promise<string> {
    const services = await this.collectSowServiceInputs(job);
    return SowVersionService.jobBillingFingerprint(
      // `multiplier` is left out rather than recomputed: node.price is already
      // unitCost x multiplier (calculateServiceCost returns the breakdown's
      // `cost`, and the multiplier includes __runCount), so a run-count or
      // sample-count change moves the figure below on its own. Both sides of the
      // gate's comparison run through here, so omitting it cannot cause drift.
      services.map((s) => ({ serviceId: String(s.id), name: s.name, cost: Number(s.cost) || 0, unitCost: s.unitCost, multiplier: undefined })),
      (job as any).customerCategory ?? null
    );
  }

  /**
   * The job a SOW belongs to, or null. Callers need it for the customer category
   * (which drives pricing) and the display job id shown on the document.
   */
  async getJobForSow(sow: Pick<SOW, 'jobId'>): Promise<Job | null> {
    if (!sow?.jobId) return null;
    return this.jobService.findById(String(sow.jobId));
  }

  /**
   * Writes the adjustments a staff member changed in the SOW editor back to the
   * billing core, then recomputes the totals.
   *
   * Service lines are deliberately NOT writable from the document. Their figures
   * come from the job spec — the thing the customer proposed and the lab
   * accepted — via transformServices on the workflow sync path, which is the
   * single writer. Staff alter what a document bills by adding a DISCOUNT or
   * ADDITIONAL_COST adjustment, which the customer can see as its own line with
   * its own reason, rather than by silently rewriting a price the customer
   * already agreed to.
   *
   * baseCost and totalCost are still derived here, and only from values already
   * on the SOW.
   */
  async applyDocumentBilling(sowId: string, changes: { adjustments?: CreateSOWInput['pricing']['adjustments'] }): Promise<SOW> {
    const sow = await this.sowModel.findById(sowId).exec();
    if (!sow) throw new NotFoundException(`SOW with ID ${sowId} not found`);

    const services = sow.services ?? [];
    const adjustments = changes.adjustments ? this.transformPricingAdjustments(changes.adjustments) : sow.pricing?.adjustments ?? [];

    const baseCost = this.calculateBaseCost(services);
    const totalCost = this.calculateTotalCost(baseCost, adjustments);

    const updated = await this.sowModel.findByIdAndUpdate(sowId, { $set: { pricing: { ...(sow.pricing ?? {}), baseCost, adjustments, totalCost }, updatedAt: new Date() } }, { new: true }).exec();

    if (!updated) throw new NotFoundException(`SOW with ID ${sowId} not found`);
    return updated;
  }

  /**
   * Puts a previously captured billing core back.
   *
   * Compensation for `applyDocumentBilling`, which a save performs before it
   * knows whether its version row will win the parent-pointer CAS. A lost race
   * would otherwise leave the document billing figures that no version records.
   */
  async restoreDocumentBilling(sowId: string, pricing: SOW['pricing']): Promise<void> {
    await this.sowModel.findByIdAndUpdate(sowId, { $set: { pricing, updatedAt: new Date() } }).exec();
  }

  /** Default project length when nothing better is known; staff edit it in the editor. */
  private static readonly DEFAULT_DURATION_DAYS = 14;

  /**
   * Opening scope-of-work lines: one per distinct service on the job.
   *
   * These are a starting point, not a finished document — every line is editable
   * in the SOW editor. What matters is that a newly generated SOW is never empty,
   * because `validateSOWData` rejects an empty scope outright.
   */
  private static buildScopeOfWork(services: CreateSOWInput['services']): string[] {
    const counts = new Map<string, { name: string; count: number }>();
    for (const service of services) {
      const entry = counts.get(service.id);
      if (entry) entry.count += 1;
      else counts.set(service.id, { name: service.name, count: 1 });
    }

    const lines = [...counts.values()].map(({ name, count }) => (count > 1 ? `Perform ${name} (${count} instances)` : `Perform ${name}`));
    return lines.length ? lines : ['Perform molecular biology services as specified in the workflow'];
  }

  /**
   * Opening deliverables, taken from each service record's own `deliverables`.
   *
   * Most seeded services carry none, hence the fallback: an empty array would
   * fail validation and turn "Generate SOW" into an error message.
   */
  private async buildDeliverables(services: CreateSOWInput['services']): Promise<string[]> {
    const deliverables = new Set<string>();

    for (const id of new Set(services.map((s) => s.id))) {
      const record = await this.dampLabServices.findOne(id);
      for (const deliverable of (record as { deliverables?: string[] } | null)?.deliverables ?? []) {
        if (typeof deliverable === 'string' && deliverable.trim()) deliverables.add(deliverable.trim());
      }
    }

    if (deliverables.size === 0) {
      deliverables.add('Completed molecular biology services as specified');
      deliverables.add('Quality control results');
    }

    return [...deliverables];
  }

  /**
   * Create the first SOW for a job, deriving everything from the job itself.
   *
   * This is what "Generate SOW" calls. The old flow built the whole payload in the
   * browser and posted it; the document text now comes from the server, so the
   * client sends nothing but the job id and the server decides what the opening
   * draft says.
   *
   * Idempotent: a job that already has a SOW gets that SOW back rather than an
   * error, so a double click cannot produce a failure the staff member has to
   * interpret.
   *
   * `services` comes from the caller because walking the job's workflows down to
   * their nodes belongs to the workflow layer, not here. Each entry must carry the
   * node's `formData` — that is what the price multiplier is read from, and
   * dropping it silently reprices a 70-run job as a single run.
   */
  async createForJob(jobId: string, services: CreateSOWInput['services'], createdBy: string): Promise<SOW> {
    const existing = await this.sowModel.findOne({ jobId }).exec();
    if (existing) return existing;

    const job = await this.jobService.findById(jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }

    if (!services.length) {
      throw new BadRequestException('This job has no services yet, so there is nothing to put in a Statement of Work. Add a workflow to the job first.');
    }

    // A calendar day, not the moment of creation: this seeds period 1, and a
    // raw instant would put a SOW created in the Boston evening on tomorrow's
    // date in its own Period of Performance.
    const startDate = labCalendarDay();
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + SOWService.DEFAULT_DURATION_DAYS);

    return this.create({
      jobId,
      // sowTitle is deliberately absent: the field calculator supplies the default
      // title, and a second copy of that string here is exactly the divergence the
      // document rewrite exists to prevent.
      clientName: (job as any).clientDisplayName || job.username || job.name || 'Client',
      clientEmail: job.email,
      clientInstitution: job.institute,
      // Deliberately not job.institute: a job has no address field, and copying
      // the institute here printed it twice in the parties block.
      clientAddress: undefined,
      scopeOfWork: SOWService.buildScopeOfWork(services),
      deliverables: await this.buildDeliverables(services),
      services,
      timeline: { startDate, endDate, duration: `${SOWService.DEFAULT_DURATION_DAYS} days` },
      resources: { projectManager: '', projectLead: '' },
      // baseCost and totalCost are left out on purpose: `create` computes both from
      // the service records and only validates figures the caller actually supplied.
      pricing: { adjustments: [] },
      additionalInformation: '',
      createdBy,
      status: SOWStatus.DRAFT
    });
  }

  /**
   * Create a new SOW
   */
  async create(createSOWInput: CreateSOWInput): Promise<SOW> {
    // Validate job exists
    const job = await this.jobService.findById(createSOWInput.jobId);
    if (!job) {
      throw new NotFoundException(`Job with ID ${createSOWInput.jobId} not found`);
    }

    // Check if job already has a SOW
    const existingSOW = await this.sowModel.findOne({ jobId: createSOWInput.jobId }).exec();
    if (existingSOW) {
      throw new BadRequestException(`Job ${createSOWInput.jobId} already has a SOW`);
    }

    // Validate input data
    this.validateSOWData(createSOWInput);

    // Always assign on the server; ignore any client-provided sowNumber.
    const sowNumber = await this.resolveSowNumberForNewSow(job);

    // Transform services
    const services = await this.transformServices(createSOWInput.services, (job as any).customerCategory);

    // Transform pricing adjustments
    const adjustments = this.transformPricingAdjustments(createSOWInput.pricing.adjustments ?? []);
    const baseCost = this.calculateBaseCost(services);
    const totalCost = this.calculateTotalCost(baseCost, adjustments);
    this.validatePricingConsistency(createSOWInput.pricing, baseCost, totalCost);

    // Create SOW document
    const sowData = {
      sowNumber,
      date: createSOWInput.date || new Date(),
      job: job._id,
      jobId: job._id.toString(),
      jobName: job.name,
      sowTitle: createSOWInput.sowTitle,
      clientName: createSOWInput.clientName,
      clientEmail: createSOWInput.clientEmail,
      clientInstitution: createSOWInput.clientInstitution,
      clientAddress: createSOWInput.clientAddress,
      scopeOfWork: createSOWInput.scopeOfWork,
      deliverables: createSOWInput.deliverables,
      services,
      timeline: createSOWInput.timeline,
      resources: createSOWInput.resources,
      pricing: {
        baseCost,
        adjustments,
        totalCost,
        discount: createSOWInput.pricing.discount
      },
      terms: createSOWInput.terms,
      additionalInformation: createSOWInput.additionalInformation,
      createdBy: createSOWInput.createdBy,
      status: createSOWInput.status || SOWStatus.DRAFT,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const sow = await this.sowModel.create(sowData);
    // Every SOW owns a document from the moment it exists, so the editor and the
    // customer view never have to cope with a SOW that has no version.
    await this.sowVersionService.createInitialVersion(sow, job as any, createSOWInput.createdBy);
    // Re-read: creating the version sets the version pointers with a separate
    // update, so the document created above still reports currentVersionNumber 0.
    return (await this.sowModel.findById(sow._id).exec()) ?? sow;
  }

  /**
   * Update an existing SOW
   */
  async update(id: string, updateSOWInput: UpdateSOWInput): Promise<SOW> {
    const sow = await this.sowModel.findById(id).exec();
    if (!sow) {
      throw new NotFoundException(`SOW with ID ${id} not found`);
    }
    const job = await this.jobService.findById(sow.jobId);

    // Validate input data
    this.validateSOWData(updateSOWInput);

    // Transform services if provided
    let services = sow.services;
    if (updateSOWInput.services) {
      services = await this.transformServices(updateSOWInput.services, (job as any)?.customerCategory);
    }

    // Transform pricing adjustments if provided
    let adjustments = sow.pricing.adjustments;
    if (updateSOWInput.pricing?.adjustments) {
      adjustments = this.transformPricingAdjustments(updateSOWInput.pricing.adjustments);
    }

    // Build update object
    const updateData: any = {
      updatedAt: new Date()
    };

    // sowNumber is never updated from the API (server-assigned at create).
    if (updateSOWInput.date !== undefined) updateData.date = updateSOWInput.date;
    if (updateSOWInput.sowTitle !== undefined) updateData.sowTitle = updateSOWInput.sowTitle;
    if (updateSOWInput.clientName !== undefined) updateData.clientName = updateSOWInput.clientName;
    if (updateSOWInput.clientEmail !== undefined) updateData.clientEmail = updateSOWInput.clientEmail;
    if (updateSOWInput.clientInstitution !== undefined) updateData.clientInstitution = updateSOWInput.clientInstitution;
    if (updateSOWInput.clientAddress !== undefined) updateData.clientAddress = updateSOWInput.clientAddress;
    if (updateSOWInput.scopeOfWork !== undefined) updateData.scopeOfWork = updateSOWInput.scopeOfWork;
    if (updateSOWInput.deliverables !== undefined) updateData.deliverables = updateSOWInput.deliverables;
    if (updateSOWInput.services !== undefined) updateData.services = services;
    if (updateSOWInput.timeline !== undefined) updateData.timeline = updateSOWInput.timeline;
    if (updateSOWInput.resources !== undefined) updateData.resources = updateSOWInput.resources;
    const shouldUpdatePricing = updateSOWInput.services !== undefined || updateSOWInput.pricing !== undefined;
    if (shouldUpdatePricing) {
      const baseCost = this.calculateBaseCost(services);
      const totalCost = this.calculateTotalCost(baseCost, adjustments);
      this.validatePricingConsistency(updateSOWInput.pricing, baseCost, totalCost);
      updateData.pricing = {
        baseCost,
        adjustments,
        totalCost,
        discount: updateSOWInput.pricing?.discount ?? sow.pricing.discount
      };
    }
    if (updateSOWInput.terms !== undefined) updateData.terms = updateSOWInput.terms;
    if (updateSOWInput.additionalInformation !== undefined) updateData.additionalInformation = updateSOWInput.additionalInformation;

    const updatedSOW = await this.sowModel.findByIdAndUpdate(id, { $set: updateData }, { new: true }).exec();
    if (!updatedSOW) {
      throw new NotFoundException(`SOW with ID ${id} not found`);
    }

    return updatedSOW;
  }

  /**
   * Delete a SOW
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.sowModel.findByIdAndDelete(id).exec();
    return !!result;
  }

  /**
   * Find SOW by ID
   */
  async findById(id: string): Promise<SOW | null> {
    return this.sowModel.findById(id).exec();
  }

  /**
   * Find SOW by job ID
   */
  async findByJobId(jobId: string): Promise<SOW | null> {
    return this.sowModel.findOne({ jobId }).exec();
  }

  /**
   * Find SOWs by status
   */
  async findByStatus(status: SOWStatus): Promise<SOW[]> {
    return this.sowModel.find({ status }).sort({ createdAt: -1 }).exec();
  }

  /**
   * Find all SOWs
   */
  async findAll(): Promise<SOW[]> {
    return this.sowModel.find({}).sort({ createdAt: -1 }).exec();
  }

  /** Max size for signatureDataUrl in bytes (500 KB). Base64 increases size ~4/3, so we limit string length. */
  private static readonly SIGNATURE_DATA_URL_MAX_BYTES = 500 * 1024;

  /**
   * Upsert SOW for a job (create or update if exists)
   */
  async upsertForJob(jobId: string, createSOWInput: CreateSOWInput): Promise<SOW> {
    const existingSOW = await this.findByJobId(jobId);
    const previousLeadId = existingSOW?.resources?.projectLeadId;

    let result: SOW;
    if (existingSOW) {
      // Update existing SOW (do not pass sowNumber — it stays server-assigned)
      const updateInput: UpdateSOWInput = {
        date: createSOWInput.date,
        sowTitle: createSOWInput.sowTitle,
        clientName: createSOWInput.clientName,
        clientEmail: createSOWInput.clientEmail,
        clientInstitution: createSOWInput.clientInstitution,
        clientAddress: createSOWInput.clientAddress,
        scopeOfWork: createSOWInput.scopeOfWork,
        deliverables: createSOWInput.deliverables,
        services: createSOWInput.services,
        timeline: createSOWInput.timeline,
        resources: createSOWInput.resources,
        pricing: createSOWInput.pricing,
        terms: createSOWInput.terms,
        additionalInformation: createSOWInput.additionalInformation
        // status is not forwarded: the version state machine owns it.
      };
      result = await this.update(existingSOW._id, updateInput);
    } else {
      // Create new SOW
      result = await this.create(createSOWInput);
    }

    // Auto-assign the Project Lead to unassigned workflow nodes
    await this.autoAssignProjectLead(jobId, createSOWInput.resources?.projectLeadId, createSOWInput.resources?.projectLead, previousLeadId);

    return result;
  }

  /**
   * Auto-assign the Project Lead to workflow nodes on a job.
   * Only assigns nodes that have no assignee or that were assigned to the previous lead.
   */
  async autoAssignProjectLead(jobId: string, projectLeadId?: string, projectLeadName?: string, previousLeadId?: string): Promise<void> {
    if (!projectLeadId || !projectLeadName) return;

    try {
      const job = await this.jobService.findById(jobId);
      if (!job?.workflows?.length) return;

      for (const workflowId of job.workflows) {
        const workflow = await this.workflowService.findById(String(workflowId));
        if (!workflow?.nodes?.length) continue;

        const nodeIds = workflow.nodes.map((n: any) => String(n));
        const nodes = await this.workflowNodeService.getByIDs(nodeIds);

        for (const node of nodes) {
          const currentAssignee = node.assigneeId;
          // Assign if: no assignee, or previously assigned to the old lead
          if (!currentAssignee || (previousLeadId && currentAssignee === previousLeadId)) {
            await this.workflowNodeService.updateAssignee(node, projectLeadId, projectLeadName);
          }
        }
      }

      this.logger.log(`Auto-assigned Project Lead "${projectLeadName}" to unassigned nodes on job ${jobId}`);
    } catch (err) {
      this.logger.warn(`Failed to auto-assign Project Lead for job ${jobId}: ${err?.message ?? err}`);
    }
  }
}
