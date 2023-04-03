import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import {WorkflowNode} from './models/node.model';
import {WorkflowNodeService} from './services/node.service';

@Injectable()
export class WorkflowNodePipe implements PipeTransform<string, Promise<WorkflowNode>> {
  constructor(private readonly nodeService: WorkflowNodeService) {}

  async transform(value: string): Promise<WorkflowNode> {
    try {
      const node = await this.nodeService.getByID(value);
      if (node) {
        return node;
      }
    } catch (e) {}

    throw new BadRequestException(`WorkflowNode with ID ${value} does not exist`);
  }
}
