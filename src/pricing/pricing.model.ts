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

/**
 * One priced element behind a parameter-priced line.
 *
 * Stored as a snapshot on the SOW service line and copied onto the invoice, the
 * same way `unitCost`/`multiplier` are — the documents state what was billed,
 * they do not reprice on read. Shared by all three models so a row means the
 * same thing wherever it is rendered.
 */
@ObjectType({ description: 'One priced selection behind a parameter-priced line (e.g. "Hours in use — 3 x $40.00").' })
@InputType('PricingDetailInput')
export class PricingDetail {
  @Field({ description: 'The option or parameter as the customer chose it.' })
  label: string;

  @Field(() => Float, { description: 'How many — a count of selections, or the number typed into a priced multiplier.' })
  quantity: number;

  @Field(() => Float, { description: 'Rate applied to each.' })
  unitPrice: number;

  @Field(() => Float, { description: 'quantity x unitPrice.' })
  total: number;
}
