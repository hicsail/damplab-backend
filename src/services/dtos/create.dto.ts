import { ID, InputType, Field, OmitType } from '@nestjs/graphql';
import { DampLabService } from '../models/damplab-service.model';

@InputType()
export class CreateService extends OmitType(DampLabService, ['_id', 'allowedConnections'] as const, InputType) {
  @Field(() => [ID])
  allowedConnections: string[];
}
