import { Field, ID, InputType, Float } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

/**
 * Input for `saveJobWorkflows`.
 *
 * Deliberately *not* reusing AddWorkflowInput/AddNodeInput. Those run through
 * AddNodeInputPipe, which prices a node from the *requesting user's* Keycloak
 * category — correct at checkout, wrong here, where a technician editing a
 * customer's job must price at the customer's category. Repricing therefore
 * happens in JobVersionService against `job.customerCategory`.
 *
 * Every field a caller may write is named explicitly. Nothing is spread onto a
 * live document, so UI-only flags (ghost, locked, diffKind) cannot persist even
 * if the client sends them.
 */

@InputType({ description: 'Canvas coordinates of a node' })
export class SaveNodePositionInput {
  @Field(() => Float)
  x: number;

  @Field(() => Float)
  y: number;
}

@InputType({ description: 'One node in a saved workflow graph' })
export class SaveNodeInput {
  @Field(() => ID, { description: 'React Flow client-side node id. Stable across edits; new nodes bring a new one.' })
  id: string;

  @Field({ description: 'Human readable name of the service' })
  label: string;

  @Field(() => ID, { description: 'The DampLabService this node represents' })
  serviceId: string;

  @Field(() => JSON, { nullable: true, description: 'Parameter values; accepted as [{ id, value }] or an object keyed by param id' })
  formData?: any;

  @Field({ nullable: true, defaultValue: '' })
  additionalInstructions?: string;

  @Field(() => SaveNodePositionInput, { nullable: true, description: 'Canvas position, persisted into reactNode so the graph reopens where the author left it' })
  position?: SaveNodePositionInput;
}

@InputType({ description: 'One edge in a saved workflow graph' })
export class SaveEdgeInput {
  @Field(() => ID)
  id: string;

  @Field(() => ID, { description: 'Client-side id of the source node' })
  source: string;

  @Field(() => ID, { description: 'Client-side id of the target node' })
  target: string;
}

@InputType({ description: 'One disconnected tree on the canvas' })
export class SaveWorkflowInput {
  @Field(() => ID, { nullable: true, description: 'Existing Workflow to reconcile against. Omit for a tree created by this edit.' })
  workflowId?: string;

  @Field({ nullable: true, description: 'Workflow name; the existing name is kept when omitted' })
  name?: string;

  @Field(() => [SaveNodeInput])
  nodes: SaveNodeInput[];

  @Field(() => [SaveEdgeInput])
  edges: SaveEdgeInput[];
}

@InputType({ description: "Replace a job's workflow graph and record the result as a new version" })
export class SaveJobWorkflowsInput {
  @Field(() => ID)
  jobId: string;

  /**
   * Required on the way in, but `JobVersion.note` stays nullable on the way out:
   * versions written before this was enforced, and the v1 backfill synthesised
   * for pre-versioning jobs, both legitimately have no author-written note.
   */
  @Field({ description: 'Note describing what changed. Required — the history is unreadable without it.' })
  note: string;

  @Field(() => [SaveWorkflowInput], { description: 'The complete graph. Anything absent is deleted.' })
  workflows: SaveWorkflowInput[];
}
