/**
 * Domain events this module subscribes to (ADR-0029). Handlers live in `events/handlers/` and are
 * the only way another module's change reaches this one.
 *
 * None, and that is a decision rather than a gap: identity is the authority on who may do what, so
 * nothing another module publishes can change a `tblstaff`, `tblroles` or `tblstaff_permissions`
 * row (ADR-0034 decision 1). A subscriber here would be a second writer with an extra step. The
 * traffic runs the other way — `v1/auth` subscribes to this module's events
 * (`src/v1/auth/events/subscribed.ts`), and the one thing it needs synchronously it asks the facade
 * for.
 */
export const IDENTITY_SUBSCRIBED_EVENTS = [] as const;
