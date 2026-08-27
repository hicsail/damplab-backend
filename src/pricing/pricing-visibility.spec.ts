import { Role } from '../auth/roles/roles.enum';
import { User } from '../auth/user.interface';
import { CustomerCategory } from './customer-category';
import { Pricing } from './pricing.model';
import { callerCustomerCategory, canSeeAllPricingTiers, visibleExternalFallbackPrice, visibleFlatPrice, visiblePricing } from './pricing-visibility';

const ALL_TIERS: Pricing = {
  internal: 1,
  externalAcademic: 2,
  externalMarket: 3,
  externalNoSalary: 4,
  external: 5,
  legacy: 6
};

const userWith = (roles: string[], groups: string[] = []): User => ({ preferred_username: 'u', sub: 's', email: 'e', realm_access: { roles }, groups } as User);

describe('visiblePricing — the catalog leak, closed', () => {
  it('leaves everything alone for a caller with internal-fields:read', () => {
    for (const role of [Role.DamplabStaff, Role.Technician]) {
      expect(visiblePricing(ALL_TIERS, userWith([role]))).toEqual(ALL_TIERS);
    }
  });

  it('gives an internal customer their own tier and legacy, and NOT the external fallback', () => {
    // `external` is withheld from internal customers specifically. Their chain is
    // `internal ?? internalPrice` then straight to `legacy` — they never read it —
    // and on real records it carries an actual external rate, so handing it over
    // would have leaked the number the strip exists to hide.
    expect(visiblePricing(ALL_TIERS, userWith([], ['internal-customers']))).toEqual({
      internal: 1,
      externalAcademic: undefined,
      externalMarket: undefined,
      externalNoSalary: undefined,
      external: undefined,
      legacy: 6
    });
  });

  it('gives an academic customer theirs, the external fallback, and no sibling tier', () => {
    const visible = visiblePricing(ALL_TIERS, userWith([], ['external-customer-academic']))!;
    expect(visible.externalAcademic).toBe(2);
    // The second step of their own chain: externalAcademic ?? external ?? legacy.
    expect(visible.external).toBe(5);
    expect(visible.internal).toBeUndefined();
    expect(visible.externalMarket).toBeUndefined();
    expect(visible.externalNoSalary).toBeUndefined();
  });

  it('gives an uncategorised caller only the fallbacks', () => {
    // The one population with no pricing group at all. They must not be handed the
    // internal rate — it is the cheapest tier.
    expect(visiblePricing(ALL_TIERS, userWith([]))).toEqual({
      internal: undefined,
      externalAcademic: undefined,
      externalMarket: undefined,
      externalNoSalary: undefined,
      external: 5,
      legacy: 6
    });
  });

  it('never lets an equipment user see a foreign tier — they hold no internal-fields:read', () => {
    const visible = visiblePricing(ALL_TIERS, userWith([Role.ClientUnassistedEquipmentUser]))!;
    expect(visible.internal).toBeUndefined();
    expect(visible.externalAcademic).toBeUndefined();
    expect(visible.externalMarket).toBeUndefined();
    expect(visible.externalNoSalary).toBeUndefined();
  });

  it('gives an API key nothing but the fallbacks — API_KEY_PERMISSIONS excludes internal-fields:read', () => {
    const key = { apiKey: true, realm_access: { roles: [] } } as unknown as User;
    expect(canSeeAllPricingTiers(key)).toBe(false);
    expect(visiblePricing(ALL_TIERS, key)).toEqual({
      internal: undefined,
      externalAcademic: undefined,
      externalMarket: undefined,
      externalNoSalary: undefined,
      external: 5,
      legacy: 6
    });
  });

  it('passes null and undefined through rather than fabricating an empty tier table', () => {
    expect(visiblePricing(undefined, userWith([]))).toBeUndefined();
    expect(visiblePricing(null, userWith([]))).toBeUndefined();
  });

  it('does not mutate the document it was handed', () => {
    const original = { ...ALL_TIERS };
    visiblePricing(original, userWith([]));
    expect(original).toEqual(ALL_TIERS);
  });
});

describe('visibleExternalFallbackPrice — externalPrice, the flat twin of pricing.external', () => {
  it('reaches external and uncategorised callers, whose chains fall back to it', () => {
    expect(visibleExternalFallbackPrice(5, userWith([], ['external-customer-academic']))).toBe(5);
    expect(visibleExternalFallbackPrice(5, userWith([]))).toBe(5);
  });

  it('does not reach an internal customer', () => {
    expect(visibleExternalFallbackPrice(5, userWith([], ['internal-customers']))).toBeUndefined();
  });

  it('reaches staff, who see everything', () => {
    expect(visibleExternalFallbackPrice(5, userWith([Role.DamplabStaff]))).toBe(5);
  });
});

describe('visibleFlatPrice — the deprecated flat fields carry the same information', () => {
  it('shows a tier only to the customers in it', () => {
    const academic = userWith([], ['external-customer-academic']);
    expect(visibleFlatPrice(42, CustomerCategory.EXTERNAL_CUSTOMER_ACADEMIC, academic)).toBe(42);
    expect(visibleFlatPrice(42, CustomerCategory.INTERNAL_CUSTOMERS, academic)).toBeUndefined();
  });

  it('shows all of them to staff', () => {
    const staff = userWith([Role.DamplabStaff]);
    expect(visibleFlatPrice(42, CustomerCategory.INTERNAL_CUSTOMERS, staff)).toBe(42);
  });
});

describe('callerCustomerCategory', () => {
  it('reads groups and roles alike, matching the job-submission derivation', () => {
    expect(callerCustomerCategory(userWith([], ['internal-customers']))).toBe(CustomerCategory.INTERNAL_CUSTOMERS);
    expect(callerCustomerCategory(userWith([Role.InternalCustomer]))).toBe(CustomerCategory.INTERNAL_CUSTOMERS);
    expect(callerCustomerCategory(userWith([]))).toBeUndefined();
  });
});
