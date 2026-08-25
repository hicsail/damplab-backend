import { gql, gqlError, ActorName, TestApp } from './harness';

/**
 * The operations the job/SOW journey is made of, in one place, so a test reads
 * as a sequence of business steps rather than a wall of GraphQL.
 */

export const SOW_VERSION_FIELDS = `
  id
  versionNumber
  status
  visibleToCustomer
  note
  createdByName
  fields { key label kind order value isEnabled requiresInitials allowsEmpty }
  inputs {
    projectManager
    projectLead
    sowTitle
    scopeOfWork
    deliverables
    periods { startDate durationDays label }
    services { serviceId name description cost }
    adjustments { type description amount unitAmount multiplier category reason }
  }
  clientSignature { name signedAt }
  staffSignature { name signedAt }
`;

export const ACTION_GATE = `
  canSend
  sendBlockers
  canSign
  signBlockers
  canCountersign
  countersignBlockers
  missingFields
`;

export interface SowSnapshot {
  id: string;
  sowNumber: string;
  status: string;
  currentVersionNumber: number;
  activeVersionNumber: number;
  currentVersion: any;
  activeVersion: any;
  actionGate: any;
}

export async function createJob(ctx: TestApp, actor: ActorName, workflows: Record<string, unknown>[], name = 'Integration Job'): Promise<{ id: string; state: string; jobId: string | null }> {
  const data = await gql(
    ctx,
    actor,
    `mutation ($input: CreateJobInput!) {
      createJob(createJobInput: $input) { id jobId name state }
    }`,
    { input: { name, institute: 'Boston University', notes: 'Submitted by the integration suite', workflows } }
  );
  return data.createJob;
}

export async function reviewJob(ctx: TestApp, actor: ActorName, jobId: string, decision: string, operationId: string, message?: string): Promise<any> {
  const data = await gql(ctx, actor, `mutation ($input: ReviewJobInput!) { reviewJob(input: $input) { id state customerActionRequired } }`, { input: { operationId, jobId, decision, message } });
  return data.reviewJob;
}

export async function reviewJobError(ctx: TestApp, actor: ActorName, jobId: string, decision: string, operationId: string, message?: string): Promise<string> {
  return gqlError(ctx, actor, `mutation ($input: ReviewJobInput!) { reviewJob(input: $input) { id state } }`, { input: { operationId, jobId, decision, message } });
}

export async function jobState(ctx: TestApp, actor: ActorName, jobId: string): Promise<any> {
  const data = await gql(ctx, actor, `query ($id: ID!) { jobById(id: $id) { id state customerActionRequired latestContentVersionNumber } }`, { id: jobId });
  return data.jobById;
}

export async function createSowForJob(ctx: TestApp, actor: ActorName, jobId: string): Promise<{ id: string; sowNumber: string; status: string }> {
  const data = await gql(ctx, actor, `mutation ($jobId: ID!) { createSowForJob(jobId: $jobId) { id sowNumber status } }`, { jobId });
  return data.createSowForJob;
}

export async function readSow(ctx: TestApp, actor: ActorName, sowId: string, expectedSignVersionNumber?: number): Promise<SowSnapshot> {
  const data = await gql(
    ctx,
    actor,
    `query ($id: ID!, $expected: Int) {
      sowById(id: $id) {
        id
        sowNumber
        status
        currentVersionNumber
        activeVersionNumber
        currentVersion { ${SOW_VERSION_FIELDS} }
        activeVersion { ${SOW_VERSION_FIELDS} }
        actionGate(expectedSignVersionNumber: $expected) { ${ACTION_GATE} }
      }
    }`,
    { id: sowId, expected: expectedSignVersionNumber ?? null }
  );
  return data.sowById;
}

/**
 * Saves the loaded version back with edits applied, the way the editor does:
 * every field round-trips, and `fill` supplies text for the ones staff still
 * have to write. Passing the loaded `baseVersionNumber` is what makes a stale
 * editor lose the conflict check rather than overwrite a colleague.
 */
