import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { HydratedDocument, Model } from 'mongoose';
import { JobVersion, JobVersionAuthorRole, JobVersionDocument, JobVersionEdge, JobVersionNode, JobVersionWorkflow } from './job-version.model';
import { SaveJobWorkflowsInput, SaveWorkflowInput } from './job-version.dto';
import { Job, JobDocument, JobState } from '../job/job.model';
import { Workflow, WorkflowDocument, WorkflowState } from '../workflow/models/workflow.model';
import { WorkflowNode, WorkflowNodeDocument, WorkflowNodeState } from '../workflow/models/node.model';
import { WorkflowEdge, WorkflowEdgeDocument } from '../workflow/models/edge.model';
import { DampLabServices } from '../services/damplab-services.services';
import { getMultiValueParamIds, normalizeFormDataToArray } from '../workflow/utils/form-data.util';
import { calculateServiceCost, CustomerCategory } from '../pricing/service-pricing.util';
import { isEmptyParamValue, paramValuesById, paramValuesSemanticallyEqual } from './param-values.util';

/** Fields on a live WorkflowNode that a save is allowed to write. Everything else — state, assigneeId, startedAt, completedSteps, usedInventory, inventory reservations — belongs to the lab and is never touched here. */
type NodeContentPatch = {
  label: string;
  service: mongoose.Types.ObjectId;
  additionalInstructions: string;
  formData: unknown;
  price: number | undefined;
  reactNode: Record<string, unknown>;
};

/** Mongoose models declare `_id: string` on these classes, so ids come back needing a widening conversion. */
const toObjectId = (value: unknown): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(String(value));

/** A live node as mongoose hands it back. */
type LiveNode = HydratedDocument<WorkflowNode>;

/** A node resolved against the catalogue and priced, ready to write. */
interface PreparedNode {
  clientId: string;
  patch: NodeContentPatch;
  snapshot: JobVersionNode;
}

/**
 * Whether a user actually changed a node's parameters.
 *
 * Set membership alone will not do. The editor always submits the *current*
 * catalogue's parameter list, so a parameter added to the service since the job
 * was submitted arrives with an empty value, and the universal run-count entry
 * appears on jobs that predate it. Neither is something the user touched, and
 * treating them as edits would make every in-flight node unsaveable on any
 * service whose parameters have since been edited.
 *
 * So: compare values, and ignore an id that is empty on the side where it is
 * missing.
 */
function parametersDiffer(before: unknown, after: unknown): boolean {
  const beforeById = paramValuesById(before);
  const afterById = paramValuesById(after);

  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    const hasBefore = beforeById.has(id);
    const hasAfter = afterById.has(id);
    const beforeValue = beforeById.get(id);
    const afterValue = afterById.get(id);

    // Present on one side only: an edit only if that side carries a real value.
    if (!hasBefore) {
      if (!isEmptyParamValue(afterValue)) return true;
      continue;
    }
    if (!hasAfter) {
      if (!isEmptyParamValue(beforeValue)) return true;
      continue;
    }
    if (isEmptyParamValue(beforeValue) && isEmptyParamValue(afterValue)) continue;
    if (paramValuesSemanticallyEqual(beforeValue, afterValue)) continue;
    return true;
  }

  return false;
}

@Injectable()
export class JobVersionService {
  constructor(
    @InjectModel(JobVersion.name) private readonly versionModel: Model<JobVersionDocument>,
    @InjectModel(Job.name) private readonly jobModel: Model<JobDocument>,
    @InjectModel(Workflow.name) private readonly workflowModel: Model<WorkflowDocument>,
    @InjectModel(WorkflowNode.name) private readonly nodeModel: Model<WorkflowNodeDocument>,
    @InjectModel(WorkflowEdge.name) private readonly edgeModel: Model<WorkflowEdgeDocument>,
    private readonly dampLabServices: DampLabServices
  ) {}

  // ---------------------------------------------------------- version numbers

  private static readonly MINOR_WIDTH = 1000;

  static encodeVersionNumber(major: number, minor: number): number {
    return major * JobVersionService.MINOR_WIDTH + minor;
  }

