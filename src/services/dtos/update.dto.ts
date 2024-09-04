import { DampLabService } from '../models/damplab-service.model';
import { ID, InputType, OmitType, PartialType, Field } from '@nestjs/graphql';

@InputType()
export class ServiceChange extends PartialType(OmitType(DampLabService, ['_id', 'allowedConnections'] as const), InputType) {
  @Field(() => [ID], { nullable: true })
  allowedConnections: string[];
}