export async function saveSowVersion(
  ctx: TestApp,
  actor: ActorName,
  sowId: string,
  version: any,
  opts: { note?: string; fill?: string; baseVersionNumber?: number; inputs?: Record<string, unknown>; refreshFeeSchedule?: boolean } = {}
): Promise<any> {
  const fill = opts.fill ?? 'Written by the integration suite.';
  const fields = version.fields.map((field: any) => ({
    key: field.key,
    label: field.label,
    value: field.value || (field.allowsEmpty ? field.value : fill),
    isEnabled: field.isEnabled,
    requiresInitials: field.requiresInitials
  }));

  const inputs = {
    projectManager: version.inputs.projectManager || 'Tess Technician',
    projectLead: version.inputs.projectLead || 'Lee Lead',
    sowTitle: version.inputs.sowTitle,
    scopeOfWork: version.inputs.scopeOfWork,
    deliverables: version.inputs.deliverables,
    periods: (version.inputs.periods ?? []).map((p: any) => ({ startDate: p.startDate, durationDays: p.durationDays, label: p.label })),
    services: (version.inputs.services ?? []).map((s: any) => ({ serviceId: s.serviceId, name: s.name, description: s.description, cost: s.cost })),
    adjustments: (version.inputs.adjustments ?? []).map((a: any) => ({
      type: a.type,
      description: a.description,
      amount: a.amount,
      unitAmount: a.unitAmount,
      multiplier: a.multiplier,
      category: a.category,
      reason: a.reason
    })),
    ...(opts.inputs ?? {})
  };

  const data = await gql(ctx, actor, `mutation ($sowId: ID!, $input: SaveSowVersionInput!) { saveSowVersion(sowId: $sowId, input: $input) { ${SOW_VERSION_FIELDS} } }`, {
    sowId,
    input: {
      baseVersionNumber: opts.baseVersionNumber ?? version.versionNumber,
      fields,
      inputs,
      note: opts.note ?? 'Filled in by the integration suite',
      refreshFeeSchedule: opts.refreshFeeSchedule ?? false
    }
  });
  return data.saveSowVersion;
}

export async function sendSowToCustomer(ctx: TestApp, actor: ActorName, sowId: string): Promise<any> {
  const data = await gql(ctx, actor, `mutation ($sowId: ID!) { sendSowToCustomer(sowId: $sowId) { ${SOW_VERSION_FIELDS} } }`, { sowId });
  return data.sendSowToCustomer;
}

export async function sendSowToCustomerError(ctx: TestApp, actor: ActorName, sowId: string): Promise<string> {
  return gqlError(ctx, actor, `mutation ($sowId: ID!) { sendSowToCustomer(sowId: $sowId) { versionNumber } }`, { sowId });
}

/** Consents to every group the document actually contains, and initials whatever staff flagged. */
export function signatureFor(version: any, name: string): Record<string, unknown> {
  const enabled = version.fields.filter((f: any) => f.isEnabled);
  return {
    versionNumber: version.versionNumber,
    name,
    consentedGroups: [...new Set(enabled.map((f: any) => f.kind))],
    sectionInitials: enabled.filter((f: any) => f.requiresInitials).map((f: any) => ({ key: f.key, initials: 'CC' }))
  };
}

export async function signSow(ctx: TestApp, actor: ActorName, sowId: string, input: Record<string, unknown>): Promise<any> {
  const data = await gql(ctx, actor, `mutation ($sowId: ID!, $input: SignSowInput!) { signSow(sowId: $sowId, input: $input) { ${SOW_VERSION_FIELDS} } }`, { sowId, input });
  return data.signSow;
}

export async function signSowError(ctx: TestApp, actor: ActorName, sowId: string, input: Record<string, unknown>): Promise<string> {
  return gqlError(ctx, actor, `mutation ($sowId: ID!, $input: SignSowInput!) { signSow(sowId: $sowId, input: $input) { versionNumber } }`, { sowId, input });
}