  static decodeVersionNumber(versionNumber: number): { major: number; minor: number } {
    return {
      major: Math.floor(versionNumber / JobVersionService.MINOR_WIDTH),
      minor: versionNumber % JobVersionService.MINOR_WIDTH
    };
  }

  /** Encoded values as "1.2"; pre-scheme integers (< 1000) as "3". */
  static displayVersionLabel(versionNumber: number): string {
    if (versionNumber < JobVersionService.MINOR_WIDTH) return String(versionNumber);
    const { major, minor } = JobVersionService.decodeVersionNumber(versionNumber);
    return `${major}.${minor}`;
  }

  /**
   * Next free versionNumber.
   *
   * `highest` is the current max on the job (events included). `bumpMajor` is
   * true only for Request Changes and for the original submission (the first
   * row of a new job). Legacy jobs whose highest is still < 1000 stay on
   * consecutive integers until the first major bump, which becomes 1.0.
   */
  static nextVersionNumber(highest: number | null, bumpMajor: boolean): number {
    if (highest == null) {
      return bumpMajor ? JobVersionService.encodeVersionNumber(1, 0) : JobVersionService.encodeVersionNumber(0, 1);
    }
    const { major, minor } = JobVersionService.decodeVersionNumber(highest);
    return bumpMajor ? JobVersionService.encodeVersionNumber(major + 1, 0) : JobVersionService.encodeVersionNumber(major, minor + 1);
  }

  static isVisibleToCustomer(version: { visibleToCustomer?: boolean | null; authorRole: JobVersionAuthorRole }): boolean {
    if (version.authorRole === JobVersionAuthorRole.CUSTOMER) return true;
    return version.visibleToCustomer !== false;
  }

  static filterVisibleToCustomer<T extends { visibleToCustomer?: boolean | null; authorRole: JobVersionAuthorRole }>(versions: T[]): T[] {
    return versions.filter((v) => JobVersionService.isVisibleToCustomer(v));
  }

  static latestContentVersionNumber(versions: { versionNumber: number; isEvent?: boolean | null }[]): number | null {
    const content = versions.filter((v) => v.isEvent !== true).sort((a, b) => b.versionNumber - a.versionNumber);
    return content[0]?.versionNumber ?? null;
  }

  // ---------------------------------------------------------------- baseline

  /**
   * The version `versionNumber` should be compared against.
   *
   * Keys off the *author of the version being viewed*, not off the viewer, so
   * both parties see the same diff — they are discussing one change set, not
   * two. Consecutive saves by one party therefore collapse into a single diff
   * against the other party's last version, which is what makes "the customer's
   * edits relative to the one sent to them" work after the customer saved twice.
   *
   * Event versions are never chosen: their graph is a verbatim copy of the
   * version before them, so baselining against one reports "nothing changed" and
   * hides the edit it followed. Closing a job right after the customer edited it
   * would otherwise erase the highlight on those very edits.
   *
   * Returns null when nothing below it was written by the other side.
   */
  static baselineFor(versions: Pick<JobVersion, 'versionNumber' | 'authorRole' | 'isEvent'>[], versionNumber: number): number | null {
    const current = versions.find((v) => v.versionNumber === versionNumber);
    if (!current) return null;

    const earlierByOtherSide = versions.filter((v) => v.versionNumber < versionNumber && v.authorRole !== current.authorRole && v.isEvent !== true).sort((a, b) => b.versionNumber - a.versionNumber);

    return earlierByOtherSide.length ? earlierByOtherSide[0].versionNumber : null;
  }

  // ----------------------------------------------------------------- reading

  /**
   * Every version of a job, oldest first.
   *
   * Jobs submitted before versioning existed have no v1, so one is synthesized
   * from their live workflows on first read and persisted. That keeps the
   * backfill lazy — no migration script — and idempotent.
   */
  async listByJob(jobId: string): Promise<JobVersion[]> {
    const existing = await this.versionModel.find({ jobId }).sort({ versionNumber: 1 }).exec();
    if (existing.length > 0) return existing;

    const job = await this.jobModel.findById(jobId).exec();
    if (!job) return [];

    const workflows = await this.snapshotLiveWorkflows(job);
    if (workflows.length === 0) return [];

    try {
      const created = await this.appendVersion(job, workflows, {
        authorRole: JobVersionAuthorRole.CUSTOMER,
        createdBy: job.sub ?? '',
        createdByName: job.clientDisplayName || job.username || job.email || '',
        note: 'Original submission',
        createdAt: job.submitted ?? new Date(),
        bumpMajor: true,
        visibleToCustomer: true
      });
      return [created];
    } catch (error: any) {
      // Two concurrent loads of the same legacy job both see zero versions and
      // both try to write v1; the unique index makes one lose. That is the
      // backfill working, not a failure — re-read and use whichever won.
      if (error?.code !== 11000) throw error;
      return this.versionModel.find({ jobId }).sort({ versionNumber: 1 }).exec();
    }
  }

