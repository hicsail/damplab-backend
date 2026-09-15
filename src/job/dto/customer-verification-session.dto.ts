import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'A freshly minted Aclid hosted-KYC session. The customer completes verification at `url` and is sent back to the job page.' })
export class CustomerVerificationSession {
  @Field(() => String, { description: "Aclid's hosted verification page for this job's screen. Minted per request; open it rather than storing it." })
  url: string;
}
