import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../shared/config/app-config.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { MailTransport } from '../service/mail.transport.js';
import {
  brandingFacadeOf,
  FakeEmailProvider,
  identityFacadeOf,
  TEST_BRANDING,
  TEST_PUBLIC_BASE_URL,
} from './fakes.js';

const configWith = (publicBaseUrl: string | undefined, env: object = {}): AppConfig =>
  ({ env: { PUBLIC_BASE_URL: publicBaseUrl, ...env } }) as unknown as AppConfig;

function transportOf(
  options: {
    readonly branding?: typeof TEST_BRANDING;
    readonly config?: AppConfig;
    readonly email?: FakeEmailProvider;
  } = {},
): MailTransport {
  return new MailTransport(
    brandingFacadeOf(options.branding),
    identityFacadeOf(new Map([[5, { email: 'user@example.test', locale: 'ar', active: true }]])),
    options.config ?? configWith(TEST_PUBLIC_BASE_URL),
    options.email ?? new FakeEmailProvider(),
  );
}

describe('MailTransport.brand', () => {
  it('names the company and makes the logo absolute with PUBLIC_BASE_URL', async () => {
    await expect(transportOf().brand()).resolves.toEqual({
      companyName: 'Company One',
      logoUrl: 'http://localhost:8088/uploads/company/logo.png',
    });
  });

  it('no logo file: no logo URL', async () => {
    const transport = transportOf({ branding: { ...TEST_BRANDING, logoFile: null } });
    await expect(transport.brand()).resolves.toEqual({ companyName: 'Company One', logoUrl: null });
  });

  it('no PUBLIC_BASE_URL: no logo URL (a relative path is useless in an email)', async () => {
    const transport = transportOf({ config: configWith(undefined) });
    await expect(transport.brand()).resolves.toEqual({ companyName: 'Company One', logoUrl: null });
  });
});

describe('MailTransport send, contact and Message-ID (04.3-06)', () => {
  it('messageIdOf(12) is <mail-12@localhost> with PUBLIC_BASE_URL http://localhost:8088', () => {
    expect(transportOf().messageIdOf(12)).toBe('<mail-12@localhost>');
  });

  it("messageIdOf takes PUBLIC_BASE_URL's host, and localhost without one", () => {
    expect(
      transportOf({ config: configWith('https://erp.example.test/base') }).messageIdOf(7),
    ).toBe('<mail-7@erp.example.test>');
    expect(transportOf({ config: configWith(undefined) }).messageIdOf(7)).toBe(
      '<mail-7@localhost>',
    );
  });

  it('send passes the message through to the port and answers its result', async () => {
    const email = new FakeEmailProvider();
    email.result = { ok: false, reason: 'timeout', transient: true, serverReply: null };
    const message = {
      to: 'user@example.test',
      subject: 'Subject',
      html: '<p>Body</p>',
      text: 'Body',
      messageId: '<mail-1@localhost>',
      locale: 'en',
    };
    await expect(transportOf({ email }).send(message)).resolves.toEqual(email.result);
    expect(email.sent).toEqual([message]);
  });

  it('configured follows the port', () => {
    const email = new FakeEmailProvider();
    const transport = transportOf({ email });
    expect(transport.configured).toBe(true);
    email.configured = false;
    expect(transport.configured).toBe(false);
  });

  it('contactOf reaches the identity facade', async () => {
    const transport = transportOf();
    await expect(transport.contactOf(5)).resolves.toEqual({
      email: 'user@example.test',
      locale: 'ar',
      active: true,
    });
    await expect(transport.contactOf(6)).resolves.toBeNull();
  });

  it("deferMs is the configured breaker's half-open delay (lead decision 2026-10-02)", () => {
    expect(transportOf().deferMs).toBe(TIMINGS.breaker.halfOpenAfterMs);
    const shortened = configWith(TEST_PUBLIC_BASE_URL, {
      RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS: 3_000,
    });
    expect(transportOf({ config: shortened }).deferMs).toBe(3_000);
  });
});

describe('MailTransport.smtpSettings (04.3-07, D-02)', () => {
  const SMTP = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_PORT: 465,
    SMTP_ENCRYPTION: 'ssl',
    SMTP_USERNAME: 'smtp-user-zz',
    SMTP_PASSWORD: 'pw-not-a-secret',
    MAIL_FROM_ADDRESS: 'no-reply@example.test',
    MAIL_FROM_NAME: 'Company One',
  };

  it('answers host, port, encryption and sender, and never a credential', () => {
    const settings = transportOf({ config: configWith(TEST_PUBLIC_BASE_URL, SMTP) }).smtpSettings();
    expect(settings).toEqual({
      host: 'smtp.example.test',
      port: 465,
      encryption: 'ssl',
      fromName: 'Company One',
      fromAddress: 'no-reply@example.test',
    });
    expect(JSON.stringify(settings)).not.toContain('smtp-user-zz');
    expect(JSON.stringify(settings)).not.toContain('pw-not-a-secret');
  });

  it('null when the port is not configured or a sender field is missing', () => {
    const email = new FakeEmailProvider();
    email.configured = false;
    const config = configWith(TEST_PUBLIC_BASE_URL, SMTP);
    expect(transportOf({ config, email }).smtpSettings()).toBeNull();
    const noName = configWith(TEST_PUBLIC_BASE_URL, { ...SMTP, MAIL_FROM_NAME: undefined });
    expect(transportOf({ config: noName }).smtpSettings()).toBeNull();
    expect(transportOf().smtpSettings()).toBeNull();
  });
});
