import { Field, ID, ObjectType } from '@nestjs/graphql';
import JSON from 'graphql-type-json';

@ObjectType({ description: 'Services supported by the DampLab' })
export class Service {
  @Field(() => ID, { description: 'unique database generated ID' })
  id: string;

  @Field({ description: 'Human readable name of the service' })
  name: string;

  @Field({ description: 'URL to the icon of the service' })
  icon: string;

  @Field(() => JSON, { description: 'Parameters that are part of the service' })
  parameters: any;

  @Field(() => JSON, { description: 'Parameters defined earlier in the graph' })
  flowParams?: any;

  @Field(() => [String], { description: 'List of services this service can connect to' })
  allowedConnections: string[];

  @Field(() => JSON, { description: 'The by-product of the service' })
  result?: any;

  @Field(() => [String], { description: 'The expected fields in the result of the service' })
  resultParams?: string[];
}
