import { InputType, Field, Int } from '@nestjs/graphql';

@InputType({ description: 'Input for creating a column mapping' })
export class CreateColumnMappingInput {
  @Field({ description: 'The field identifier' })
  field: string;

  @Field({ description: 'The display name for the column header' })
  headerName: string;

  @Field({ description: 'The data type of the column' })
  type: string;

  @Field(() => Int, { description: 'The width of the column in pixels' })
  width: number;

  @Field(() => Int, { description: 'The order position of the column' })
  order: number;
}

@InputType({ description: 'Input for creating a new template' })
export class CreateTemplateInput {
  @Field({ description: 'The name of the template' })
  name: string;

  @Field({ nullable: true, description: 'Optional description of the template' })
  description?: string;

  @Field(() => [CreateColumnMappingInput], { description: 'Column mapping configuration' })
  columnMapping: CreateColumnMappingInput[];
}
