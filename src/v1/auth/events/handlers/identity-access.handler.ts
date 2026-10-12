/**
 * The subscriber for `v1/identity`'s four member events (identity-access brief §7, ADR-0029, and
 * review CR-02 a of Phase 3.1).
 *
 * It registers on `DOMAIN_EVENT_SUBSCRIBER` from `onModuleInit`, so the handlers exist before the
 * first request, and it reaches `v1/identity` through **nothing at all** — the names are wire
 * constants in `events/subscribed.ts` and the payload is parsed, never imported (BE-03). The one
 * thing `auth` needs synchronously it asks `IdentityFacade.permissionsOf` for.
 *
 *   `identity.member.passwordChanged` → end the sessions: delete every `auth:sess:*` of the member
 *                                       (a refresh cookie dies) and bump the token version (an
 *                                       access token dies), at once (review CR-01)
 *   `identity.member.deactivated`     → end the sessions, same reason
 *   `identity.member.accessChanged`   → end the sessions AND drop `auth:perm:{staffId}`: the admin
 *                                       flag and the role are baked into both (review CR-02 a)
 *   `identity.permissions.replaced`   → drop `auth:perm:{staffId}` so the change applies on the next
 *                                       request rather than the next refresh (threat T-3.1-47); the
 *                                       refresh rebuild stays the backstop
 *
 * A payload that does not carry a positive integer `staffId` is dropped with one `warn` and never
 * guessed at: bumping the wrong member's version would sign them out for nothing.
 */
import { Injectable, type OnModuleInit, Inject } from '@nestjs/common';
import { z } from 'zod';
import {
  DOMAIN_EVENT_SUBSCRIBER,
  type DomainEventSubscriber,
} from '../../../../shared/events/domain-event.publisher.js';
import type { DomainEvent } from '../../../../shared/events/domain-event.js';
import { LoggerService } from '../../../../shared/logger/logger.service.js';
import { AuthService } from '../../service/auth.service.js';
import { IDENTITY_EVENTS } from '../subscribed.js';

/** Every one of the four payloads is `{ staffId, at }`; only `staffId` is acted on. */
const memberEventPayloadSchema = z.object({ staffId: z.number().int().positive() });

@Injectable()
export class IdentityAccessEventHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_SUBSCRIBER) private readonly subscriber: DomainEventSubscriber,
    private readonly service: AuthService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit(): void {
    this.subscriber.subscribe(IDENTITY_EVENTS.memberPasswordChanged, (event) =>
      this.endSessions(event),
    );
    this.subscriber.subscribe(IDENTITY_EVENTS.memberDeactivated, (event) =>
      this.endSessions(event),
    );
    this.subscriber.subscribe(IDENTITY_EVENTS.permissionsReplaced, (event) =>
      this.dropSnapshot(event),
    );
    this.subscriber.subscribe(IDENTITY_EVENTS.memberAccessChanged, (event) =>
      this.endSessionsAndDropSnapshot(event),
    );
  }

  /**
   * The sessions are deleted and the token version is bumped, so every refresh cookie and every
   * access token issued before this moment is refused.
   */
  private async endSessions(event: DomainEvent): Promise<void> {
    const staffId = this.staffIdOf(event);
    if (staffId === null) return;
    await this.service.endSessionsOf(staffId);
  }

  /** The ADR-0033 snapshot is dropped, so the next request rebuilds it from the current rows. */
  private async dropSnapshot(event: DomainEvent): Promise<void> {
    const staffId = this.staffIdOf(event);
    if (staffId === null) return;
    await this.service.dropPermissionSnapshot(staffId);
  }

  /** An admin-flag or role change: both of the above, the payload parsed once. */
  private async endSessionsAndDropSnapshot(event: DomainEvent): Promise<void> {
    const staffId = this.staffIdOf(event);
    if (staffId === null) return;
    await this.service.endSessionsOf(staffId);
    await this.service.dropPermissionSnapshot(staffId);
  }

  private staffIdOf(event: DomainEvent): number | null {
    const parsed = memberEventPayloadSchema.safeParse(event.payload);
    if (parsed.success) return parsed.data.staffId;
    this.logger.warn('identity event dropped: payload carries no staffId', { event: event.name });
    return null;
  }
}
