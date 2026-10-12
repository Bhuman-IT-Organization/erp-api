import { PassThrough } from 'node:stream';
import winston from 'winston';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import type { Env } from '../../config/env.schema.js';
import { LoggerService } from '../logger.service.js';
import { runWithRequestContext } from '../request-context.js';

/** Only `NODE_ENV` matters to the logger; the rest of `Env` is never read. */
function configFor(nodeEnv: Env['NODE_ENV']): AppConfig {
  return { env: { NODE_ENV: nodeEnv } as Env };
}

/**
 * The service under test with its console transport swapped for an in-memory stream, so the
 * spec reads the exact bytes a line would carry. The internal winston logger is private on
 * purpose; the spec reaches it once, here, and nowhere else.
 */
function captured(config?: AppConfig) {
  const service = new LoggerService(config);
  const internal = (service as unknown as { logger: winston.Logger }).logger;
  const lines: string[] = [];
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) if (line !== '') lines.push(line);
  });
  for (const transport of [...internal.transports]) internal.remove(transport);
  internal.add(new winston.transports.Stream({ stream }));
  const last = (): Record<string, unknown> => {
    const line = lines.at(-1);
    if (line === undefined) throw new Error('no line written');
    return JSON.parse(line) as Record<string, unknown>;
  };
  return { service, lines, last };
}

describe('LoggerService request context (T-2-02, T-2-03)', () => {
  it('stamps requestId and staffId on a line written inside a scope', () => {
    const { service, last } = captured();
    runWithRequestContext({ requestId: 'r1', staffId: 7 }, () => {
      service.log('hello', { extra: 1 });
    });
    expect(last()).toMatchObject({
      level: 'info',
      message: 'hello',
      requestId: 'r1',
      staffId: 7,
      extra: 1,
    });
  });

  it('omits staffId until it is bound and carries neither field outside a scope', () => {
    const { service, last } = captured();
    runWithRequestContext({ requestId: 'r2' }, () => {
      service.warn('inside');
    });
    expect(last()).toMatchObject({ requestId: 'r2' });
    expect('staffId' in last()).toBe(false);

    service.log('outside');
    expect('requestId' in last()).toBe(false);
    expect('staffId' in last()).toBe(false);
  });

  it('still redacts a password after the context merge', () => {
    const { service, last } = captured();
    runWithRequestContext({ requestId: 'r3', staffId: 1 }, () => {
      service.error('login', { password: 'hunter2', nested: { token: 't' } });
    });
    const line = last();
    expect(line.requestId).toBe('r3');
    expect(line.password).toBe('[REDACTED]');
    expect((line.nested as Record<string, unknown>).token).toBe('[REDACTED]');
    expect(JSON.stringify(line)).not.toContain('hunter2');
  });

  it('lets an explicit meta key win over the context and keeps the Nest context argument', () => {
    const { service, last } = captured();
    runWithRequestContext({ requestId: 'r4' }, () => {
      service.debug('msg', { requestId: 'explicit' }, 'SomeContext');
    });
    expect(last()).toMatchObject({ requestId: 'explicit', context: 'SomeContext' });
  });
});

describe('LoggerService format', () => {
  it("is 'pretty' only in development", () => {
    expect(new LoggerService(configFor('development')).format).toBe('pretty');
  });

  it("is 'json' in production, test and without a config", () => {
    expect(new LoggerService(configFor('production')).format).toBe('json');
    expect(new LoggerService(configFor('test')).format).toBe('json');
    expect(new LoggerService().format).toBe('json');
  });

  it('has exactly one transport (ADR-0021: shipping is erp-infra)', () => {
    for (const config of [undefined, configFor('development'), configFor('production')]) {
      const internal = (new LoggerService(config) as unknown as { logger: winston.Logger }).logger;
      expect(internal.transports).toHaveLength(1);
      expect(internal.transports[0]).toBeInstanceOf(winston.transports.Console);
    }
  });

  it('writes a single line in pretty mode with the meta appended as JSON', () => {
    const { service, lines } = captured(configFor('development'));
    runWithRequestContext({ requestId: 'r5' }, () => {
      service.log('pretty line', { a: 1 });
    });
    expect(lines).toHaveLength(1);
    const line = lines[0] ?? '';
    expect(line).toContain('pretty line');
    expect(line).toContain('"requestId":"r5"');
    expect(line).toContain('"a":1');
  });
});
