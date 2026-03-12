import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType({ description: 'Staff member option for lab monitor card assignment' })
export class LabMonitorStaffMember {
  @Field({ description: 'Identifier (e.g. Keycloak sub or username)' })
  id: string;

  @Field({ description: 'Display name for the assignee dropdown' })
  displayName: string;
}