  async getLatestContentVersion(jobId: string): Promise<JobVersion | null> {
    return this.versionModel
      .findOne({ jobId, isEvent: { $ne: true } })
      .sort({ versionNumber: -1 })
      .exec();
  }

  /**
   * The graph as the customer last put it forward — what rejecting the lab's
   * changes goes back to.
   *
   * Their own most recent content version, because everything the lab has done
   * since is a STAFF-authored version stacked on top of it. Falling back to the
   * earliest content version covers a job staff submitted on someone's behalf,
   * where no version is customer-authored at all and the original submission is
   * the only thing that can be meant by "before the lab's edits".
   *
   * This is a scan, unlike the handover baseline a withdrawal restores, which is
   * stamped on the job when the lab hands it over. The two are not symmetric:
   * the lab's handover is a single moment worth recording, while "the customer's
   * last word" is a property of the history itself and stays correct across any
   * number of rounds. Callers still capture the result when they journal their
   * command, so a retry restores the same version even if history moves.
   */
  async getCustomerBaselineVersion(jobId: string): Promise<JobVersion | null> {
    const ownedByCustomer = await this.versionModel
      .findOne({ jobId, isEvent: { $ne: true }, authorRole: JobVersionAuthorRole.CUSTOMER })
      .sort({ versionNumber: -1 })
      .exec();
    if (ownedByCustomer) return ownedByCustomer;

    return this.versionModel
      .findOne({ jobId, isEvent: { $ne: true } })
      .sort({ versionNumber: 1 })
      .exec();
  }

  async getContentVersion(jobId: string, versionNumber: number): Promise<JobVersion | null> {
    return this.versionModel.findOne({ jobId, versionNumber, isEvent: { $ne: true } }).exec();
  }

  /**
   * Any version by number, event rows included.
   *
   * Events are not content — nothing is accepted or diffed against them — but
   * they do carry a verbatim copy of the graph as it stood, and they are what
   * the history calls "Submitted" or "Changes requested". Restoring to one is
   * therefore a thing a user can reasonably ask for, and refusing it produced a
   * bare "version not found" against a version plainly listed in the picker.
   */
  async getAnyVersion(jobId: string, versionNumber: number): Promise<JobVersion | null> {
    return this.versionModel.findOne({ jobId, versionNumber }).exec();
  }

  async findByOperationId(jobId: string, operationId: string): Promise<JobVersion | null> {
    return this.versionModel.findOne({ jobId, operationId }).exec();
  }

  async publishVersion(jobId: string, versionNumber: number, publishedBy: string): Promise<JobVersion> {
    const version = await this.getContentVersion(jobId, versionNumber);
    if (!version) {
      throw new NotFoundException(`Job version ${versionNumber} for job ${jobId} not found`);
    }

    // Customer-authored, legacy-visible, and already-published rows are already
    // part of the customer's immutable history. Publication must not rewrite
    // their envelope metadata merely to record another review.
    if (version.authorRole === JobVersionAuthorRole.CUSTOMER || version.visibleToCustomer !== false) {
      return version;
    }

    const published = await this.versionModel
      .findOneAndUpdate(
        {
          jobId,
          versionNumber,
          authorRole: JobVersionAuthorRole.STAFF,
          visibleToCustomer: false,
          isEvent: { $ne: true }
        },
        {
          $set: {
            visibleToCustomer: true,
            publishedAt: new Date(),
            publishedBy
          }
        },
        { new: true }
      )
      .exec();

    // A concurrent retry may have published between the read and update.
    return published ?? ((await this.getContentVersion(jobId, versionNumber)) as JobVersion);
  }

