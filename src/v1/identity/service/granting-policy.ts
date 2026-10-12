/**
 * The one place that answers "is this change a grant, and may this actor make it?" (ADR-0034
 * decision 2).
 *
 * **Why a file and not an `if` in the service.** Seven Perfex modules shipped the same permissions
 * screen and four of them got the check wrong in three different ways (identity-access brief §2.2):
 * one on a settings code, one on a settings code again, one through a `!` precedence bug that made
 * the guard unreachable, and one with no gate at all. ADR-0034 calls that cause structural — every
 * module that ships the screen is a place the check can be wrong, and nothing outside that screen
 * notices. The answer is one pure, exported, separately specced policy: `GRANTING_FIELDS` as data,
 * `isGrantingChange` to say what a request would change, `assertMayGrant` to refuse it. Every write
 * path calls this; nothing re-implements it.
 *
 * **The gate is the administrator flag on the actor, and nothing else.** Not a code, not a role,
 * not a scope: a code can be handed out by the mechanism it protects, which is the same hole with a
 * new name (ADR-0034 § Alternatives). Nothing in this file reads the actor's access at all — the
 * spec proves it by giving an actor the whole ADR-0033 catalogue and watching it still be refused —
 * and a verify gate asserts the file names no access check.
 *
 * Pure: no injection, no I/O, no clock. The audit entries the service appends are derived from the
 * same `GrantingChange[]` this file returned, so the record and the refusal can never disagree
 * (threat T-3.1-44).
 */
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { IDENTITY_CHANGE_TYPES, type IdentityChangeType } from '../identity.routes.js';
import type {
  MemberSaveInput,
  MemberState,
  RoleSaveInput,
  RoleState,
} from '../model/identity.model.js';

/**
 * The fields of a member save that hand out access. Data, not an if-chain, so a future field is
 * added in one place and every write path inherits it. On the wire they are spelled `roleId`,
 * `permissions` and `admin` (`dto/identity.dto.ts`); these are the domain names the audit row uses.
 */
export const GRANTING_FIELDS = ['role', 'permissions', 'admin'] as const;

/**
 * The role-definition write. A role **is** a permission set, so creating, changing or deleting one
 * hands out or takes away access from every member holding it — there is no non-granting half of a
 * role write the way `staff.members.edit` has a profile half. `POST`, `PATCH` and `DELETE
 * /roles/:id` therefore go through the same `assertMayGrant` as a member save and declare no
 * permission code at all (ADR-0034 d.2, brief §5's 2026-09-23 correction table; deleting is a
 * write to `tblroles` and one role write left on a grantable code would reopen the hole).
 */
export const ROLE_GRANTING_FIELDS = ['roleDefinition'] as const;

export type GrantingField =
  (typeof GRANTING_FIELDS)[number] | (typeof ROLE_GRANTING_FIELDS)[number];

/** Which kind of role write produced a `roleDefinition` change; fixes its `change_type`. */
export type RoleChangeKind = 'created' | 'updated' | 'deleted';

export interface GrantingChange {
  readonly field: GrantingField;
  readonly before: string | null;
  readonly after: string | null;
  /** The clean ADR-0033 name, for a permission add or remove; absent for a role or flag change. */
  readonly permissionCode?: string;
  /** Set on a `roleDefinition` change only, so the audit row names `role.created|updated|deleted`. */
  readonly roleChange?: RoleChangeKind;
}

const FLAG_SET = '1';
const FLAG_CLEAR = '0';

function flagOf(value: boolean): string {
  return value ? FLAG_SET : FLAG_CLEAR;
}

function roleOf(value: number | null): string | null {
  return value === null ? null : String(value);
}

/**
 * Every granting field whose value the request would change, one entry per field and one per
 * permission code added or removed. An empty result means the save grants nothing, so it needs no
 * administrator — that is how a non-admin with `staff.members.edit` still saves a profile.
 *
 * A field the request does not mention is `undefined` and is never a change; `roleId: null` is
 * "no role", which IS a change when the member had one.
 */
