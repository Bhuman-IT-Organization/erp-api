/**
 * The SMTP adapter against the local Mailpit (ADR-0049 decision 10): SMTP on 127.0.0.1:11025 and
 * the REST API at MAILPIT_API_URL, both from ../erp-infra/env/local/api.host.env. Skips only when
 * MAILPIT_API_URL is absent; with it rendered and Mailpit down it fails, by design. Clears the
 * inbox before and after; the recipient is the synthetic user@example.test.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../../shared/config/app-config.js';
import { LoggerService, type LogMeta } from '../../../../shared/logger/logger.service.js';
import { redact } from '../../../../shared/logger/redact.js';
import { BreakerRegistry } from '../../../../shared/resilience/breaker.js';
import { breakerOptions } from '../../../../shared/resilience/resilience.module.js';
import { SmtpAdapter } from '../smtp.adapter.js';
import { mailpit } from './mailpit.js';

const MAILPIT_API_URL = process.env.MAILPIT_API_URL;

class RecordingLogger extends LoggerService {
  readonly lines: string[] = [];
  override warn(message: string, meta?: LogMeta): void {
    this.lines.push(JSON.stringify({ message, meta: redact(meta) }));
  }
  override log(message: string, meta?: LogMeta): void {
    this.lines.push(JSON.stringify({ message, meta: redact(meta) }));
  }
  override error(message: string, meta?: LogMeta): void {
    this.lines.push(JSON.stringify({ message, meta: redact(meta) }));
  }
}

describe.skipIf(!MAILPIT_API_URL)('SmtpAdapter against the local Mailpit', () => {
  const box = mailpit(MAILPIT_API_URL ?? 'http://127.0.0.1:18025');
  const config = new AppConfig();
  const logger = new RecordingLogger();
  const breakers = new BreakerRegistry(breakerOptions(config.env), logger);
  const adapter = new SmtpAdapter(config, breakers, logger);

  beforeAll(async () => {
    await box.clear();
  });

  afterAll(async () => {
    adapter.onModuleDestroy();
    breakers.onModuleDestroy();
    await box.clear();
  });

  it('delivers one message with an HTML part, a text part, the env From and Content-Language', async () => {
    expect(adapter.configured).toBe(true);
    const messageId = `<mail-int-${randomUUID()}@erp.local.test>`;
    const result = await adapter.send({
      to: 'user@example.test',
      subject: 'Mailpit int spec',
      html: '<p>Hello from the int spec</p>',
      text: 'Hello from the int spec',
      messageId,
      locale: 'en',
    });
    expect(result).toEqual({ ok: true });

    const found = await box.findByMessageId(messageId);
    expect(found).not.toBeNull();
    const message = await box.message(found?.id ?? '');
    expect(message.HTML).toContain('<p>Hello from the int spec</p>');
    expect(message.Text).toContain('Hello from the int spec');
    expect(message.From).toEqual({
      Name: config.env.MAIL_FROM_NAME,
      Address: config.env.MAIL_FROM_ADDRESS,
    });
    expect(message.Headers?.['Content-Language']).toEqual(['en']);
  });

  it('wrote no log line holding the SMTP password, when one is set', () => {
    const secret = config.env.SMTP_PASSWORD;
    expect(logger.lines.filter((l) => secret !== undefined && l.includes(secret))).toEqual([]);
  });
});