  /** The live workflow graph, in the denormalized shape a version stores. */
  async snapshotLiveWorkflows(job: Job): Promise<JobVersionWorkflow[]> {
    const snapshots: JobVersionWorkflow[] = [];

    for (const workflowRef of job.workflows ?? []) {
      const workflow = await this.workflowModel.findById(String(workflowRef)).exec();
      if (!workflow) continue;

      const nodeIds = (workflow.nodes ?? []).map((n: any) => String(n));
      const nodeDocs = await this.nodeModel.find({ _id: { $in: nodeIds } }).exec();
      // Preserve the workflow's own node ordering; $in does not guarantee it.
      const nodeByDbId = new Map<string, LiveNode>(nodeDocs.map((n) => [String(n._id), n as LiveNode]));
      const orderedNodes = nodeIds.flatMap((id) => {
        const node = nodeByDbId.get(id);
        return node ? [node] : [];
      });

      const edgeIds = (workflow.edges ?? []).map((e: any) => String(e));
      const edgeDocs = await this.edgeModel.find({ _id: { $in: edgeIds } }).exec();

      // Edges reference nodes by database id; snapshots reference them by
      // client-side id, which is what the canvas and the diff both speak.
      const clientIdByDbId = new Map(orderedNodes.map((n) => [String(n._id), n.id]));

      snapshots.push({
        workflowId: String(workflow._id),
        name: workflow.name ?? '',
        nodes: orderedNodes.map((node) => this.nodeSnapshot(node)),
        edges: edgeDocs
          .map((edge) => ({
            id: edge.id,
            source: clientIdByDbId.get(String(edge.source)) ?? '',
            target: clientIdByDbId.get(String(edge.target)) ?? ''
          }))
          .filter((e): e is JobVersionEdge => !!e.source && !!e.target)
      });
    }

    return snapshots;
  }

  private nodeSnapshot(node: LiveNode): JobVersionNode {
    const position = (node.reactNode as any)?.position;
    return {
      id: node.id,
      label: node.label ?? '',
      serviceId: node.service ? String((node.service as any)?._id ?? node.service) : undefined,
      serviceName: node.label ?? '',
      formData: Array.isArray(node.formData) ? node.formData : [],
      additionalInstructions: node.additionalInstructions ?? '',
      price: node.price,
      position: position && typeof position.x === 'number' && typeof position.y === 'number' ? { x: position.x, y: position.y } : undefined
    };
  }

  // ----------------------------------------------------------------- writing

  /** Append a snapshot as the next version. The only way a version is ever created. */
  async appendVersion(
    job: Job,
    workflows: JobVersionWorkflow[],
    meta: {
      authorRole: JobVersionAuthorRole;
      createdBy: string;
      createdByName: string;
      note?: string;
      createdAt?: Date;
      jobState?: JobState;
      isEvent?: boolean;
      bumpMajor?: boolean;
      visibleToCustomer?: boolean;
      operationId?: string;
    }
  ): Promise<JobVersion> {
    const jobId = String(job._id);
    if (meta.operationId) {
      const existing = await this.findByOperationId(jobId, meta.operationId);
      if (existing) return existing;
    }
    const highest = await this.versionModel.findOne({ jobId }).sort({ versionNumber: -1 }).exec();
    const versionNumber = JobVersionService.nextVersionNumber(highest?.versionNumber ?? null, meta.bumpMajor === true);

    try {
      return await this.versionModel.create({
        job: new mongoose.Types.ObjectId(jobId),
        jobId,
        versionNumber,
        authorRole: meta.authorRole,
        workflows,
        note: meta.note,
        // Explicit override first, so a transition can record the state it is
        // moving *to* rather than whatever the in-memory job still says.
        jobState: meta.jobState ?? job.state,
        isEvent: meta.isEvent === true,
        visibleToCustomer: meta.visibleToCustomer === true,
        operationId: meta.operationId,
        createdBy: meta.createdBy,
        createdByName: meta.createdByName,
        createdAt: meta.createdAt ?? new Date()
      });
    } catch (error: any) {
      if (error?.code !== 11000 || !meta.operationId) throw error;
      const raced = await this.findByOperationId(jobId, meta.operationId);
      if (raced) return raced;
      throw error;
    }
  }

