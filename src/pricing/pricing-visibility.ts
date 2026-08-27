import { Permission } from '../auth/permissions/permission.enum';
import { hasPermission, PermissionActor } from '../auth/permissions/permissions';
import { User } from '../auth/user.interface';
import { CustomerCategory } from './customer-category';
import { deriveCustomerCategory } from './pricing-groups';
import { Pricing } from './pricing.model';

/**
 * Who a caller is, for pricing purposes: their tier, and whether they may see
 * everyone else's.
 */
export function callerCustomerCategory(user: User | undefined | null): CustomerCategory | undefined {
  const roles = user?.realm_access?.roles ?? [];
  const groups = user?.groups ?? [];
  return deriveCustomerCategory([...roles, ...groups]);
}

export function canSeeAllPricingTiers(user: PermissionActor | undefined | null): boolean {
  return hasPermission(user, Permission.InternalFieldsRead);
}

/**
 * The tiers a caller in `category` legitimately needs.
 *
 * `external` and `legacy` are always kept: they are not another customer's price
 * but the generic and pre-migration fallbacks that every tier's resolution chain
 * ends in (see `resolveCategoryPrice`). Stripping them would leave a caller with a
 * blank price rather than a correct one.
 *
 * An uncategorised caller keeps only those two — which matches
 * `resolveCategoryPrice`'s own final line, `pricing?.legacy ?? input.price`. The
 * frontend used to reach past that into `externalMarket`; that reach-through is
 * removed rather than accommodated, because the alternative is publishing a tier to
 * people who are not in it.
 */
const TIER_FIELD: Record<CustomerCategory, keyof Pricing> = {
  [CustomerCategory.INTERNAL_CUSTOMERS]: 'internal',
  [CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC]: 'externalAcademic',
  [CustomerCategory.EXTERNAL_CUSTOMER_MARKET]: 'externalMarket',
  [CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY]: 'externalNoSalary'
};

/**
 * The true universal fallback. `resolveCategoryPrice` ends every chain — internal,
 * academic, market, no-salary and uncategorised alike — in `pricing.legacy ?? price`,
 * so stripping this would leave a caller with a blank price rather than a correct one.
 */
const ALWAYS_VISIBLE: readonly (keyof Pricing)[] = Object.freeze(['legacy']);

/**
 * `external` is the pre-split undifferentiated external price, and it is the second
 * step in all three *external* chains (`externalAcademic ?? external ?? …`). So it
 * has to reach external and uncategorised callers, or their price goes blank.
 *
 * It must **not** reach internal customers. Their chain is
 * `internal ?? internalPrice`, then straight to `legacy` — they never read
 * `external` — and on real records this field is often populated with what is
 * effectively the market rate. Publishing it to them would have made the tier strip
 * leak the number it was there to hide.
 */
const EXTERNAL_FALLBACK: keyof Pricing = 'external';

function seesExternalFallback(category: CustomerCategory | undefined): boolean {
  return category !== CustomerCategory.INTERNAL_CUSTOMERS;
}

/**
 * Strip every pricing tier the caller is not in.
 *
 * Returns the object unchanged for a caller holding `internal-fields:read`
 * (Administrator and Technician), so staff-facing pages are untouched.
 *
 * Note this returns a **new** object rather than mutating: the argument is a
 * hydrated Mongoose document's field on the hot path for `services`, which is
 * fetched once into the frontend's global AppContext.
 */
export function visiblePricing(pricing: Pricing | undefined | null, user: (User & PermissionActor) | undefined | null): Pricing | undefined {
  if (!pricing) return pricing ?? undefined;
  if (canSeeAllPricingTiers(user)) return pricing;

  const category = callerCustomerCategory(user);
  const ownTier = TIER_FIELD[category as CustomerCategory];
  const keep = new Set<keyof Pricing>([
    ...ALWAYS_VISIBLE,
    ...(ownTier ? [ownTier] : []),
    ...(seesExternalFallback(category) ? [EXTERNAL_FALLBACK] : [])
  ]);

  const everyField: (keyof Pricing)[] = [...Object.values(TIER_FIELD), EXTERNAL_FALLBACK, ...ALWAYS_VISIBLE];
  const stripped: Pricing = {};
  for (const key of everyField) {
    stripped[key] = keep.has(key) ? (pricing as Pricing)[key] : undefined;
  }
  return stripped;
}

/**
 * The same rule for the four deprecated per-tier flat price fields on
 * DampLabService (`internalPrice`, `externalAcademicPrice`, …). They are superseded
 * by `pricing` but still populated on older documents and still read by the
 * frontend's fallback chains, so leaving them would make the `pricing` strip
 * cosmetic.
 */
export function visibleFlatPrice(value: number | undefined, tier: CustomerCategory, user: (User & PermissionActor) | undefined | null): number | undefined {
  if (canSeeAllPricingTiers(user)) return value;
  return callerCustomerCategory(user) === tier ? value : undefined;
}

/**
 * `externalPrice`, the flat twin of `pricing.external`. Same rule: every external
 * chain falls back to it, and internal customers never read it — so they do not get
 * it, because in practice this field carries a real external rate.
 */
export function visibleExternalFallbackPrice(value: number | undefined, user: (User & PermissionActor) | undefined | null): number | undefined {
  if (canSeeAllPricingTiers(user)) return value;
  return seesExternalFallback(callerCustomerCategory(user)) ? value : undefined;
}
