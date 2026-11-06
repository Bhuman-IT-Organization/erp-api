/** Route constants, relative to the global prefix `api/v1`. */
export const TODO_ROUTES = {
  base: 'todo',
  list: '',
  order: 'order',
  record: ':id',
  finished: ':id/finished',
} as const;

// No permission constant: every signed-in member manages THEIR OWN to do's; the service scopes
// every query by `actor.staffId`. `@erp/contracts`' `ROUTE_GATES` declares the three screens as the
// signed-in-member gate (not `'admin'`).
