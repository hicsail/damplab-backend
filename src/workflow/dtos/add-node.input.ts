import { Injectable, PipeTransform } from '@nestjs/common';
import { ID, Field, InputType, OmitType } from '@nestjs/graphql';
import { WorkflowNode, WorkflowNodeState } from '../models/node.model';
import { DampLabServicePipe } from '../../services/damplab-services.pipe';
import { getMultiValueParamIds, normalizeFormDataToArray } from '../utils/form-data.util';
import { calculateServiceCost } from '../../pricing/service-pricing.util';

@InputType()
export class AddNodeInput extends OmitType(WorkflowNode, ['_id', 'service', 'state'] as const, InputType) {
  @Field(() => ID, { description: 'The ID of the service this node is a part of' })
  serviceId: string;
}

export type AddNodeInputFull = Omit<WorkflowNode, '_id'>;

@Injectable()
export class AddNodeInputPipe implements PipeTransform<AddNodeInput, Promise<AddNodeInputFull>> {
  constructor(private readonly dampLabServicePipe: DampLabServicePipe) {}

  async transform(value: AddNodeInput): Promise<AddNodeInputFull> {
    const service = await this.dampLabServicePipe.transform(value.serviceId);
    const multiValueParamIds = getMultiValueParamIds(service.parameters);
    const formData = normalizeFormDataToArray(value.formData, multiValueParamIds);
    const price = calculateServiceCost(service, formData, value.price);
    return { ...value, formData, service, state: WorkflowNodeState.QUEUED, price };
  }
}
