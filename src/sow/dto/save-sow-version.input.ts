import { Field, InputType, Int } from '@nestjs/graphql';
import { SowInputsInput } from './sow-inputs.input';

@InputType()
export class SowFieldInput {
  @Field({ description: 'Catalogue key, or "custom-<uuid>" for a staff-added section' })
  key: string;

  @Field({ nullable: true, description: 'Only honoured for custom sections; catalogue labels are fixed' })
  label?: string;

  @Field({ nullable: true, defaultValue: '' })
  value?: string;

  @Field({ nullable: true, defaultValue: true, description: 'False hides the section from the customer, the PDF and consent, without discarding its text' })
  isEnabled?: boolean;

  @Field({ nullable: true, defaultValue: false, description: 'Staff flag: when true, the customer must type their initials for this section before they can sign' })
  requiresInitials?: boolean;
}

@InputType()
export class SaveSowVersionInput {
  @Field(() => Int, {
    description:
      'The version the editor loaded. If the SOW has moved on since, the save is rejected rather than silently overwriting a colleague — see the conflict handling in SowVersionService.saveVersion.'
  })
  baseVersionNumber: number;

  @Field(() => [SowFieldInput])
  fields: SowFieldInput[];

  @Field(() => SowInputsInput)
  inputs: SowInputsInput;

  @Field({ nullable: true, description: 'Optional note describing what changed, shown in the version history' })
  note?: string;
}
