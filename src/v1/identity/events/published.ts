/**
 * Domain events this module publishes (ADR-0029, identity-access brief §7). Past-tense typed
 * classes extending `DomainEvent`, ids not entities, versioned — each with a `static readonly NAME`
 * the README's "Events published" table lists (the module-shape spec keeps the two in step).
 * Published through `DOMAIN_EVENT_PUBLISHER` from `service/identity.transport.ts`.
 *
 * **An event is a notification; the audit row is the record** (ADR-0034 decision 3). These carry
 * ids only, they are in-process today and they cannot say who changed whom — so every granting
 * change also writes one append-only `tblidentity_audit` row, inside the same transaction as the
 * change. Both are written; only the audit row is inside the transaction.
 *
 * Payloads never carry an e-mail, a password, a hash or a permission code (T-1.3-31) — a role
 * event carries the role id and nothing of its template, for the same reason.
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

/** Every member event carries the subject's staff id and the server time of the change. */
export interface MemberEventPayload {
  readonly staffId: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class IdentityMemberCreatedV1 extends DomainEvent<
  'identity.member.created',
  MemberEventPayload
> {
  static readonly NAME = 'identity.member.created' as const;
  readonly name = IdentityMemberCreatedV1.NAME;
}

export class IdentityMemberUpdatedV1 extends DomainEvent<
  'identity.member.updated',
  MemberEventPayload
> {
  static readonly NAME = 'identity.member.updated' as const;
  readonly name = IdentityMemberUpdatedV1.NAME;
}

/**
 * An administrator set the member's password. `auth` deletes the member's sessions and bumps the
 * token version on this, so a refresh cookie and an access token issued before it both stop working
 * at once (review CR-01 of Phase 3.1).
 */
export class IdentityMemberPasswordChangedV1 extends DomainEvent<
  'identity.member.passwordChanged',
  MemberEventPayload
> {
  static readonly NAME = 'identity.member.passwordChanged' as const;
  readonly name = IdentityMemberPasswordChangedV1.NAME;
}

export class IdentityMemberActivatedV1 extends DomainEvent<
  'identity.member.activated',
  MemberEventPayload
> {
  static readonly NAME = 'identity.member.activated' as const;
  readonly name = IdentityMemberActivatedV1.NAME;
}

/** `auth` deletes the sessions and bumps the token version on this, so a deactivated member's sessions end at once. */
export class IdentityMemberDeactivatedV1 extends DomainEvent<
  'identity.member.deactivated',
  MemberEventPayload
> {
  static readonly NAME = 'identity.member.deactivated' as const;
  readonly name = IdentityMemberDeactivatedV1.NAME;
}

/**
 * The member's administrator flag or role changed (review CR-02 a of Phase 3.1). Both are baked into
 * the access token (`admin`, `roles`) and into the `auth:perm` snapshot, so `auth` ends the member's
 * sessions and drops the snapshot: a demoted administrator's token stops working the moment the
 * save commits, instead of up to one access-token lifetime later. Published only when the stored
 * value actually changes, never for an unchanged flag or role.
 */
export class IdentityMemberAccessChangedV1 extends DomainEvent<
  'identity.member.accessChanged',
  MemberEventPayload
> {
  static readonly NAME = 'identity.member.accessChanged' as const;
  readonly name = IdentityMemberAccessChangedV1.NAME;
}

/**
 * The member's permission set was replaced. Plan 03.1-11 wires `auth`'s subscriber, which drops
 * `auth:perm:{staffId}` so the change applies on the next request rather than the next refresh
 * (threat T-3.1-47); the refresh rebuild is the backstop until then.
 */
export class IdentityPermissionsReplacedV1 extends DomainEvent<
  'identity.permissions.replaced',
  MemberEventPayload
> {
  static readonly NAME = 'identity.permissions.replaced' as const;
  readonly name = IdentityPermissionsReplacedV1.NAME;
}

/** Every role event carries the role's id and the server time of the change; never its template. */
export interface RoleEventPayload {
  readonly roleId: number;
  /** ISO timestamp. */
  readonly at: string;
}

/**
 * A role was created, changed or deleted. A role IS a permission set, so each of these is a granting
 * change with its own `tblidentity_audit` row (ADR-0034 d.3); the event is the notification and the
 * row is the record. No subscriber yet — `applyToMembers` reaches `auth` through the per-member
 * `identity.permissions.replaced` instead, because that is the event that names whose snapshot is
 * stale.
 */
export class IdentityRoleCreatedV1 extends DomainEvent<'identity.role.created', RoleEventPayload> {
  static readonly NAME = 'identity.role.created' as const;
  readonly name = IdentityRoleCreatedV1.NAME;
}

export class IdentityRoleUpdatedV1 extends DomainEvent<'identity.role.updated', RoleEventPayload> {
  static readonly NAME = 'identity.role.updated' as const;
  readonly name = IdentityRoleUpdatedV1.NAME;
}

export class IdentityRoleDeletedV1 extends DomainEvent<'identity.role.deleted', RoleEventPayload> {
  static readonly NAME = 'identity.role.deleted' as const;
  readonly name = IdentityRoleDeletedV1.NAME;
}

export const IDENTITY_PUBLISHED_EVENTS = [
  IdentityMemberCreatedV1.NAME,
  IdentityMemberUpdatedV1.NAME,
  IdentityMemberPasswordChangedV1.NAME,
  IdentityMemberActivatedV1.NAME,
  IdentityMemberDeactivatedV1.NAME,
  IdentityMemberAccessChangedV1.NAME,
  IdentityPermissionsReplacedV1.NAME,
  IdentityRoleCreatedV1.NAME,
  IdentityRoleUpdatedV1.NAME,
  IdentityRoleDeletedV1.NAME,
] as const;