  /**
   * Record a state change as a version of its own.
   *
   * The graph is unchanged, so the snapshot is identical to its predecessor and
   * the entry diffs empty — which is the point. Without it the history is only
   * the saves, and the events between them (a customer resubmitting, staff
   * asking for changes) leave no trace at all, so a state chip on the save rows
   * would show nearly the same value on every row.
   *
   * Modelled on the SOW's event versions, which exist for the same reason.
   */
  async appendStateEvent(
    job: Job,
    newState: JobState,
    author: { role: JobVersionAuthorRole; sub: string; name: string },
    note: string,
    operationId?: string,
    sourceWorkflows?: JobVersionWorkflow[]
  ): Promise<JobVersion | null> {
    if (operationId) {
      const existing = await this.findByOperationId(String(job._id), operationId);
      if (existing) return existing;
    }

    // Force the lazy v1 backfill first. On a job submitted before versioning
    // existed the event would otherwise be written as version 1, and listByJob
    // only backfills when it finds *no* versions — so the original submission
    // would be permanently unrecoverable and the history would begin with
    // "Changes requested" against nothing.
    await this.listByJob(String(job._id));

    // Nothing to snapshot means a job with no workflows; there is no history to
    // add an event to, and the lazy v1 backfill would be confused by a v1 that
    // carries no graph.
    const workflows = sourceWorkflows ?? (await this.snapshotLiveWorkflows(job));
    if (workflows.length === 0) return null;

    return this.appendVersion(job, workflows, {
      authorRole: author.role,
      createdBy: author.sub,
      createdByName: author.name,
      note,
      jobState: newState,
      isEvent: true,
      visibleToCustomer: true,
      operationId,
      bumpMajor: newState === JobState.CHANGES_REQUESTED
    });
  }

