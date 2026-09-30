import { Field, InputType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

@InputType()
export class CreateParameterSet {
  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => JSON)
  parameters: any;
}

@InputType({ description: 'Edits to a Parameter Set. Omitted fields are left alone.' })
export class ParameterSetChange {
  @Field({ nullable: true })
  name?: string;

  @Field({ nullable: true })
  description?: string;

  @Field(() => JSON, { nullable: true })
  parameters?: any;
}
