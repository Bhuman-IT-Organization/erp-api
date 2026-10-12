/**
 * Domain events this module subscribes to (ADR-0029). The handler lives in `events/handlers/` and is
 * the only way another module's change reaches this one.
 *
 * Four, all from `v1/identity`: the three of identity-access brief §7, plus
 * `identity.member.accessChanged` (review CR-02 a of Phase 3.1). They exist because an access token
 * and a permission snapshot are both **copies** of state `v1/identity` owns: an administrator who
 * changes a password, deactivates a member, changes the administrator flag or the role, or replaces
 * a permission set has changed what the member may do,
 * and the copy must stop being trusted at once rather than at the next refresh
 * (threat T-3.1-47).
 *
 * **The names are string constants here and not imported from `v1/identity`** for two reasons: an
 * event name is a wire contract, not a type (BE-03 — a subscriber must not import another module's
 * `events/`), and `src/v1/**\/events/*.ts` is the one scope that admits the three-segment dotted
 * grammar an event name shares with an ADR-0033 clean permission name (plan 03.1-03's finding,
 * scope 14). `events/handlers/` is NOT that scope, so the handler imports these constants.
 */
export const IDENTITY_EVENTS = {
  /** An administrator set the member's password: every existing session ends. */
  memberPasswordChanged: 'identity.member.passwordChanged',
  /** The member was deactivated: every existing session ends. */
  memberDeactivated: 'identity.member.deactivated',
  /** The member's permission set was replaced: the ADR-0033 snapshot is stale. */
  permissionsReplaced: 'identity.permissions.replaced',
  /**
   * The administrator flag or the role changed: both are baked into the access token and the
   * snapshot, so every existing session ends and the snapshot is dropped.
   */
  memberAccessChanged: 'identity.member.accessChanged',
} as const;

export const AUTH_SUBSCRIBED_EVENTS = [
  IDENTITY_EVENTS.memberPasswordChanged,
  IDENTITY_EVENTS.memberDeactivated,
  IDENTITY_EVENTS.permissionsReplaced,
  IDENTITY_EVENTS.memberAccessChanged,
] as const;
