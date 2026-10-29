/**
 * `ROUTE_GATES` — the ONE declaration of the gate each migrated erp-web route carries, beside the
 * clean permission catalogue it reads its codes from.
 *
 * ## Why it exists
 *
 * The gate on `/setup/roles` was declared twice and the two declarations drifted: `erp-web`'s
 * `src/config/navigation.ts` said `adminOnly: true` while this api's controller gated
 * `GET identity/roles` on `staff.roles.view`, so a non-administrator holding that one code could
 * read every role's full permission template — a capability Perfex never granted and no screen
 * exercised. Nothing compared the two declarations, so nothing could notice (migration-lead
 * decision, 2026-09-24). The fix is the class, not the instance: one map, read by erp-web and
 * verified against the api's decorators by a test in each repository.
 *
 * ## Two boundaries this map must never cross
 *
 * 1. **It is NEVER a runtime authorisation source in erp-web.** The api is the only boundary: every
 *    handler authorises for itself and answers 401/403 whatever the browser rendered. In erp-web
 *    this map is a UI declaration (which menu rows appear, which screens refuse) and a test oracle.
 *    A screen that trusted it would be trusting data the browser can edit.
 * 2. **The api keeps authorising per handler.** The decorators and the service's administrator
 *    assertions remain the gate; `src/v1/identity/__tests__/route-gates.spec.ts` only *compares*
 *    them with this map. Turning the map into the runtime gate would move authorisation out of the
 *    module that owns the data, which is what ADR-0034 decision 1 forbids.
 *
 * ## The grammar
 *
 * A key is an erp-web route path with `:id` for a dynamic segment — the path as
 * `src/config/routes.ts` reads it, not an api path. A value is either a clean ADR-0033 permission
 * code (imported, never written as a literal — `S_PERMISSION_LITERAL`) or the literal `'admin'`,
 * which is the `tblstaff.admin = 1` flag ADR-0034 decision 2 says no permission code may express.
 * A value may also be an any-of array of codes (plan 04.2-02): holding any one admits; the first is
 * the widest, as `@PermissionsAny` expects. A key's dynamic segment is any `:name`.
 *
 * A route is listed once its screen is built or planned in the current phase (it may arrive before
 * its screen, as `/setup/expense-categories*` did in plan 04.1-03).
 */
import { PERMISSIONS, type PermissionCode } from './permissions.catalogue.js';

/**
 * The administrator flag as a gate value. It is deliberately not a permission code: ADR-0034
 * decision 2 makes granting (and, since the 2026-09-24 decision, reading a role's template)
 * conditional on `tblstaff.admin = 1`, because a code can be handed out by the mechanism it
 * protects.
 */
export const ADMIN_GATE = 'admin';

/**
 * What a route may be gated on: one clean permission code, an any-of list of codes, or the
 * administrator flag.
 *
 * `PermissionCode` widens to `string` (the catalogue's 507 leaves are `as const` values, not a
 * closed type), so the second constituent adds nothing the compiler can use — it is written anyway
 * because it is the whole point of the map: a reader must see that `'admin'` is an admitted value
 * and not a typo, and `isAdminGate` is the narrowing both repositories switch on.
 */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- `'admin'` is documentation the compiler cannot express while PermissionCode is `string`, and the array form is the any-of gate; see the docblock above.
export type RouteGate = PermissionCode | readonly PermissionCode[] | typeof ADMIN_GATE;

/**
 * Route → gate, frozen. `/setup/staff*` is the member half (plan 03.1-07, gated on the view code the
 * api's `listMembers`/`getMember` declare); `/setup/roles*` is the roles half (plan 03.1-08), which is
 * administrator-only on BOTH sides after the 2026-09-24 decision — the api's `listRoles`/`getRole`
 * assert the flag and declare no permission code, and the screens refuse rather than render a
 * control the api would refuse.
 *
 * `/setup/staff/new` carries the same gate as `/setup/staff`: reaching the create screen is a read
 * of the member area, and `POST members` separately declares `staff.members.create`, so a member
 * who may see the form but not save is refused by the api rather than hidden from the route. That mirrors
 * what `routePermission('/staff/new')` answered before this map existed (the deepest declared menu
 * item covering the path), so the map changes no behaviour — it only makes the answer declared.
 *
 * `/setup/expense-categories*` (plan 04.1-03, D-06) is administrator-only as well: the api's
 * `v1/expense-categories` declares no code and asserts the flag in every service method.
 * `/setup/taxes*` (plan 04.1-11, D-06) is the same: `v1/taxes` asserts the flag in every handler's
 * service method. So is `/setup/cost-centers*` (plan 04.1-18, D-06 and D-26: Perfex's own screen
 * had no check at all; its menu item was administrator-only). So is `/setup/payment-modes*` (plan
 * 04.1-23, D-06 and D-32: Perfex's own screen was administrator-only already), and so is
 * `/setup/currencies*` (plan 04.1-28, D-06 and D-38: `Currencies.php:11` is
 * administrator-only).
 * `/setup/ticket-statuses*` is administrator-only as well (plan 06-ticket-statuses): the API
 * asserts the administrator flag for every handler.
 *
 * The Email screens (plan 04.3-07): `/setup/email-templates*` is gated on the mapped Perfex view code
 * (D-09: the editor is read-only without `.edit`, which the api's save and test send declare);
 * `/setup/sent-emails*` and `/setup/email-status` are administrator-only (D-05, D-02), the api
 * asserting the flag in each handler's service method.
 *
 * User-facing paths follow the menu (lead 2026-10-04, plan 04.2-27): staff and roles under
 * `/setup`; the api, the codes and the module keep `identity`.
 */
