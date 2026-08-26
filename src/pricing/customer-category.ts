/**
 * The one definition of a customer's pricing category.
 *
 * Deliberately free of framework imports so the pure pricing utilities can depend
 * on it. `job/job.model.ts` re-exports it and performs the `registerEnumType`
 * registration that exposes it to GraphQL.
 */
export enum CustomerCategory {
  INTERNAL_CUSTOMERS = 'INTERNAL_CUSTOMERS',
  EXTERNAL_CUSTOMER_ACADEMIC = 'EXTERNAL_CUSTOMER_ACADEMIC',
  EXTERNAL_CUSTOMER_MARKET = 'EXTERNAL_CUSTOMER_MARKET',
  EXTERNAL_CUSTOMER_NO_SALARY = 'EXTERNAL_CUSTOMER_NO_SALARY'
}
