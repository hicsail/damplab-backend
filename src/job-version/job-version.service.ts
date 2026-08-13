import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import mongoose, { HydratedDocument, Model } from 'mongoose';
import { JobVersion, JobVersionAuthorRole, JobVersionDocument, JobVersionEdge, JobVersionNode, JobVersionWorkflow } from './job-version.model';
import { SaveJobWorkflowsInput, SaveWorkflowInput } from './job-version.dto';
import { Job, JobDocument } from '../job/job.model';
import { Workflow, WorkflowDocument, WorkflowState } from '../workflow/models/workflow.model';
import { WorkflowNode, WorkflowNodeDocument, WorkflowNodeState } from '../workflow/models/node.model';
import { WorkflowEdge, WorkflowEdgeDocument } from '../workflow/models/edge.model';
import { DampLabServices } from '../services/damplab-services.services';
import { getMultiValueParamIds, normalizeFormDataToArray } from '../workflow/utils/form-data.util';
import { calculateServiceCost, CustomerCategory, RUN_COUNT_PARAM_ID } from '../pricing/service-pricing.util';

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

/** True for a value that carries no information: never counted as an edit. */
function isEmptyParamValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true;
  if (Array.isArray(value)) return value.every((v) => v === null || v === undefined || v === '');
  return false;
}

function paramValuesById(formData: unknown): Map<string, unknown> {
  const byId = new Map<string, unknown>();
  const entries = Array.isArray(formData) ? formData : [];
  for (const entry of entries) {
    if (entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string') {
      byId.set((entry as { id: string }).id, (entry as { value?: unknown }).value ?? null);
    }
  }
  // An absent run count means one run — that is how pricing reads it — so a
  // stored node from before the universal run-count entry existed must compare
  // equal to an editor payload that spells the default out.
  if (!byId.has(RUN_COUNT_PARAM_ID)) byId.set(RUN_COUNT_PARAM_ID, 1);
  return byId;
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
    // A number typed into a text field arrives as a string; "10" and 10 are the
    // same parameter value and must not read as an edit.
    if (String(beforeValue) === String(afterValue)) continue;
    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) return true;
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
   * Returns null when nothing below it was written by the other side.
   */
  static baselineFor(versions: Pick<JobVersion, 'versionNumber' | 'authorRole'>[], versionNumber: number): number | null {
    const current = versions.find((v) => v.versionNumber === versionNumber);
    if (!current) return null;

    const earlierByOtherSide = versions.filter((v) => v.versionNumber < versionNumber && v.authorRole !== current.authorRole).sort((a, b) => b.versionNumber - a.versionNumber);

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
        createdAt: job.submitted ?? new Date()
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
    meta: { authorRole: JobVersionAuthorRole; createdBy: string; createdByName: string; note?: string; createdAt?: Date }
  ): Promise<JobVersion> {
    const jobId = String(job._id);
    const highest = await this.versionModel.findOne({ jobId }).sort({ versionNumber: -1 }).exec();
    const versionNumber = (highest?.versionNumber ?? 0) + 1;

    return this.versionModel.create({
      job: new mongoose.Types.ObjectId(jobId),
      jobId,
      versionNumber,
      authorRole: meta.authorRole,
      workflows,
      note: meta.note,
      createdBy: meta.createdBy,
      createdByName: meta.createdByName,
      createdAt: meta.createdAt ?? new Date()
    });
  }

  /**
   * Replace a job's workflow graph and record the result as a new version.
   *
   * Live documents are reconciled node by node rather than rebuilt, so a node
   * that is already assigned, started or holding inventory keeps all of it.
   */
  async saveWorkflows(input: SaveJobWorkflowsInput, author: { role: JobVersionAuthorRole; sub: string; name: string }): Promise<Job> {
    const job = await this.jobModel.findById(input.jobId).exec();
    if (!job) throw new NotFoundException(`Job with ID ${input.jobId} not found`);

    const liveNodes = await this.loadLiveNodes(job);

    // Prepared first, deliberately: it resolves each node against the catalogue
    // and normalizes formData, so the guard below compares like with like. It
    // only reads, so nothing is written if the guard then rejects.
    const prepared = await this.prepareWorkflows(input.workflows, job.customerCategory as CustomerCategory | undefined);
    this.assertWorkInFlightUntouched(liveNodes, prepared);

    const workflowIds: mongoose.Types.ObjectId[] = [];
    for (let i = 0; i < input.workflows.length; i++) {
      const id = await this.reconcileWorkflow(input.workflows[i], prepared[i], liveNodes);
      workflowIds.push(id);
    }

    // Workflows the edit emptied or removed entirely.
    const keptIds = new Set(workflowIds.map(String));
    for (const ref of job.workflows ?? []) {
      if (keptIds.has(String(ref))) continue;
      await this.deleteWorkflow(String(ref));
    }

    await this.jobModel.findByIdAndUpdate(job._id, { $set: { workflows: workflowIds } }).exec();

    const refreshed = await this.jobModel.findById(job._id).exec();
    const snapshot = await this.snapshotLiveWorkflows(refreshed!);
    await this.appendVersion(refreshed!, snapshot, {
      authorRole: author.role,
      createdBy: author.sub,
      createdByName: author.name,
      note: input.note
    });

    return refreshed!;
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
  private async reconcileWorkflow(input: SaveWorkflowInput, prepared: PreparedNode[], liveNodes: Map<string, LiveNode>): Promise<mongoose.Types.ObjectId> {
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
      // Nodes dropped from this tree. Nodes that merely moved to another tree in
      // the same save are spared — they are still referenced somewhere.
      const stillHere = new Set(nodeIds.map(String));
      const orphaned = (existing.nodes ?? []).map((n: any) => String(n)).filter((id) => !stillHere.has(id));
      if (orphaned.length) await this.nodeModel.deleteMany({ _id: { $in: orphaned } }).exec();

      await this.workflowModel.findByIdAndUpdate(existing._id, { $set: { nodes: nodeIds, edges: edgeIds, name: input.name ?? existing.name } }).exec();
      return toObjectId(existing._id);
    }

    const created = await this.workflowModel.create({
      name: input.name ?? `Workflow-${prepared[0]?.clientId ?? ''}`,
      nodes: nodeIds,
      edges: edgeIds,
      state: WorkflowState.QUEUED
    });
    return toObjectId(created._id);
  }

  private async deleteWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.workflowModel.findById(workflowId).exec();
    if (!workflow) return;
    await this.nodeModel.deleteMany({ _id: { $in: (workflow.nodes ?? []).map((n: any) => String(n)) } }).exec();
    await this.edgeModel.deleteMany({ _id: { $in: (workflow.edges ?? []).map((e: any) => String(e)) } }).exec();
    await this.workflowModel.findByIdAndDelete(workflowId).exec();
  }
}
