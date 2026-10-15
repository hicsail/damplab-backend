import { BadRequestException, Injectable, PipeTransform, Scope, Inject } from '@nestjs/common';
import { ID, Field, InputType, OmitType } from '@nestjs/graphql';
import { WorkflowNode, WorkflowNodeState } from '../models/node.model';
import { DampLabServices } from '../../services/damplab-services.services';
import { buildParameterSnapshot } from '../utils/parameter-snapshot.util';
import { getMultiValueParamIds, normalizeFormDataToArray } from '../utils/form-data.util';
import { calculateServiceCost, CustomerCategory } from '../../pricing/service-pricing.util';
import { REQUEST } from '@nestjs/core';
import { deriveCustomerCategory } from '../../pricing/pricing-groups';
import { foreignFileKey } from '../utils/sample-sheet.util';
import { withoutHiddenAnswers } from '../../services/parameter-conditions';

// parameterSnapshot is server-written and an object type: exposing it on an input would both let clients forge it and fail schema generation.
@InputType()
export class AddNodeInput extends OmitType(WorkflowNode, ['_id', 'service', 'state', 'parameterSnapshot'] as const, InputType) {
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
    // An answer to a hidden parameter is dropped here, before pricing and storing:
    // the client is not trusted to have left it out.
    const formData = withoutHiddenAnswers(service.parameters, normalizeFormDataToArray(value.formData, multiValueParamIds));
    // A file or Table answer may only name a storage key this caller uploaded.
    // The node resolver presigns a download for every stored key, so a key that
    // is someone else's must be refused here, before it is read or stored.
    // After the hidden strip: a hidden answer is dropped, not refused.
    //
    // In a request-scoped GraphQL provider REQUEST is the GraphQL context
    // ({ req }), and the auth guard writes the caller onto that req — pinned on
    // a real request by add-node.input.wiring.spec.ts. The category derivation
    // further down reads `this.request?.user`, which is a different question
    // with its own history; it is deliberately not touched here.
    const caller = this.request?.req?.user;
    if (foreignFileKey(service.parameters, formData, caller?.sub) !== null) {
      const operation = typeof value.label === 'string' && value.label.trim() !== '' ? value.label : service.name;
      throw new BadRequestException(`The file on "${operation}" was not uploaded by you. Upload it again and retry.`);
    }
    // Prices from the **requesting user's** Keycloak identity, which is right at
    // checkout (the customer is the requester) and wrong whenever staff act on a
    // customer's job — a technician adding a node would stamp it at the staff tier.
    //
    // Deliberately left as-is rather than resolved through the Admin API, for two
    // reasons. The requester is still the wrong identity even when resolved
    // perfectly, so it would buy accuracy for a question nobody should be asking;
    // and it would cost a Keycloak round trip per node on every canvas edit.
    //
    // What makes that acceptable is that **`job.customerCategory` is the authority**
    // and `node.price` is only a fallback: `SOWService.transformServices` reprices
    // every line from the catalog against the job's category, and reaches for the
    // stored node price solely when the catalog can price the service at all
    // (see the `fallbackLineCost` path in `calculateServiceCostBreakdown`).
    //
    // Two specs pin that, at two levels: `pricing/node-price-fallback.spec.ts`
    // pins the boundary itself — the catalog wins, the stored figure is reached
    // only when the catalog can say nothing — and
    // `test/integration/sow-customer-category.spec.ts` pins that the SOW actually
    // reprices through it end to end. `job-version.dto.ts` carries the same note.
    //
    // Revisit only if a case appears where `node.price` is billed directly.
    const roles: string[] = this.request?.user?.realm_access?.roles ?? [];
    const groups: string[] = this.request?.user?.groups ?? [];
    const category: CustomerCategory | undefined = deriveCustomerCategory([...roles, ...groups]);
    const price = calculateServiceCost(service, formData, value.price, category);
    return { ...value, formData, service, state: WorkflowNodeState.QUEUED, price, parameterSnapshot: buildParameterSnapshot(service, formData) };
  }
}
