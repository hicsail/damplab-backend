import { Role } from '../auth/roles/roles.enum';
import { CustomerCategory } from './customer-category';

/**
 * Keycloak **group** names. These are containers of users and affect price only —
 * they are a different namespace from the realm roles in `Role`, which is the only
 * thing `auth.guard.ts` can see.
 *
 * The realm's groups are plural; its roles are singular. Conflating the two is what
 * caused default external customers to be silently billed at the legacy price:
 * `external-customers` was absent from the code entirely and the singular role name
 * `external-customer` was used in its place.
 */
export enum PricingGroup {
  InternalCustomers = 'internal-customers',
  ExternalCustomers = 'external-customers',
  ExternalCustomerAcademic = 'external-customer-academic',
  ExternalCustomerMarket = 'external-customer-market',
  ExternalCustomerNoSalary = 'external-customer-no-salary'
}

/**
 * Group memberships cleared before a new pricing category is applied.
 *
 * Includes the two singular *realm-role* spellings as well. No group by those names
 * exists in the `damplab` realm, so they are inert there, but clearing them costs
 * nothing and keeps this list a superset of what earlier code cleared.
 *
 * Access groups (`damplab-staff`, `technician`, `client-unassisted-equipment-users`)
 * must never appear here — `setUserCustomerCategory` would strip them.
 */
export const CUSTOMER_PRICING_GROUP_NAMES: readonly string[] = [
  PricingGroup.InternalCustomers,
  PricingGroup.ExternalCustomers,
  PricingGroup.ExternalCustomerAcademic,
  PricingGroup.ExternalCustomerMarket,
  PricingGroup.ExternalCustomerNoSalary,
  Role.InternalCustomer,
  Role.ExternalCustomer
];

/** The single group written when staff assign a category. */
export const CATEGORY_PRIMARY_GROUP: Record<CustomerCategory, PricingGroup> = {
  [CustomerCategory.INTERNAL_CUSTOMERS]: PricingGroup.InternalCustomers,
  [CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC]: PricingGroup.ExternalCustomerAcademic,
  [CustomerCategory.EXTERNAL_CUSTOMER_MARKET]: PricingGroup.ExternalCustomerMarket,
  [CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY]: PricingGroup.ExternalCustomerNoSalary
};

/**
 * Matches a claim entry against a group name, tolerating both the bare name and a
 * group path (`/external-customers`, `/parent/external-customers`).
 */
function claimMatches(entry: string, name: string): boolean {
  return entry === name || entry.endsWith(`/${name}`);
}

/**
 * Flatten a Keycloak Admin API group list into the same shape of claim strings the
 * token carries, so one derivation serves both callers.
 */
export function claimsFromGroupList(groups: { name?: string; path?: string }[]): string[] {
  const claims: string[] = [];
  for (const g of groups) {
    if (g.path) claims.push(g.path);
    if (g.name) claims.push(g.name);
  }
  return claims;
}

/**
 * THE pricing derivation. Every site that decides what a user is billed calls this —
 * the admin-API path (`KeycloakService`), job submission (`JobResolver.createJob`)
 * and node pricing (`AddNodeInputPipe`). Its precedence is mirrored, deliberately,
 * by `damplab-ui/src/contexts/UserContext.tsx`; the two packages share no code, so
 * both carry the same fixture table in their tests.
 *
 * `claims` may mix realm roles, group names and group paths — they are all matched
 * the same way.
 *
 * Precedence: internal (either spelling) wins outright, then the three specific
 * external tiers, then the default external group — which maps to
 * EXTERNAL_CUSTOMER_MARKET so the plural group and the singular legacy role finally
 * agree. Users who previously fell through to `undefined` (and therefore to the
 * silent `legacy` price) now price at market.
 */
export function deriveCustomerCategory(claims: readonly string[]): CustomerCategory | undefined {
  const has = (name: string): boolean => claims.some((entry) => claimMatches(entry, name));
  if (has(PricingGroup.InternalCustomers) || has(Role.InternalCustomer)) return CustomerCategory.INTERNAL_CUSTOMERS;
  if (has(PricingGroup.ExternalCustomerAcademic)) return CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC;
  if (has(PricingGroup.ExternalCustomerMarket)) return CustomerCategory.EXTERNAL_CUSTOMER_MARKET;
  if (has(PricingGroup.ExternalCustomerNoSalary)) return CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY;
  if (has(PricingGroup.ExternalCustomers) || has(Role.ExternalCustomer)) return CustomerCategory.EXTERNAL_CUSTOMER_MARKET;
  return undefined;
}

/** Convenience wrapper for callers holding an Admin API group list. */
export function deriveCustomerCategoryFromGroups(groups: { name?: string; path?: string }[]): CustomerCategory | undefined {
  return deriveCustomerCategory(claimsFromGroupList(groups));
}

/**
 * True when the user's pricing membership is only the default external group (either
 * spelling) and no more specific tier. Drives Customer Management's
 * "External Customer (default)" filter.
 */
export function isDefaultExternalCustomerClaims(claims: readonly string[]): boolean {
  const has = (name: string): boolean => claims.some((entry) => claimMatches(entry, name));
  if (!(has(PricingGroup.ExternalCustomers) || has(Role.ExternalCustomer))) return false;
  return !(
    has(PricingGroup.InternalCustomers) ||
    has(Role.InternalCustomer) ||
    has(PricingGroup.ExternalCustomerAcademic) ||
    has(PricingGroup.ExternalCustomerMarket) ||
    has(PricingGroup.ExternalCustomerNoSalary)
  );
}

/** True if the group is one this code clears when a category is reassigned. */
export function isCustomerPricingGroupName(name: string | undefined): boolean {
  return Boolean(name && CUSTOMER_PRICING_GROUP_NAMES.includes(name));
}