  /**
   * Replace a job's workflow graph and record the result as a new version.
   *
   * Live documents are reconciled node by node rather than rebuilt, so a node
   * that is already assigned, started or holding inventory keeps all of it.
   */
  /**
   * Makes an earlier version the live graph again.
   *
   * Reverting has to move the live nodes, not just record that it happened: the
   * staff canvas hydrates from `job.workflows`, so a history row alone would
   * claim a revert the lab never actually received. Everything hard here —
   * node reconciliation, preserving lab-owned fields, the work-in-flight guard,
   * appending the resulting version — already lives in saveWorkflows, so this
   * only has to translate a stored snapshot back into the shape it accepts.
   *
   * Shared by the staff/customer Revert action and by withdrawing a job from
   * the customer, so the two cannot drift apart.
   */
  async restoreVersion(
    jobId: string,
    versionNumber: number,
    author: { role: JobVersionAuthorRole; sub: string; name: string },
    note: string,
    opts: { visibleToCustomer?: boolean } = {}
  ): Promise<Job> {
    const source = await this.getAnyVersion(jobId, versionNumber);
    if (!source) throw new NotFoundException(`Job version ${versionNumber} for job ${jobId} not found`);
    if (!(source.workflows ?? []).length) {
      throw new BadRequestException(`Version ${versionNumber} has no workflow to restore.`);
    }

    const workflows: SaveWorkflowInput[] = (source.workflows ?? []).map((workflow) => ({
      workflowId: workflow.workflowId,
      name: workflow.name,
      nodes: (workflow.nodes ?? []).map((node) => {
        // serviceId is optional on a snapshot but required to rebuild a node.
        // Refuse rather than guess: a restore that silently dropped or
        // mis-serviced a node would be worse than not restoring at all.
        if (!node.serviceId) {
          throw new BadRequestException(`Version ${versionNumber} cannot be restored: node "${node.label || node.id}" has no recorded service.`);
        }
        return {
          id: node.id,
          label: node.label,
          serviceId: node.serviceId,
          formData: node.formData,
          additionalInstructions: node.additionalInstructions ?? '',
          position: node.position ? { x: node.position.x, y: node.position.y } : undefined
        };
      }),
      edges: (workflow.edges ?? []).map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }))
    }));

    return this.saveWorkflows({ jobId, workflows, note } as SaveJobWorkflowsInput, author, opts);
  }

  async saveWorkflows(input: SaveJobWorkflowsInput, author: { role: JobVersionAuthorRole; sub: string; name: string }, opts: { visibleToCustomer?: boolean } = {}): Promise<Job> {
    const job = await this.jobModel.findById(input.jobId).exec();
    if (!job) throw new NotFoundException(`Job with ID ${input.jobId} not found`);

    // Non-nullable in the schema already stops an omitted note; this catches the
    // whitespace-only one, which would satisfy the type and tell a reader nothing.
    const note = input.note?.trim();
    if (!note) throw new BadRequestException('Describe what you changed before saving.');

    const liveNodes = await this.loadLiveNodes(job);

    // Prepared first, deliberately: it resolves each node against the catalogue
    // and normalizes formData, so the guard below compares like with like. It
    // only reads, so nothing is written if the guard then rejects.
    const prepared = await this.prepareWorkflows(input.workflows, job.customerCategory as CustomerCategory | undefined);
    this.assertWorkInFlightUntouched(liveNodes, prepared);

    // Which nodes existed before this save, across every tree. Node deletion is
    // decided once, globally, at the end — never per tree.
    //
    // Trees are recomputed from connectivity on each save, so a node routinely
    // migrates between them: deleting an edge splits one tree into two, adding
    // one merges two into one. A per-tree rule reads such a node as "dropped"
    // while the tree that now owns it is still wiring edges to it, leaving an
    // edge pointing at a deleted node — which makes the whole job unreadable.
    const nodeIdsBefore = await this.collectJobNodeIds(job);

    const workflowIds: mongoose.Types.ObjectId[] = [];
    const keptNodeIds = new Set<string>();
    // A workflow may be claimed by one tree only.
    //
    // Splitting is routine — deleting an edge turns one tree into two — and both
    // halves still remember the workflow they came from, so both arrive naming
    // it. Reconciling them in turn overwrote that workflow's node list once per
    // group, so every node but the last was orphaned: still in the database,
    // owned by nothing, and gone from the canvas. The job also ended up listing
    // the same workflow several times, which made the next snapshot report the
    // surviving node once per group.
    //
    // The first group keeps the workflow; the rest become new ones, which is
    // what a split actually means.
    const claimed = new Set<string>();
    for (let i = 0; i < input.workflows.length; i++) {
      const requested = input.workflows[i].workflowId;
      const alreadyTaken = requested != null && claimed.has(String(requested));
      const spec = alreadyTaken ? { ...input.workflows[i], workflowId: undefined } : input.workflows[i];
      if (spec.workflowId != null) claimed.add(String(spec.workflowId));

      const { workflowId, nodeIds } = await this.reconcileWorkflow(spec, prepared[i], liveNodes);
      workflowIds.push(workflowId);
      for (const nodeId of nodeIds) keptNodeIds.add(String(nodeId));
    }

    // Workflows the edit emptied or removed entirely. Their nodes are left to
    // the global pass below, since a "removed" tree is often just one whose
    // nodes now live in a tree that survived.
    const keptIds = new Set(workflowIds.map(String));
    for (const ref of job.workflows ?? []) {
      if (keptIds.has(String(ref))) continue;
      await this.deleteWorkflow(String(ref));
    }

    const removedNodeIds = nodeIdsBefore.filter((nodeId) => !keptNodeIds.has(nodeId));
    if (removedNodeIds.length) {
      await this.nodeModel.deleteMany({ _id: { $in: removedNodeIds } }).exec();
    }

    await this.jobModel.findByIdAndUpdate(job._id, { $set: { workflows: workflowIds } }).exec();

    const refreshed = await this.jobModel.findById(job._id).exec();
    const snapshot = await this.snapshotLiveWorkflows(refreshed!);
    await this.appendVersion(refreshed!, snapshot, {
      authorRole: author.role,
      createdBy: author.sub,
      createdByName: author.name,
      note,
      // Staff edits stay hidden until acceptance publishes them; a customer's
      // own edits are theirs to see. Withdrawal overrides this to true: undoing
      // someone's work and then hiding the result would leave them believing
      // their edits still stand.
      visibleToCustomer: opts.visibleToCustomer ?? author.role === JobVersionAuthorRole.CUSTOMER
    });

    return refreshed!;
  }

  /** Database ids of every node the job currently owns, across all its trees. */
  private async collectJobNodeIds(job: Job): Promise<string[]> {
    const ids = new Set<string>();
    for (const workflowRef of job.workflows ?? []) {
      const workflow = await this.workflowModel.findById(String(workflowRef)).exec();
      for (const nodeRef of workflow?.nodes ?? []) ids.add(String(nodeRef));
    }
    return [...ids];
  }

  /** Every live node on the job, keyed by client-side id. */
  private async loadLiveNodes(job: Job): Promise<Map<string, LiveNode>> {
    const byClientId = new Map<string, LiveNode>();
    for (const workflowRef of job.workflows ?? []) {
      const workflow = await this.workflowModel.findById(String(workflowRef)).exec();
      if (!workflow) continue;
      const nodes = await this.nodeModel.find({ _id: { $in: (workflow.nodes ?? []).map((n: any) => String(n)) } }).exec();
      for (const node of nodes) byClientId.set(node.id, node as LiveNode);
    }
    return byClientId;
  }

  /**
   * Work already under way is not the editor's to change.
   *
   * A node that has left QUEUED, or is holding inventory, may not be deleted or
   * have its service or parameters altered. The UI locks these too, but the UI
   * must never be the only guard — a stale tab or a direct API call would
   * otherwise orphan an inventory hold or silently rewrite a protocol a
   * technician is midway through.
   */
  private assertWorkInFlightUntouched(liveNodes: Map<string, LiveNode>, prepared: PreparedNode[][]): void {
    const preparedById = new Map<string, PreparedNode>();
    for (const workflow of prepared) {
      for (const node of workflow) preparedById.set(node.clientId, node);
    }

    for (const [clientId, live] of liveNodes) {
      const isInFlight = live.state !== WorkflowNodeState.QUEUED;
      const holdsInventory = (live.usedInventory ?? []).length > 0;
      if (!isInFlight && !holdsInventory) continue;

      const reason = isInFlight ? `is ${WorkflowNodeState[live.state]}` : 'is holding inventory';
      const submitted = preparedById.get(clientId);
      if (!submitted) {
        throw new BadRequestException(`"${live.label}" cannot be removed because it ${reason}.`);
      }
      if (String(submitted.patch.service) !== String((live.service as any)?._id ?? live.service)) {
        throw new BadRequestException(`"${live.label}" cannot change service because it ${reason}.`);
      }
      if (parametersDiffer(live.formData, submitted.patch.formData)) {
        throw new BadRequestException(`"${live.label}" cannot have its parameters changed because it ${reason}.`);
      }
    }
  }

  /**
   * Resolve every node against the live catalogue and price it.
   *
   * Prices are recomputed from the job's own customer category, never the
   * editing user's — otherwise a technician saving a customer's job would
   * silently reprice it at staff rates.
   */
  private async prepareWorkflows(workflows: SaveWorkflowInput[], category: CustomerCategory | undefined): Promise<PreparedNode[][]> {
    const serviceIds = [...new Set(workflows.flatMap((w) => w.nodes.map((n) => String(n.serviceId))))];
    const services = new Map<string, any>();
    for (const id of serviceIds) {
      const service = await this.dampLabServices.findOneActive(id);
      if (!service) throw new BadRequestException(`DampLabService with ID ${id} does not exist or is deleted`);
      services.set(id, service);
    }

    return workflows.map((workflow) =>
      workflow.nodes.map((node) => {
        const service = services.get(String(node.serviceId));
        const formData = normalizeFormDataToArray(node.formData, getMultiValueParamIds(service.parameters));
        const price = calculateServiceCost(service, formData, undefined, category);
        const position = node.position ? { x: node.position.x, y: node.position.y } : undefined;

        return {
          clientId: node.id,
          patch: {
            label: node.label ?? service.name,
            service: new mongoose.Types.ObjectId(String(service._id)),
            additionalInstructions: node.additionalInstructions ?? '',
            formData,
            price,
            // Minimal, so nothing the client invented can ride along. Hydration
            // reads only `position` back out of this.
            reactNode: { id: node.id, type: 'selectorNode', position: position ?? { x: 0, y: 0 } }
          },
          snapshot: {
            id: node.id,
            label: node.label ?? service.name,
            serviceId: String(service._id),
            serviceName: service.name,
            formData,
            additionalInstructions: node.additionalInstructions ?? '',
            price,
            position
          }
        };
      })
    );
  }

  /** Apply one tree to the live documents, returning the Workflow id it landed in. */
  /**
   * Persist one tree. Returns the workflow id plus the node ids it now owns, so
   * `saveWorkflows` can decide deletion across every tree at once.
   */
  private async reconcileWorkflow(
    input: SaveWorkflowInput,
    prepared: PreparedNode[],
    liveNodes: Map<string, LiveNode>
  ): Promise<{ workflowId: mongoose.Types.ObjectId; nodeIds: mongoose.Types.ObjectId[] }> {
    const nodeDbIdByClientId = new Map<string, mongoose.Types.ObjectId>();

    for (const node of prepared) {
      const live = liveNodes.get(node.clientId);
      if (live) {
        // Named fields only — never a spread. This is what stops a UI-only flag
        // (ghost, locked, diffKind) from ever reaching the database, and what
        // keeps state/assignee/startedAt/completedSteps/usedInventory intact.
        await this.nodeModel
          .findByIdAndUpdate(live._id, {
            $set: {
              label: node.patch.label,
              service: node.patch.service,
              additionalInstructions: node.patch.additionalInstructions,
              formData: node.patch.formData,
              price: node.patch.price,
              reactNode: node.patch.reactNode
            }
          })
          .exec();
        nodeDbIdByClientId.set(node.clientId, toObjectId(live._id));
      } else {
        const created = await this.nodeModel.create({
          id: node.clientId,
          label: node.patch.label,
          service: node.patch.service,
          additionalInstructions: node.patch.additionalInstructions,
          formData: node.patch.formData,
          price: node.patch.price,
          reactNode: node.patch.reactNode,
          state: WorkflowNodeState.QUEUED
        });
        nodeDbIdByClientId.set(node.clientId, toObjectId(created._id));
      }
    }

    // Edges carry no operational state, so they are cheapest to replace outright.
    const existing = input.workflowId ? await this.workflowModel.findById(input.workflowId).exec() : null;
    if (existing) {
      await this.edgeModel.deleteMany({ _id: { $in: (existing.edges ?? []).map((e: any) => String(e)) } }).exec();
    }

    const edgeIds: mongoose.Types.ObjectId[] = [];
    for (const edge of input.edges) {
      const source = nodeDbIdByClientId.get(edge.source);
      const target = nodeDbIdByClientId.get(edge.target);
      if (!source || !target) continue; // edge to a node this tree does not own
      const created = await this.edgeModel.create({ id: edge.id, source, target, reactEdge: { id: edge.id, source: edge.source, target: edge.target } });
      edgeIds.push(toObjectId(created._id));
    }

    const nodeIds = prepared.map((n) => nodeDbIdByClientId.get(n.clientId)!).filter(Boolean);

    if (existing) {
      // Deliberately no node deletion here: a node missing from this tree may
      // have migrated to another tree in the same save, which has not
      // necessarily been reconciled yet. `saveWorkflows` deletes globally once
      // every tree has claimed its nodes.
      await this.workflowModel.findByIdAndUpdate(existing._id, { $set: { nodes: nodeIds, edges: edgeIds, name: input.name ?? existing.name } }).exec();
      return { workflowId: toObjectId(existing._id), nodeIds };
    }

    const created = await this.workflowModel.create({
      name: input.name ?? `Workflow-${prepared[0]?.clientId ?? ''}`,
      nodes: nodeIds,
      edges: edgeIds,
      state: WorkflowState.QUEUED
    });
    return { workflowId: toObjectId(created._id), nodeIds };
  }

  /**
   * Drop a workflow and its edges. Nodes are left alone on purpose — a workflow
   * disappears whenever trees are re-partitioned (an added edge merging two into
   * one), and its nodes are usually alive in the tree that absorbed them.
   * `saveWorkflows` deletes the genuinely removed ones globally.
   */
  private async deleteWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.workflowModel.findById(workflowId).exec();
    if (!workflow) return;
    await this.edgeModel.deleteMany({ _id: { $in: (workflow.edges ?? []).map((e: any) => String(e)) } }).exec();
    await this.workflowModel.findByIdAndDelete(workflowId).exec();
  }
}
