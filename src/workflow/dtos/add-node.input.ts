import { Injectable, PipeTransform } from '@nestjs/common';
import { ID, Field, InputType, OmitType } from '@nestjs/graphql';
import { WorkflowNode } from '../models/node.model';
import { DampLabServicePipe } from '../../services/damplab-services.pipe';

@InputType()
export class AddNodeInput extends OmitType(WorkflowNode, ['_id', 'service'] as const, InputType) {
  @Field(() => ID, { description: 'The ID of the service this node is a part of' })
  serviceId: string;
}

export type AddNodeInputFull = Omit<WorkflowNode, '_id'>;

@Injectable()
export class AddNodeInputPipe implements PipeTransform<AddNodeInput, Promise<AddNodeInputFull>> {
  constructor(private readonly dampLabServicePipe: DampLabServicePipe) {}

  async transform(value: AddNodeInput): Promise<AddNodeInputFull> {
    const service = await this.dampLabServicePipe.transform(value.serviceId);
    return { ...value, service };
  }
}
