/**
 * Transport: the mail module's outbound seam, and the one file here that reaches other modules'
 * facades (`BrandingFacade`, `IdentityFacade` through their `index.js`, BE-03) and the email port
 * (`EMAIL_PROVIDER`, BE-16 "Instead"; never the adapter, PATTERNS M4).
 *
 * - `brand()` is the brand every email carries (D-04, PATTERNS M3): the company name from branding,
 *   and the logo the web shows (`BrandingFacade.logoPathOf`, a same-origin path) made absolute with
 *   `PUBLIC_BASE_URL`, because an email client has no origin to resolve a relative path against.
 * - `send(message)` hands one rendered email to the port; the port answers a classified
 *   `SendResult` and rejects only with `UpstreamUnavailableError` (the `email` breaker is open),
 *   which propagates to the processor.
 * - `contactOf(staffId)` is a member's address and locale (identity owns it, PATTERNS M1).
 * - `messageIdOf(id)` is `<mail-<id>@<PUBLIC_BASE_URL host>>`, so a resend after a crash is
 *   recognisable (ADR-0049 decision 5).
 * - `smtpSettings()` is what the status page may show of the deployment's SMTP setup: host, port,
 *   encryption and sender, or null when mail is not configured; never the user name or the secret (D-02).
 * - `deferMs` is how long a job waits while the breaker is open: the configured breaker's half-open
 *   delay (lead decision 2026-10-02; `TIMINGS.breaker.halfOpenAfterMs` in production).
 */
import { Inject, Injectable } from '@nestjs/common';
import {
  EMAIL_PROVIDER,
  type EmailMessage,
  type EmailProviderPort,
  type SendResult,
} from '../../../integrations/ports/email-provider.port.js';
import { AppConfig } from '../../../shared/config/app-config.js';
import { breakerOptions } from '../../../shared/resilience/resilience.module.js';
import { BrandingFacade } from '../../branding/index.js';
import { IdentityFacade, type StaffContact } from '../../identity/index.js';
import type { MailSmtpSettings } from '../model/mail.model.js';
import type { MailBrand } from './mail.renderer.js';

/** The Message-ID domain without `PUBLIC_BASE_URL` (tests only: it is required elsewhere). */
const FALLBACK_HOST = 'localhost';

@Injectable()
export class MailTransport {
  constructor(
    private readonly branding: BrandingFacade,
    private readonly identity: IdentityFacade,
    private readonly config: AppConfig,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProviderPort,
  ) {}

  /** false when SMTP_HOST is absent: nothing can be sent. */
  get configured(): boolean {
    return this.email.configured;
  }

  /** The configured `email` breaker's half-open delay: a deferred job is retried after it. */
  get deferMs(): number {
    return breakerOptions(this.config.env).halfOpenAfterMs;
  }

  /** Host, port, encryption and sender; null when mail is not configured. Reads no credential. */
  smtpSettings(): MailSmtpSettings | null {
    const env = this.config.env;
    const host = env.SMTP_HOST;
    const port = env.SMTP_PORT;
    const encryption = env.SMTP_ENCRYPTION;
    const fromName = env.MAIL_FROM_NAME;
    const fromAddress = env.MAIL_FROM_ADDRESS;
    if (!this.configured || host === undefined || port === undefined) return null;
    if (encryption === undefined || fromName === undefined || fromAddress === undefined)
      return null;
    return { host, port, encryption, fromName, fromAddress };
  }

  /** The company name, and the logo URL or null when there is no logo or no public base URL. */
  async brand(): Promise<MailBrand> {
    const branding = await this.branding.current();
    const path = this.branding.logoPathOf(branding);
    const base = this.config.env.PUBLIC_BASE_URL;
    return {
      companyName: branding.companyName,
      logoUrl: path === null || base === undefined ? null : new URL(path, base).href,
    };
  }

  /** One rendered email to the port; rejects only with `UpstreamUnavailableError`. */
  send(message: EmailMessage): Promise<SendResult> {
    return this.email.send(message);
  }

  /** A member's address, locale and active flag, or null for an unknown id. */
  contactOf(staffId: number): Promise<StaffContact | null> {
    return this.identity.contactOf(staffId);
  }

  /** `<mail-<id>@<host>>`, the host of `PUBLIC_BASE_URL`. */
  messageIdOf(sentEmailId: number): string {
    const base = this.config.env.PUBLIC_BASE_URL;
    const host = base === undefined ? FALLBACK_HOST : new URL(base).hostname;
    return `<mail-${String(sentEmailId)}@${host}>`;
  }
}
