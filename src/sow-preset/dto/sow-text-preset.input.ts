import { Field, ID, InputType } from '@nestjs/graphql';

@InputType({ description: 'A new text block for one SOW prose section' })
export class CreateSowTextPresetInput {
  @Field({ description: 'Catalog key of the section, e.g. "invoiceProcedures"' })
  sectionKey: string;

  @Field({ description: 'Staff-facing name for the block' })
  name: string;

  @Field({ defaultValue: '', description: 'The text itself' })
  text: string;
}

@InputType({ description: 'Edits to an existing text block. Omitted fields are left alone.' })
export class UpdateSowTextPresetInput {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  text?: string;
}

@InputType({ description: 'A section and its blocks in their new order, top first' })
export class ReorderSowTextPresetsInput {
  @Field()
  sectionKey: string;

  @Field(() => [ID], { description: 'Block ids, top (default) first' })
  orderedIds: string[];
}
