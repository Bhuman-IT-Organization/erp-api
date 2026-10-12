/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 *
 * `v1/auth` reads `IdentityFacade.permissionsOf(staffId)` where it used to read
 * `tblstaff_permissions` itself, and subscribes to this module's events (plan 03.1-11);
 * `v1/mail` reads a member's address and locale through `contactOf(staffId)` (plan 04.3-06, M1).
 * The staff directory identity registers with `v1/departments` wraps `listActiveMembers()` and
 * `namesOf(ids)` (D-49).
 */
export { IdentityFacade } from './facade/identity.facade.js';
export type {
  StaffMember,
  MemberState,
  PerfexPermissionRow,
  StaffName,
  StaffContact,
} from './model/identity.model.js';
