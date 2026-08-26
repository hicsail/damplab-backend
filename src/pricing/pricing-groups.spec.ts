import { CustomerCategory } from './customer-category';
import { Role } from '../auth/roles/roles.enum';
import {
  CATEGORY_PRIMARY_GROUP,
  CUSTOMER_PRICING_GROUP_NAMES,
  deriveCustomerCategory,
  deriveCustomerCategoryFromGroups,
  isCustomerPricingGroupName,
  isDefaultExternalCustomerClaims,
  PricingGroup
} from './pricing-groups';

/**
 * The fixture table below is mirrored verbatim by
 * `damplab-ui/src/contexts/customerCategory.spec.ts`. The two packages share no
 * code, so the tables are what keep their precedence from drifting apart.
 */
export const DERIVATION_FIXTURES: { name: string; claims: string[]; expected: CustomerCategory | undefined }[] = [
  { name: 'no claims at all', claims: [], expected: undefined },
  { name: 'unrelated claims only', claims: ['damplab-staff', 'offline_access'], expected: undefined },
  { name: 'internal-customers group', claims: ['internal-customers'], expected: CustomerCategory.INTERNAL_CUSTOMERS },
  { name: 'internal-customer legacy role', claims: ['internal-customer'], expected: CustomerCategory.INTERNAL_CUSTOMERS },
  { name: 'external-customer-academic group', claims: ['external-customer-academic'], expected: CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC },
  { name: 'external-customer-market group', claims: ['external-customer-market'], expected: CustomerCategory.EXTERNAL_CUSTOMER_MARKET },
  { name: 'external-customer-no-salary group', claims: ['external-customer-no-salary'], expected: CustomerCategory.EXTERNAL_CUSTOMER_NO_SALARY },
  { name: 'external-customers group (the bug this phase fixes)', claims: ['external-customers'], expected: CustomerCategory.EXTERNAL_CUSTOMER_MARKET },
  { name: 'external-customers group path', claims: ['/external-customers'], expected: CustomerCategory.EXTERNAL_CUSTOMER_MARKET },
  { name: 'external-customer legacy role', claims: ['external-customer'], expected: CustomerCategory.EXTERNAL_CUSTOMER_MARKET },
  // Precedence: internal wins outright, in first position, in either spelling.
  { name: 'internal-customers beats external-customer-market', claims: ['external-customer-market', 'internal-customers'], expected: CustomerCategory.INTERNAL_CUSTOMERS },
  { name: 'internal-customer (singular) beats external-customer-market', claims: ['external-customer-market', 'internal-customer'], expected: CustomerCategory.INTERNAL_CUSTOMERS },
  { name: 'internal-customer (singular) beats external-customer-academic', claims: ['external-customer-academic', 'internal-customer'], expected: CustomerCategory.INTERNAL_CUSTOMERS },
  { name: 'internal-customer (singular) beats external-customer-no-salary', claims: ['external-customer-no-salary', 'internal-customer'], expected: CustomerCategory.INTERNAL_CUSTOMERS },
  { name: 'a specific external tier beats the default external group', claims: ['external-customers', 'external-customer-academic'], expected: CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC },
  // Access-group membership must have no pricing effect whatsoever.
  {
    name: 'academic pricing survives the equipment-user access group',
    claims: ['external-customer-academic', 'client-unassisted-equipment-users'],
    expected: CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC
  },
  { name: 'technician access group carries no price', claims: ['technician'], expected: undefined }
];

describe('deriveCustomerCategory', () => {
  it.each(DERIVATION_FIXTURES)('$name', ({ claims, expected }) => {
    expect(deriveCustomerCategory(claims)).toBe(expected);
  });

  it('reads both the name and the path of an admin-API group list', () => {
    expect(deriveCustomerCategoryFromGroups([{ name: 'external-customers', path: '/external-customers' }])).toBe(CustomerCategory.EXTERNAL_CUSTOMER_MARKET);
  });

  it('does not let a longer group name satisfy a shorter one', () => {
    // 'external-customers' must not be read as the legacy 'external-customer' role
    // by the endsWith matcher, nor vice versa. Both resolve to MARKET here, so
    // assert the near-miss that would matter: the academic tier is not swallowed.
    expect(deriveCustomerCategory(['external-customer-academic'])).toBe(CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC);
  });
});

describe('isDefaultExternalCustomerClaims', () => {
  it('is true for the plural default group alone — the filter that showed nobody', () => {
    expect(isDefaultExternalCustomerClaims(['external-customers'])).toBe(true);
  });

  it('is true for the legacy singular spelling alone', () => {
    expect(isDefaultExternalCustomerClaims(['external-customer'])).toBe(true);
  });

  it('is false once a specific tier is present', () => {
    expect(isDefaultExternalCustomerClaims(['external-customers', 'external-customer-market'])).toBe(false);
    expect(isDefaultExternalCustomerClaims(['external-customers', 'internal-customers'])).toBe(false);
  });

  it('is false for a user with no default-external membership', () => {
    expect(isDefaultExternalCustomerClaims(['internal-customers'])).toBe(false);
    expect(isDefaultExternalCustomerClaims([])).toBe(false);
  });
});

describe('CUSTOMER_PRICING_GROUP_NAMES', () => {
  it('contains the plural default external group, so a category change clears it', () => {
    expect(isCustomerPricingGroupName(PricingGroup.ExternalCustomers)).toBe(true);
  });

  it('contains every group CATEGORY_PRIMARY_GROUP can write', () => {
    for (const group of Object.values(CATEGORY_PRIMARY_GROUP)) {
      expect(isCustomerPricingGroupName(group)).toBe(true);
    }
  });

  it('still clears the legacy singular spellings', () => {
    expect(isCustomerPricingGroupName(Role.InternalCustomer)).toBe(true);
    expect(isCustomerPricingGroupName(Role.ExternalCustomer)).toBe(true);
  });

  it('contains no access group — setUserCustomerCategory would strip it', () => {
    for (const accessGroup of ['damplab-staff', 'technician', 'client-unassisted-equipment-users']) {
      expect(CUSTOMER_PRICING_GROUP_NAMES).not.toContain(accessGroup);
    }
  });
});
