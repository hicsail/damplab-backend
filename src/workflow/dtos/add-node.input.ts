import { Injectable, PipeTransform, Scope, Inject } from '@nestjs/common';
import { ID, Field, InputType, OmitType } from '@nestjs/graphql';
import { WorkflowNode, WorkflowNodeState } from '../models/node.model';
import { DampLabServicePipe } from '../../services/damplab-services.pipe';
import { getMultiValueParamIds, normalizeFormDataToArray } from '../utils/form-data.util';
import { calculateServiceCost, CustomerCategory } from '../../pricing/service-pricing.util';
import { REQUEST } from '@nestjs/core';
import { Role } from '../../auth/roles/roles.enum';

@InputType()
export class AddNodeInput extends OmitType(WorkflowNode, ['_id', 'service', 'state'] as const, InputType) {
  @Field(() => ID, { description: 'The ID of the service this node is a part of' })
  serviceId: string;
}

export type AddNodeInputFull = Omit<WorkflowNode, '_id'>;

@Injectable({ scope: Scope.REQUEST })
export class AddNodeInputPipe implements PipeTransform<AddNodeInput, Promise<AddNodeInputFull>> {
  constructor(
    private readonly dampLabServicePipe: DampLabServicePipe,
    @Inject(REQUEST) private readonly request: any
  ) {}

  async transform(value: AddNodeInput): Promise<AddNodeInputFull> {
    const service = await this.dampLabServicePipe.transform(value.serviceId);
    const multiValueParamIds = getMultiValueParamIds(service.parameters);
    const formData = normalizeFormDataToArray(value.formData, multiValueParamIds);
    const roles: string[] = this.request?.user?.realm_access?.roles ?? [];
    const groups: string[] = this.request?.user?.groups ?? [];
    const claims = [...roles, ...groups];
    const hasGroup = (groupName: string) =>
      claims.some((entry) => entry === groupName || entry.endsWith(`/${groupName}`));
    const category: CustomerCategory | undefined = hasGroup(Role.InternalCustomers) || hasGroup(Role.InternalCustomer)
      ? 'INTERNAL_CUSTOMERS'
      : hasGroup(Role.ExternalCustomerAcademic)
        ? 'EXTERNAL_CUSTOMER_ACADEMIC'
        : hasGroup(Role.ExternalCustomerMarket)
          ? 'EXTERNAL_CUSTOMER_MARKET'
          : hasGroup(Role.ExternalCustomerNoSalary)
            ? 'EXTERNAL_CUSTOMER_NO_SALARY'
            : hasGroup(Role.ExternalCustomer)
              ? 'EXTERNAL_CUSTOMER_MARKET'
              : undefined;
    const price = calculateServiceCost(service, formData, value.price, category);
    return { ...value, formData, service, state: WorkflowNodeState.QUEUED, price };
  }
}