export async function finalizeSow(ctx: TestApp, actor: ActorName, sowId: string, name: string): Promise<any> {
  const data = await gql(ctx, actor, `mutation ($sowId: ID!, $name: String!) { finalizeSow(sowId: $sowId, name: $name) { ${SOW_VERSION_FIELDS} } }`, { sowId, name });
  return data.finalizeSow;
}

export async function finalizeSowError(ctx: TestApp, actor: ActorName, sowId: string, name: string): Promise<string> {
  return gqlError(ctx, actor, `mutation ($sowId: ID!, $name: String!) { finalizeSow(sowId: $sowId, name: $name) { versionNumber } }`, { sowId, name });
}

export async function withdrawSowFromCustomer(ctx: TestApp, actor: ActorName, sowId: string, reason: string): Promise<any> {
  const data = await gql(ctx, actor, `mutation ($sowId: ID!, $reason: String!) { withdrawSowFromCustomer(sowId: $sowId, reason: $reason) { id status currentVersionNumber activeVersionNumber } }`, {
    sowId,
    reason
  });
  return data.withdrawSowFromCustomer;
}

export async function sowVersions(ctx: TestApp, actor: ActorName, sowId: string): Promise<any[]> {
  const data = await gql(ctx, actor, `query ($sowId: ID!) { sowVersions(sowId: $sowId) { versionNumber status note visibleToCustomer createdByName } }`, { sowId });
  return data.sowVersions;
}

export async function jobVersions(ctx: TestApp, actor: ActorName, jobId: string): Promise<any[]> {
  const data = await gql(ctx, actor, `query ($id: ID!) { jobById(id: $id) { versions { versionNumber authorRole note isEvent visibleToCustomer } } }`, { id: jobId });
  return data.jobById.versions;
}

/** How many SOWs exist for a job — the check a unique index is supposed to make unnecessary. */
export async function sowCount(ctx: TestApp, jobId: string): Promise<number> {
  const data = await gql(ctx, 'staff', `query { allSOWs { id jobId } }`);
  return data.allSOWs.filter((s: any) => s.jobId === jobId).length;
}

/** Replaces the job's graph from the workflow editor. */
export async function saveJobWorkflows(ctx: TestApp, actor: ActorName, jobId: string, workflows: Record<string, unknown>[], note: string): Promise<any> {
  const data = await gql(ctx, actor, `mutation ($input: SaveJobWorkflowsInput!) { saveJobWorkflows(input: $input) { id state } }`, { input: { jobId, note, workflows } });
  return data.saveJobWorkflows;
}

/** The editor's shape for a graph, as distinct from the submission shape in workflowInput. */
export function editorWorkflow(serviceId: string, nodeIds: string[], name = 'Workflow A'): Record<string, unknown> {
  return {
    name,
    nodes: nodeIds.map((id) => ({ id, label: 'PCR', serviceId, formData: [], additionalInstructions: '', position: { x: 0, y: 0 } })),
    edges: []
  };
}

/** Staff-only; moves the job to a different price list. Does not go through the contract-writable guard. */
export async function changeJobCustomerCategory(ctx: TestApp, actor: ActorName, jobId: string, customerCategory: string): Promise<any> {
  const data = await gql(ctx, actor, `mutation ($jobId: ID!, $c: CustomerCategory!) { changeJobCustomerCategory(jobId: $jobId, customerCategory: $c) { id customerCategory } }`, {
    jobId,
    c: customerCategory
  });
  return data.changeJobCustomerCategory;
}

export async function saveJobWorkflowsError(ctx: TestApp, actor: ActorName, jobId: string, workflows: Record<string, unknown>[], note: string): Promise<string> {
  return gqlError(ctx, actor, `mutation ($input: SaveJobWorkflowsInput!) { saveJobWorkflows(input: $input) { id } }`, { input: { jobId, note, workflows } });
}
