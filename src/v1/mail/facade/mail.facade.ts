/**
 * Facade: the ONLY surface other modules may import (ADR-0001, BE-03). A sending module registers
 * its templates, seeds them and sends through it; `send` never throws, so a mail failure can never
 * fail the action that triggered it (D-01).
 */
import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type { SendOutcome, SendRequest } from '../model/mail.model.js';
import {
  MailTemplateRegistry,
  type MailTemplateDefinition,
} from '../service/mail-template.registry.js';
import { MailService } from '../service/mail.service.js';

/** What a sending module calls: register its templates, seed them, send. */
@Injectable()
export class MailFacade {
  constructor(
    private readonly registry: MailTemplateRegistry,
    private readonly service: MailService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Registers one of the calling module's email templates. Call it from the sending module's
   * `onModuleInit`, so the worker registers it too (Pitfall 12). Throws on a duplicate key or a
   * malformed definition, so a bad definition fails at boot.
   */
  register(definition: MailTemplateDefinition): void {
    this.registry.register(definition);
  }

  /**
   * Copies Perfex's current wording for a registered key into Node's store, once (D-03, D-09). Call
   * it before the key's first send; a second call, or a second process, changes nothing. Rejects
   * when the key is not registered.
   */
  ensureSeeded(key: string): Promise<void> {
    return this.service.ensureSeeded(key);
  }

  /**
   * Queues one email about `sourceRef` with the `template` key's current wording; the recipient and
   * the values are resolved again when it is sent (D-09). NEVER throws: it answers `queued`,
   * `duplicate` (the `dedupeKey` was used before), `not_configured` (logged as failed), `skipped`
   * (not registered, template off, record gone, no valid recipient; no log row) or `not_enqueued`
   * (an error, logged with the key only; a row already written is re-added by the sweep).
   *
   * Call it from your transport AFTER your transaction has committed, never inside it (RESEARCH
   * Pitfall 8), with a `dedupeKey` when the trigger can fire twice.
   */
  async send(request: SendRequest): Promise<SendOutcome> {
    try {
      return await this.service.enqueue(request);
    } catch (error: unknown) {
      this.logger.error('mail send not enqueued', { template: request.template, error });
      return { status: 'not_enqueued' };
    }
  }
}
