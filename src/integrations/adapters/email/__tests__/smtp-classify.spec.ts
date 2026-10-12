import { describe, expect, it } from 'vitest';
import { classifySmtpError, cleanServerReply } from '../smtp-classify.js';

/** A nodemailer-shaped error as a plain object: `code`, `responseCode`, `response`. */
interface Shape {
  code?: string;
  responseCode?: number;
  response?: string;
}

describe('classifySmtpError (RESEARCH R2, ADR-0049)', () => {
  it.each<[string, Shape]>([
    ['EAUTH', { code: 'EAUTH', responseCode: 535, response: '535 5.7.8 bad credentials' }],
    ['ENOAUTH', { code: 'ENOAUTH' }],
    ['EREQUIRETLS', { code: 'EREQUIRETLS' }],
  ])('auth: %s is auth_failed, final, not counted', (_name, error) => {
    const c = classifySmtpError(error);
    expect(c.result.reason).toBe('auth_failed');
    expect(c.result.transient).toBe(false);
    expect(c.countsOnBreaker).toBe(false);
  });

  it.each([
    'ECONNECTION',
    'ESOCKET',
    'EDNS',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'EPIPE',
  ])('connection: %s is server_unreachable, transient, counted, no reply', (code) => {
    const c = classifySmtpError({ code });
    expect(c.result).toEqual({
      ok: false,
      reason: 'server_unreachable',
      transient: true,
      serverReply: null,
    });
    expect(c.countsOnBreaker).toBe(true);
  });

  it('timeout: ETIMEDOUT is timeout, transient, counted', () => {
    const c = classifySmtpError({ code: 'ETIMEDOUT' });
    expect(c.result.reason).toBe('timeout');
    expect(c.result.transient).toBe(true);
    expect(c.countsOnBreaker).toBe(true);
  });

  it('reply 421: server_unreachable, transient, counted, with the reply', () => {
    const c = classifySmtpError({
      code: 'EENVELOPE',
      responseCode: 421,
      response: '421 4.3.2 shutting down',
    });
    expect(c.result).toEqual({
      ok: false,
      reason: 'server_unreachable',
      transient: true,
      serverReply: '421 4.3.2 shutting down',
    });
    expect(c.countsOnBreaker).toBe(true);
  });

  it('4xx: EENVELOPE 450 is recipient_refused, transient, not counted', () => {
    const c = classifySmtpError({ code: 'EENVELOPE', responseCode: 450, response: '450 busy' });
    expect(c.result).toEqual({
      ok: false,
      reason: 'recipient_refused',
      transient: true,
      serverReply: '450 busy',
    });
    expect(c.countsOnBreaker).toBe(false);
  });

  it('4xx: EMESSAGE 452 is message_refused, transient, not counted', () => {
    const c = classifySmtpError({ code: 'EMESSAGE', responseCode: 452 });
    expect(c.result.reason).toBe('message_refused');
    expect(c.result.transient).toBe(true);
    expect(c.countsOnBreaker).toBe(false);
  });

  it('5xx: EENVELOPE 550 is recipient_refused, final, not counted; the reply keeps \\n only', () => {
    const c = classifySmtpError({
      code: 'EENVELOPE',
      responseCode: 550,
      response: '550 5.1.1 unknown\r\nuser',
    });
    expect(c.result).toEqual({
      ok: false,
      reason: 'recipient_refused',
      transient: false,
      serverReply: '550 5.1.1 unknown\nuser',
    });
    expect(c.countsOnBreaker).toBe(false);
  });

  it('5xx: EMESSAGE 554 is message_refused, final, not counted', () => {
    const c = classifySmtpError({ code: 'EMESSAGE', responseCode: 554, response: '554 spam' });
    expect(c.result.reason).toBe('message_refused');
    expect(c.result.transient).toBe(false);
    expect(c.countsOnBreaker).toBe(false);
  });

  it.each<[string, unknown]>([
    ['a plain Error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['an unlisted code', { code: 'ETLS' }],
    ['a reply outside 4xx and 5xx', { code: 'EPROTOCOL', responseCode: 250, response: '250 ok' }],
  ])('anything else (%s) is unknown, final, not counted', (_name, error) => {
    const c = classifySmtpError(error);
    expect(c.result.reason).toBe('unknown');
    expect(c.result.transient).toBe(false);
    expect(c.countsOnBreaker).toBe(false);
  });

  it('cuts a reply longer than 1000 characters to 1000', () => {
    const c = classifySmtpError({
      code: 'EENVELOPE',
      responseCode: 451,
      response: `451 ${'x'.repeat(2_000)}`,
    });
    expect(c.result.serverReply).toHaveLength(1_000);
  });

  it('gives no reply without a responseCode, even when a response is present', () => {
    expect(classifySmtpError({ code: 'ECONNECTION', response: 'x' }).result.serverReply).toBeNull();
  });
});

describe('cleanServerReply', () => {
  it('is null for undefined, a non-string and an empty or control-only string', () => {
    expect(cleanServerReply(undefined)).toBeNull();
    expect(cleanServerReply(550)).toBeNull();
    expect(cleanServerReply('')).toBeNull();
    expect(cleanServerReply('\u0000\r\t ')).toBeNull();
  });

  it('removes C0 controls except the line feed and trims', () => {
    expect(cleanServerReply(' 550\u0000 no\tsuch\r\nuser \n')).toBe('550 nosuch\nuser');
  });
});
