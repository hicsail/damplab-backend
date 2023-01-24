import { Workflow } from "./models/workflow.model";
import { Injectable, BadRequestException, PipeTransform } from '@nestjs/common';
import { WorkflowService } from './workflow.service';

@Injectable()
export class WorkflowPipe implements PipeTransform<string, Promise<Workflow>> {
  constructor(private readonly workflowService: WorkflowService) {}

  async transform(value: string): Promise<Workflow> {
    try {
      const workflow = await this.workflowService.findOne(value);
      if (workflow) {
        return workflow;
      }
    } catch (e) {}

    throw new BadRequestException(`Workflow with ID ${value} does not exist`);
  }
}
