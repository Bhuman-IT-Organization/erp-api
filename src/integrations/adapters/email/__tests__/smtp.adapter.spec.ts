import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../../shared/config/app-config.js';
import type { Env } from '../../../../shared/config/env.schema.js';
import { UpstreamUnavailableError } from '../../../../shared/errors/upstream-unavailable.error.js';
import { LoggerService, type LogMeta } from '../../../../shared/logger/logger.service.js';
import { redact } from '../../../../shared/logger/redact.js';
import { BreakerRegistry } from '../../../../shared/resilience/breaker.js';
import type { EmailMessage } from '../../../ports/email-provider.port.js';
import { SmtpAdapter, type SmtpTransportLike } from '../smtp.adapter.js';

const PASSWORD = 'pw-not-a-secret';

/** A complete SMTP env with credentials; synthetic values only. */
const SMTP_ENV = {
  NODE_ENV: 'test',
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: 587,
  SMTP_ENCRYPTION: 'tls',
  SMTP_USERNAME: 'user@example.test',
  SMTP_PASSWORD: PASSWORD,
  MAIL_FROM_ADDRESS: 'no-reply@erp.local.test',
  MAIL_FROM_NAME: 'ERP (test)',
};

const MESSAGE: EmailMessage = {
  to: 'user@example.test',
  subject: 'Approval needed',
  html: '<p>Hello</p>',
  text: 'Hello',
  messageId: '<mail-1@erp.local.test>',
  locale: 'en',
};

function configOf(env: Record<string, unknown>): AppConfig {
  return { env: env as unknown as Env };
}

/** Every line as the logger would write it: the message and its meta through `redact`. */
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

/** A stub transport: each `sendMail` takes the next outcome; an Error rejects, anything else resolves. */
class StubTransport implements SmtpTransportLike {
  readonly sent: Record<string, unknown>[] = [];
  closed = 0;
  constructor(private readonly outcomes: unknown[] = []) {}
  sendMail(message: object): Promise<unknown> {
    this.sent.push(message as Record<string, unknown>);
    const next = this.outcomes.shift();
    return next instanceof Error ? Promise.reject(next) : Promise.resolve({ accepted: [] });
  }
  close(): void {
    this.closed += 1;
  }
}

function smtpError(fields: Record<string, unknown>): Error {
  return Object.assign(new Error('smtp failure'), fields);
}

