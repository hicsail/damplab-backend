import { Field, Float, InputType, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'Customer-category pricing (internal/external) with optional legacy fallback.' })
@InputType('PricingInput')
export class Pricing {
  @Field(() => Float, { nullable: true, description: 'Price for internal customers.' })
  internal?: number;

  @Field(() => Float, {
    nullable: true,
    description: 'Price for external academic customers.'
  })
  externalAcademic?: number;

  @Field(() => Float, {
    nullable: true,
    description: 'Price for external market customers.'
  })
  externalMarket?: number;

  @Field(() => Float, {
    nullable: true,
    description: 'Price for external no-salary customers.'
  })
  externalNoSalary?: number;

  @Field(() => Float, {
    nullable: true,
    description: 'Legacy external price for backward compatibility.'
  })
  external?: number;

  @Field(() => Float, { nullable: true, description: 'Legacy fallback price (used when internal/external not set).' })
  legacy?: number;
}
