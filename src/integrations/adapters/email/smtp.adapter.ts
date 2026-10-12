/**
 * The SMTP adapter of `EMAIL_PROVIDER` (BE-16; ADR-0049 decisions 2, 3 and 9): the only file that
 * imports nodemailer. One pooled transport, built lazily on the first send and only when SMTP_HOST
 * is set, closed on destroy. TLS 1.2 at least, certificate checks never disabled, no file or URL
 * access, nodemailer's logger and debug output off.
 *
 * Every send runs inside the `email` breaker. Only connection failures, timeouts and reply 421
 * are thrown inside it (as `SmtpConnectionError`, whose `code` makes `isTransientError` count it);
 * every other refusal returns a classified `SendResult` (`smtp-classify.ts`), so one refused
 * address never pauses all mail (Pitfall 5). Outside the breaker the adapter throws nothing but
 * `UpstreamUnavailableError`. No retry wrapper and no pool requeue (the queue is the only retry
 * layer) and no abort-signal deadline (SMTP has no AbortSignal: `TIMINGS.mail.smtp` sets
 * nodemailer's own stage timeouts), the documented BE-18 divergence.
 *
 * It never logs the options, the address, the subject or the reply: a failure logs
 * `email send failed` with `{ reason, transient }` only (T-4.3-06).
 */
import { Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type SMTPPoolOptions } from 'nodemailer';
import { AppConfig } from '../../../shared/config/app-config.js';
import type { Env } from '../../../shared/config/env.schema.js';
import { POOL } from '../../../shared/config/pool.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { UpstreamUnavailableError } from '../../../shared/errors/upstream-unavailable.error.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { BreakerRegistry, type Breaker } from '../../../shared/resilience/breaker.js';
import type {
  EmailMessage,
  EmailProviderPort,
  SendResult,
} from '../../ports/email-provider.port.js';
import { classifySmtpError, type FailedSend } from './smtp-classify.js';

/** What the adapter needs of a nodemailer transport; tests pass a stub. */
export interface SmtpTransportLike {
  sendMail(message: object): Promise<unknown>;
  close(): void;
}

export type SmtpTransportFactory = (options: object) => SmtpTransportLike;

/** Tests provide a stub factory under this token; production leaves it unset (nodemailer). */
export const SMTP_TRANSPORT_FACTORY = Symbol('SMTP_TRANSPORT_FACTORY');

const OK: SendResult = Object.freeze({ ok: true });
const UNKNOWN: FailedSend = Object.freeze({
  ok: false,
  reason: 'unknown',
  transient: false,
  serverReply: null,
});

/** An outage the `email` breaker must count; `code` is one `isTransientError` knows. */
class SmtpConnectionError extends Error {
  override readonly name = 'SmtpConnectionError';
  readonly code: string;

  constructor(readonly result: FailedSend) {
    super(`smtp ${result.reason}`);
    this.code = result.reason === 'timeout' ? 'ETIMEDOUT' : 'ECONNREFUSED';
  }
}

const nodemailerFactory: SmtpTransportFactory = (options) =>
  createTransport(options as SMTPPoolOptions & { pool: true });

/** The transport options from env, TIMINGS and POOL; never logged (Pitfall 6). */
function transportOptions(env: Env, host: string): SMTPPoolOptions & { pool: true } {
  return {
    host,
    port: env.SMTP_PORT,
    secure: env.SMTP_ENCRYPTION === 'ssl',
    requireTLS: env.SMTP_ENCRYPTION === 'tls',
    ignoreTLS: false,
    ...(env.SMTP_USERNAME === undefined
      ? {}
      : { auth: { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD } }),
    pool: true,
    maxConnections: POOL.smtp.maxConnections,
    maxMessages: POOL.smtp.maxMessages,
    // The pool would re-send a message up to 5 times on a dropped connection; the queue retries.
    maxRequeues: 0,
    connectionTimeout: TIMINGS.mail.smtp.connectionTimeoutMs,
    greetingTimeout: TIMINGS.mail.smtp.greetingTimeoutMs,
    socketTimeout: TIMINGS.mail.smtp.socketTimeoutMs,
    dnsTimeout: TIMINGS.mail.smtp.dnsTimeoutMs,
    tls: { minVersion: 'TLSv1.2' },
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  };
}

@Injectable()
export class SmtpAdapter implements EmailProviderPort, OnModuleDestroy {
  readonly configured: boolean;

  private readonly email: Breaker;
  private readonly factory: SmtpTransportFactory;
  private transport: SmtpTransportLike | null = null;

  constructor(
    private readonly config: AppConfig,
    breakers: BreakerRegistry,
    private readonly logger: LoggerService,
    @Optional() @Inject(SMTP_TRANSPORT_FACTORY) factory?: SmtpTransportFactory,
  ) {
    this.configured = config.env.SMTP_HOST !== undefined;
    this.email = breakers.get('email');
    this.factory = factory ?? nodemailerFactory;
  }

  async send(message: EmailMessage): Promise<SendResult> {
    const host = this.config.env.SMTP_HOST;
    if (host === undefined) return UNKNOWN;
    let result: FailedSend;
    try {
      const transport = this.transportFor(host);
      return await this.email.execute(() => this.sendOnce(transport, message));
    } catch (error) {
      if (error instanceof UpstreamUnavailableError) throw error;
      result = error instanceof SmtpConnectionError ? error.result : UNKNOWN;
    }
    return this.failed(result);
  }

  onModuleDestroy(): void {
    try {
      this.transport?.close();
    } catch {
      // Already closed: nothing to release.
    }
    this.transport = null;
  }

  /** Inside the breaker: an outage throws (and counts), a refusal is a value (and does not). */
  private async sendOnce(transport: SmtpTransportLike, message: EmailMessage): Promise<SendResult> {
    try {
      await transport.sendMail(this.mailOf(message));
      return OK;
    } catch (error) {
      const classification = classifySmtpError(error);
      if (classification.countsOnBreaker) throw new SmtpConnectionError(classification.result);
      return this.failed(classification.result);
    }
  }

  private failed(result: FailedSend): FailedSend {
    this.logger.warn('email send failed', { reason: result.reason, transient: result.transient });
    return result;
  }

  private transportFor(host: string): SmtpTransportLike {
    this.transport ??= this.factory(transportOptions(this.config.env, host));
    return this.transport;
  }

  private mailOf(message: EmailMessage): object {
    const { env } = this.config;
    return {
      from: { name: env.MAIL_FROM_NAME ?? '', address: env.MAIL_FROM_ADDRESS ?? '' },
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      messageId: message.messageId,
      headers: { 'Content-Language': message.locale },
      ...(message.attachments?.length
        ? {
            attachments: message.attachments.map((a) => ({
              filename: a.filename,
              contentType: a.contentType,
              content: a.content,
            })),
          }
        : {}),
    };
  }
}
