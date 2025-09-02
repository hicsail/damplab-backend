import { InputType, Field, Int, ID } from '@nestjs/graphql';

@InputType({ description: 'Input for updating a column mapping' })
export class UpdateColumnMappingInput {
  @Field({ nullable: true, description: 'The field identifier' })
  field?: string;

  @Field({ nullable: true, description: 'The display name for the column header' })
  headerName?: string;

  @Field({ nullable: true, description: 'The data type of the column' })
  type?: string;

  @Field(() => Int, { nullable: true, description: 'The width of the column in pixels' })
  width?: number;

  @Field(() => Int, { nullable: true, description: 'The order position of the column' })
  order?: number;
}

@InputType({ description: 'Input for updating an existing template' })
export class UpdateTemplateInput {
  @Field(() => ID, { description: 'The ID of the template to update' })
  id: string;

  @Field({ nullable: true, description: 'The name of the template' })
  name?: string;

  @Field({ nullable: true, description: 'Optional description of the template' })
  description?: string;

  @Field(() => [UpdateColumnMappingInput], { nullable: true, description: 'Updated column mapping configuration' })
  columnMapping?: UpdateColumnMappingInput[];
}

