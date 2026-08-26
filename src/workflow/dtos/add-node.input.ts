import { BadRequestException, Injectable, PipeTransform, Scope, Inject } from '@nestjs/common';
import { ID, Field, InputType, OmitType } from '@nestjs/graphql';
import { WorkflowNode, WorkflowNodeState } from '../models/node.model';
import { DampLabServices } from '../../services/damplab-services.services';
import { getMultiValueParamIds, normalizeFormDataToArray } from '../utils/form-data.util';
import { calculateServiceCost, CustomerCategory } from '../../pricing/service-pricing.util';
import { REQUEST } from '@nestjs/core';
import { deriveCustomerCategory } from '../../pricing/pricing-groups';

@InputType()
export class AddNodeInput extends OmitType(WorkflowNode, ['_id', 'service', 'state'] as const, InputType) {
  @Field(() => ID, { description: 'The ID of the service this node is a part of' })
  serviceId: string;
}

export type AddNodeInputFull = Omit<WorkflowNode, '_id'>;

@Injectable({ scope: Scope.REQUEST })
export class AddNodeInputPipe implements PipeTransform<AddNodeInput, Promise<AddNodeInputFull>> {
  constructor(private readonly dampLabServices: DampLabServices, @Inject(REQUEST) private readonly request: any) {}

  async transform(value: AddNodeInput): Promise<AddNodeInputFull> {
    const service = await this.dampLabServices.findOneActive(value.serviceId);
    if (!service) {
      throw new BadRequestException(`DampLabService with ID ${value.serviceId} does not exist or is deleted`);
    }
    const multiValueParamIds = getMultiValueParamIds(service.parameters);
    const formData = normalizeFormDataToArray(value.formData, multiValueParamIds);
    const roles: string[] = this.request?.user?.realm_access?.roles ?? [];
    const groups: string[] = this.request?.user?.groups ?? [];
    const category: CustomerCategory | undefined = deriveCustomerCategory([...roles, ...groups]);
    const price = calculateServiceCost(service, formData, value.price, category);
    return { ...value, formData, service, state: WorkflowNodeState.QUEUED, price };
  }
}
