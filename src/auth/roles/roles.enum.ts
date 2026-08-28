/**
 * Keycloak **realm roles** — the only thing `auth.guard.ts` can read, because they
 * are what lands in `realm_access.roles`.
 *
 * Keycloak **groups** are a separate namespace and live in `pricing/pricing-groups.ts`
 * (`PricingGroup`) and, for access, in the group names admins assign. The realm's
 * roles are singular and its groups plural; one enum used to hold both, which is how
 * the group `external-customers` came to be missing from the code entirely.
 *
 * `internal-customer` / `external-customer` are legacy: they are granted by the
 * pricing groups' role mappings and are kept inert. Nothing requires them — every
 * authenticated user gets the client baseline in code regardless.
 *
 * `technician` and `client-unassisted-equipment-user` are granted by the access
 * groups `technician` and `client-unassisted-equipment-users`. A role string this
 * code does not know simply resolves to no permissions, which is why the backend
 * can deploy before the realm has these roles.
 */
export enum Role {
  DamplabStaff = 'damplab-staff',
  Technician = 'technician',
  ClientUnassistedEquipmentUser = 'client-unassisted-equipment-user',
  InternalCustomer = 'internal-customer',
  ExternalCustomer = 'external-customer'
}
