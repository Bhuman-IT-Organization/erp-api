/**
 * Route constants: the single source for this module's paths, used by the controller, the
 * validator and the tests. Relative to the global prefix `api/v1`; the api path stays
 * `customer-groups` while the screens live under `/setup/customer-groups`.
 */
export const CUSTOMER_GROUPS_ROUTES = {
  base: 'customer-groups',
  list: '',
  record: ':id',
} as const;

// No permission constant: the module is administrators only. Its handlers declare no code and
// the service asserts the administrator flag; `@erp/contracts`' `ROUTE_GATES` declares the three
// `/setup/customer-groups` screens `'admin'`.