export const ROUTE_GATES: Readonly<Record<string, RouteGate>> = Object.freeze({
  '/setup/staff': PERMISSIONS.staff.members.view,
  '/setup/staff/new': PERMISSIONS.staff.members.view,
  '/setup/staff/:id': PERMISSIONS.staff.members.view,
  '/setup/roles': ADMIN_GATE,
  '/setup/roles/new': ADMIN_GATE,
  '/setup/roles/:id': ADMIN_GATE,
  '/setup/expense-categories': ADMIN_GATE,
  '/setup/expense-categories/new': ADMIN_GATE,
  '/setup/expense-categories/:id': ADMIN_GATE,
  '/setup/email-templates': PERMISSIONS.settings.emailTemplates.view,
  '/setup/email-templates/:id': PERMISSIONS.settings.emailTemplates.view,
  '/setup/sent-emails': ADMIN_GATE,
  '/setup/sent-emails/:id': ADMIN_GATE,
  '/setup/email-status': ADMIN_GATE,
  '/setup/taxes': ADMIN_GATE,
  '/setup/taxes/new': ADMIN_GATE,
  '/setup/taxes/:id': ADMIN_GATE,
  '/setup/cost-centers': ADMIN_GATE,
  '/setup/cost-centers/new': ADMIN_GATE,
  '/setup/cost-centers/:id': ADMIN_GATE,
  '/setup/payment-modes': ADMIN_GATE,
  '/setup/payment-modes/new': ADMIN_GATE,
  '/setup/payment-modes/:id': ADMIN_GATE,
  '/setup/currencies': ADMIN_GATE,
  '/setup/currencies/new': ADMIN_GATE,
  '/setup/currencies/:id': ADMIN_GATE,
  '/setup/lead-sources': ADMIN_GATE,
  '/setup/lead-sources/new': ADMIN_GATE,
  '/setup/lead-sources/:id': ADMIN_GATE,
  '/setup/ticket-statuses': ADMIN_GATE,
  '/setup/ticket-statuses/new': ADMIN_GATE,
  '/setup/ticket-statuses/:id': ADMIN_GATE,
  '/setup/customer-groups': ADMIN_GATE,
  '/setup/customer-groups/new': ADMIN_GATE,
  '/setup/customer-groups/:id': ADMIN_GATE,
  '/setup/ticket-priorities': ADMIN_GATE,
  '/setup/ticket-priorities/new': ADMIN_GATE,
  '/setup/ticket-priorities/:id': ADMIN_GATE,
});

/** Every declared route path, sorted — the set both verifying tests enumerate. */
export const GATED_ROUTES: readonly string[] = Object.keys(ROUTE_GATES).sort();

/** True when the route is gated on the administrator flag rather than on a permission code. */
export function isAdminGate(gate: RouteGate): gate is typeof ADMIN_GATE {
  return gate === ADMIN_GATE;
}

/** True when the route admits a member holding any one of a list of codes (plan 04.2-02). */
export function isAnyOfGate(gate: RouteGate): gate is readonly PermissionCode[] {
  return Array.isArray(gate);
}

/**
 * Pure: the gate `gates` declares for a concrete pathname. An exact key wins (`/setup/staff/new`), then
 * the first key in sorted order whose dynamic segments match, where any declared `:name` segment
 * (`:id`, `:tab`) matches one path segment (`/setup/roles/12` → `/setup/roles/:id`). The exact pass must come
 * first: `':'` sorts before every letter, so a pattern-only walk reached `/x/:id` before `/x/new`
 * (03.2 RESEARCH Pitfall 6): harmless while both carry one gate, wrong the day a create screen is
 * gated apart from a view. A query string is
 * ignored. `undefined` means the path declares no gate, which is NOT "allowed" — it is "this map
 * says nothing", and the api still decides. erp-web's `src/config/route-gates.ts` has the same body.
 */
export function routeGateIn(
  gates: Readonly<Record<string, RouteGate>>,
  pathname: string,
): RouteGate | undefined {
  const path = pathname.split('?')[0] ?? '';
  if (Object.hasOwn(gates, path)) return gates[path];
  const segments = path.split('/').filter((part) => part !== '');
  for (const route of Object.keys(gates).sort()) {
    const declared = route.split('/').filter((part) => part !== '');
    if (declared.length !== segments.length) continue;
    const matches = declared.every(
      (segment, index) => segment.startsWith(':') || segment === segments[index],
    );
    if (matches) return gates[route];
  }
  return undefined;
}

/** The gate `ROUTE_GATES` declares for a pathname — `routeGateIn` over this package's map. */
export function routeGateOf(pathname: string): RouteGate | undefined {
  return routeGateIn(ROUTE_GATES, pathname);
}