describe('SmtpAdapter (BE-16, ADR-0049)', () => {
  let logger: RecordingLogger;
  let breakers: BreakerRegistry;
  let factoryCalls: object[];

  beforeEach(() => {
    logger = new RecordingLogger();
    breakers = new BreakerRegistry(
      {
        volumeThreshold: 2,
        errorThresholdPercentage: 50,
        rollingWindowMs: 60_000,
        halfOpenAfterMs: 10_000,
      },
      logger,
    );
    factoryCalls = [];
  });

  afterEach(() => {
    breakers.onModuleDestroy();
  });

  function adapterWith(transport: StubTransport, env: Record<string, unknown> = SMTP_ENV) {
    return new SmtpAdapter(configOf(env), breakers, logger, (options) => {
      factoryCalls.push(options);
      return transport;
    });
  }

  it('sends one message: From from env, the fields of the message and Content-Language', async () => {
    const transport = new StubTransport();
    const adapter = adapterWith(transport);
    expect(adapter.configured).toBe(true);
    await expect(adapter.send(MESSAGE)).resolves.toEqual({ ok: true });
    expect(transport.sent).toEqual([
      {
        from: { name: 'ERP (test)', address: 'no-reply@erp.local.test' },
        to: 'user@example.test',
        subject: 'Approval needed',
        html: '<p>Hello</p>',
        text: 'Hello',
        messageId: '<mail-1@erp.local.test>',
        headers: { 'Content-Language': 'en' },
      },
    ]);
  });

  it('maps attachments to nodemailer attachments (file name, type, content) and nothing else (ADR-0052)', async () => {
    const transport = new StubTransport();
    const content = Buffer.from('made-up file', 'utf8');
    await adapterWith(transport).send({
      ...MESSAGE,
      attachments: [{ filename: 'notes.txt', contentType: 'text/plain', content }],
    });
    expect(transport.sent[0]?.attachments).toEqual([
      { filename: 'notes.txt', contentType: 'text/plain', content },
    ]);
  });

  it('a message without attachments, or with none, sets no attachments key', async () => {
    const transport = new StubTransport();
    const adapter = adapterWith(transport);
    await adapter.send(MESSAGE);
    await adapter.send({ ...MESSAGE, attachments: [] });
    expect(transport.sent[0]).not.toHaveProperty('attachments');
    expect(transport.sent[1]).not.toHaveProperty('attachments');
  });

  it('builds the transport once, lazily, and closes it on destroy', async () => {
    const transport = new StubTransport();
    const adapter = adapterWith(transport);
    expect(factoryCalls).toHaveLength(0);
    await adapter.send(MESSAGE);
    await adapter.send(MESSAGE);
    expect(factoryCalls).toHaveLength(1);
    adapter.onModuleDestroy();
    expect(transport.closed).toBe(1);
  });

  it('swallows a close that throws (already closed)', async () => {
    const transport = new StubTransport();
    transport.close = () => {
      throw new Error('already closed');
    };
    const adapter = adapterWith(transport);
    await adapter.send(MESSAGE);
    expect(() => {
      adapter.onModuleDestroy();
    }).not.toThrow();
  });

  it('a recipient refusal never trips it: five 550 refusals, five values, the breaker stays closed (Pitfall 5)', async () => {
    const refusal = () => smtpError({ code: 'EENVELOPE', responseCode: 550 });
    const transport = new StubTransport(Array.from({ length: 5 }, refusal));
    const adapter = adapterWith(transport);
    for (let i = 0; i < 5; i += 1) {
      await expect(adapter.send(MESSAGE)).resolves.toMatchObject({
        ok: false,
        reason: 'recipient_refused',
        transient: false,
      });
    }
    expect(breakers.get('email').state).toBe('closed');
    expect(transport.sent).toHaveLength(5);
  });

  it('two connection failures open the breaker; the third call throws UpstreamUnavailableError without a send', async () => {
    const down = () => smtpError({ code: 'ECONNECTION' });
    const transport = new StubTransport([down(), down()]);
    const adapter = adapterWith(transport);
    await expect(adapter.send(MESSAGE)).resolves.toEqual({
      ok: false,
      reason: 'server_unreachable',
      transient: true,
      serverReply: null,
    });
    await expect(adapter.send(MESSAGE)).resolves.toMatchObject({ reason: 'server_unreachable' });
    expect(breakers.get('email').state).toBe('open');
    await expect(adapter.send(MESSAGE)).rejects.toBeInstanceOf(UpstreamUnavailableError);
    expect(transport.sent).toHaveLength(2);
  });

  it('a timeout is returned as timeout and counts', async () => {
    const transport = new StubTransport([smtpError({ code: 'ETIMEDOUT' })]);
    const adapter = adapterWith(transport);
    await expect(adapter.send(MESSAGE)).resolves.toMatchObject({
      reason: 'timeout',
      transient: true,
    });
  });

  it('reply 421 counts on the breaker: two of them open it', async () => {
    const closing = () => smtpError({ code: 'EENVELOPE', responseCode: 421, response: '421 bye' });
    const adapter = adapterWith(new StubTransport([closing(), closing()]));
    await expect(adapter.send(MESSAGE)).resolves.toMatchObject({
      reason: 'server_unreachable',
      serverReply: '421 bye',
    });
    await adapter.send(MESSAGE);
    expect(breakers.get('email').state).toBe('open');
  });

  it('a transport that cannot be built answers unknown, final', async () => {
    const adapter = new SmtpAdapter(configOf(SMTP_ENV), breakers, logger, () => {
      throw new Error('bad options');
    });
    await expect(adapter.send(MESSAGE)).resolves.toEqual({
      ok: false,
      reason: 'unknown',
      transient: false,
      serverReply: null,
    });
  });

  it('without SMTP_HOST: not configured, no factory call, the not-configured value', async () => {
    const transport = new StubTransport();
    const adapter = adapterWith(transport, { NODE_ENV: 'test' });
    expect(adapter.configured).toBe(false);
    await expect(adapter.send(MESSAGE)).resolves.toEqual({
      ok: false,
      reason: 'unknown',
      transient: false,
      serverReply: null,
    });
    expect(factoryCalls).toHaveLength(0);
    adapter.onModuleDestroy();
    expect(transport.closed).toBe(0);
  });

  it('passes the pooled, hardened options: TLS 1.2, no file or URL access, no logger, no pool requeue (T-4.3-22)', async () => {
    await adapterWith(new StubTransport()).send(MESSAGE);
    expect(factoryCalls[0]).toEqual({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
      auth: { user: 'user@example.test', pass: PASSWORD },
      pool: true,
      maxConnections: 2,
      maxMessages: 100,
      maxRequeues: 0,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
      dnsTimeout: 5_000,
      tls: { minVersion: 'TLSv1.2' },
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
  });

  it('ssl is implicit TLS (secure: true); none requires no TLS; no username means no auth', async () => {
    await adapterWith(new StubTransport(), { ...SMTP_ENV, SMTP_ENCRYPTION: 'ssl' }).send(MESSAGE);
    expect(factoryCalls[0]).toMatchObject({ secure: true, requireTLS: false });
    const open = { ...SMTP_ENV, SMTP_USERNAME: undefined, SMTP_PASSWORD: undefined };
    await adapterWith(new StubTransport(), { ...open, SMTP_ENCRYPTION: 'none' }).send(MESSAGE);
    expect(factoryCalls[1]).toMatchObject({ secure: false, requireTLS: false });
    expect(factoryCalls[1]).not.toHaveProperty('auth');
  });

  it('never lets the password reach a log line: the options through redact, a failed send through the logger (T-4.3-06)', async () => {
    const transport = new StubTransport([
      smtpError({ code: 'EAUTH', responseCode: 535, response: `535 rejected ${PASSWORD}` }),
    ]);
    const adapter = adapterWith(transport);
    await expect(adapter.send(MESSAGE)).resolves.toMatchObject({ reason: 'auth_failed' });
    logger.warn('transport options', factoryCalls[0] as LogMeta);
    expect(logger.lines.length).toBeGreaterThanOrEqual(2);
    expect(logger.lines.join('\n')).not.toContain(PASSWORD);
    expect(logger.lines[0]).toBe(
      JSON.stringify({
        message: 'email send failed',
        meta: { reason: 'auth_failed', transient: false },
      }),
    );
  });
});
