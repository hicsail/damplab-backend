import { InputType, Field } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

@InputType()
export class ServiceInput {
  @Field({ description: 'Human assigned ID' })
  id: string;

  @Field({ description: 'Name of the service' })
  name: string;

  @Field({ description: 'The icon image' })
  icon: string;

  @Field(() => JSON, { description: 'Parameters required of the service' })
  parameters: any;

  @Field(() => [String], { description: 'Array of human assigned IDs' })
  allowedConnections: string[];

  @Field(() => [String], { description: 'List of categories the service is a part of' })
  categories: string[];

  @Field(() => JSON, { description: 'The result of the service', nullable: true })
  result?: any;

  @Field()
  description: string;

  @Field(() => [String], { nullable: true })
  resultParams?: string[];
}
