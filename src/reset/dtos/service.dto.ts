import { InputType, Field, Float } from '@nestjs/graphql';
import JSON from 'graphql-type-json';
import { ServicePricingMode } from '../../services/models/damplab-service.model';

@InputType()
export class ServiceInput {
  @Field({ description: 'Human assigned ID' })
  id: string;

  @Field({ description: 'Name of the service' })
  name: string;

  @Field({ description: 'The icon image' })
  icon: string;

  @Field(() => Float, { description: 'Service price when pricingMode is SERVICE', nullable: true })
  price?: number;

  @Field(() => ServicePricingMode, {
    description: 'How pricing is determined for this service',
    nullable: true,
    defaultValue: ServicePricingMode.SERVICE
  })
  pricingMode?: ServicePricingMode;

  @Field(() => JSON, {
    description:
      'Parameters required of the service. Each parameter may include allowMultipleValues (boolean) and price (number); when allowMultipleValues is true, formData values may be stored and returned as string[].'
  })
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

  @Field(() => JSON, { nullable: true })
  paramGroups?: any[];
}
