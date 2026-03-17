import { Field, Float, InputType, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'Customer-category pricing (internal/external) with optional legacy fallback.' })
@InputType('PricingInput')
export class Pricing {
  @Field(() => Float, { nullable: true, description: 'Price for INTERNAL customers.' })
  internal?: number;

  @Field(() => Float, { nullable: true, description: 'Price for EXTERNAL customers.' })
  external?: number;

  @Field(() => Float, { nullable: true, description: 'Legacy fallback price (used when internal/external not set).' })
  legacy?: number;
}

