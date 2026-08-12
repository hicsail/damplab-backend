import { Field, InputType, Int } from '@nestjs/graphql';
import { SowFieldKind } from '../sow-version.model';

@InputType()
export class SignSowInput {
  @Field(() => Int, { description: 'Version the signer is looking at. Rejected if it is no longer the one in force, so nobody signs a superseded document.' })
  versionNumber: number;

  @Field({ description: 'Typed full name, which is the signature under the new flow' })
  name: string;

  @Field(() => [SowFieldKind], {
    description: 'Which groups of sections the signer ticked: the calculated figures, the standard prose, and any custom sections. Every group present in the document must be acknowledged.'
  })
  consentedGroups: SowFieldKind[];
}