export function isGrantingChange(
  before: MemberState,
  after: MemberSaveInput,
): readonly GrantingChange[] {
  const changes: GrantingChange[] = [];

  if (after.roleId !== undefined && after.roleId !== before.roleId) {
    changes.push({ field: 'role', before: roleOf(before.roleId), after: roleOf(after.roleId) });
  }

  if (after.isAdmin !== undefined && after.isAdmin !== before.isAdmin) {
    changes.push({
      field: 'admin',
      before: flagOf(before.isAdmin),
      after: flagOf(after.isAdmin),
    });
  }

  if (after.permissions !== undefined) {
    const held = new Set(before.permissions);
    const requested = new Set(after.permissions);
    for (const code of [...requested].sort((left, right) => left.localeCompare(right))) {
      if (!held.has(code)) {
        changes.push({ field: 'permissions', before: null, after: code, permissionCode: code });
      }
    }
    for (const code of [...held].sort((left, right) => left.localeCompare(right))) {
      if (!requested.has(code)) {
        changes.push({ field: 'permissions', before: code, after: null, permissionCode: code });
      }
    }
  }

  return changes;
}

/**
 * A role's state as one line of text, for the audit row's `before`/`after`. The name and the
 * template together: a role write that only renames still changed what the members' screens say,
 * and a template change with the same name is the escalation the log exists for.
 */
function describeRole(state: RoleState): string {
  const permissions = [...state.permissions].sort((left, right) => left.localeCompare(right));
  return `${state.name} [${permissions.join(' ')}]`;
}

/**
 * The role side of the same question, as `GrantingChange` values so the gate, the audit row and the
 * refusal all come from one place. **Every** role write is a grant:
 *
 *   `before === null` → the role is being created  → one `roleDefinition` change, `created`
 *   `after === null`  → the role is being deleted  → one `roleDefinition` change, `deleted`
 *   both present      → the role is being changed  → one `roleDefinition` change, `updated`
 *
 * One entry, never one per field: brief §7 gives a role write a single `role.*` audit row naming
 * the role, and the member fan-out of `applyToMembers` is produced by `isGrantingChange` per
 * affected member instead. An update that changes nothing still produces its entry — the log
 * records the change that was made, not only the escalation (ADR-0034 d.3).
 */
export function isRoleGrantingChange(
  before: RoleState | null,
  after: RoleSaveInput | null,
): readonly GrantingChange[] {
  if (before === null && after === null) return [];
  if (before === null) {
    return [
      {
        field: 'roleDefinition',
        roleChange: 'created',
        before: null,
        after: describeRole({ name: after?.name ?? '', permissions: after?.permissions ?? [] }),
      },
    ];
  }
  if (after === null) {
    return [
      { field: 'roleDefinition', roleChange: 'deleted', before: describeRole(before), after: null },
    ];
  }
  return [
    {
      field: 'roleDefinition',
      roleChange: 'updated',
      before: describeRole(before),
      after: describeRole({
        name: after.name ?? before.name,
        permissions: after.permissions ?? before.permissions,
      }),
    },
  ];
}

/**
 * Refuses the save with `ERP-IDENTITY-0001` (403) unless the actor carries `tblstaff.admin = 1`.
 * No change means no gate: an empty list passes for everybody. The actor's own access is never
 * consulted — the administrator flag is the whole rule.
 */
export function assertMayGrant(actor: AuthenticatedUser, changes: readonly GrantingChange[]): void {
  if (changes.length === 0) return;
  if (actor.isAdmin) return;
  const fields = [...new Set(changes.map((change) => change.field))].sort();
  throw new AppError(
    'ERP-IDENTITY-0001',
    `Changing ${fields.join(', ')} requires the administrator flag`,
  );
}

/** The `tblidentity_audit.change_type` a granting change records (brief §7). */
export function auditChangeTypeOf(change: GrantingChange): IdentityChangeType {
  if (change.field === 'roleDefinition') {
    if (change.roleChange === 'created') return IDENTITY_CHANGE_TYPES.roleCreated;
    if (change.roleChange === 'deleted') return IDENTITY_CHANGE_TYPES.roleDeleted;
    return IDENTITY_CHANGE_TYPES.roleUpdated;
  }
  if (change.field === 'role') return IDENTITY_CHANGE_TYPES.memberRoleChanged;
  if (change.field === 'admin') return IDENTITY_CHANGE_TYPES.memberAdminChanged;
  return change.after === null
    ? IDENTITY_CHANGE_TYPES.memberPermissionRemoved
    : IDENTITY_CHANGE_TYPES.memberPermissionAdded;
}
