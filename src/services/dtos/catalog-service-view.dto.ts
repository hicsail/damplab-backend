import { Field, Float, ID, Int, ObjectType } from '@nestjs/graphql';
import JSONScalar from 'graphql-type-json';
import { Pricing } from '../../pricing/pricing.model';

/**
 * What `/services-catalog` needs, and nothing else.
 *
 * Deliberately **not** `DampLabService`. The catalog page used to render all four
 * pricing tiers and a full parameter dialog to every authenticated user, straight
 * off the shared `services` query and the global AppContext. Returning a
 * purpose-built view makes the reduction structural rather than presentational: a
 * client asking for this type cannot ask for a field it does not have.
 *
 * The tier stripping on `DampLabService.pricing` is still required and still does
 * the real work — see the field resolver there. This type is the second half:
 * without it, `catalogServices` would be a thinner query over data the wide one
 * still hands out.
 */
@ObjectType({ description: "A service as the client-facing catalog page shows it: name, description, the caller's own price, and — for staff only — the full tier table and parameters." })
export class CatalogServiceView {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field({ nullable: true })
  description?: string;

  @Field({ nullable: true, description: 'Service category name, for grouping.' })
  serviceCategoryName?: string;

  @Field({ nullable: true, description: 'The unit the price is quoted in.' })
  unit?: string;

  @Field(() => Float, {
    nullable: true,
    description:
      "The caller's own resolved price, computed server-side from their pricing group. Null when the service prices per parameter rather than per service, or when no rate is set for their category."
  })
  price?: number;

  @Field({ nullable: true, description: 'How the price is arrived at, for display next to it.' })
  pricingModeLabel?: string;

  @Field(() => Int, { nullable: true, description: 'How many parameters this service takes. Always present — it is a shape fact, not a price.' })
  parameterCount?: number;

  @Field(() => Pricing, {
    nullable: true,
    description: 'All four tiers. **Null without internal-fields:read** — the caller sees only their own price, above.'
  })
  pricing?: Pricing;

  @Field(() => JSONScalar, {
    nullable: true,
    description: 'The full parameter definitions, which carry per-parameter prices. **Null without internal-fields:read.**'
  })
  parameters?: unknown;
}
