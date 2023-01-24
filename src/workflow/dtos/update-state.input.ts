import { ID, Field, InputType } from '@nestjs/graphql';
import { Workflow, WorkflowState } from '../models/workflow.model';
import { Injectable, PipeTransform } from '@nestjs/common';
import { WorkflowPipe } from '../workflow.pipe';

/** DTO for updating the state of a workflow */
@InputType()
export class UpdateWorkflowState {
  /** The workflow to update the state of */
  @Field(() => ID)
  workflowId: string;

  /** The state to update */
  @Field(() => WorkflowState)
  state: WorkflowState;
}

/** UpdateWorkflowState with the workflow populated */
export interface UpdateWorkflowStateFull {
  workflow: Workflow;
  state: WorkflowState;
}

/** Pipe for transforming UpdateWorkflowState to UpdateWorkflowStateFull */
@Injectable()
export class UpdateWorkflowStatePipe implements PipeTransform<UpdateWorkflowState, Promise<UpdateWorkflowStateFull>> {
  constructor(private readonly workflowPipe: WorkflowPipe) {}

  async transform(value: UpdateWorkflowState): Promise<UpdateWorkflowStateFull> {
    const workflow = await this.workflowPipe.transform(value.workflowId);
    return { workflow, state: value.state };
  }
}
