import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * Lightweight job context for a WorkflowNode, exposed via the WorkflowNode.job
 * resolve field. Deliberately NOT the full Job type — that would create a
 * Node → Job → Workflow → Node GraphQL/import cycle. The technician bench view
 * only needs enough to label the operation and scope per-operation notes.
 */
@ObjectType({ description: 'Minimal parent-job context for a workflow node (technician bench view).' })
export class WorkflowNodeJob {
  @Field(() => ID, { description: 'Job database id (used to scope comments/notes + link to the job view).' })
  id: string;

  @Field({ nullable: true, description: 'Human-readable job name.' })
  name?: string;

  @Field({ nullable: true, description: 'Customer-facing 5-digit job number.' })
  jobId?: string;
}
