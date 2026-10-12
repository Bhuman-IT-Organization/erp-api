/**
 * MailTransformer: every answer of the Email screens built field by field and re-parsed through its
 * schema (ids as strings, times as ISO strings), and the catalog entries this plan adds.
 */
import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../shared/errors/error-codes.js';
import { etagOf } from '../../../shared/http/etag.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import type { NewSentEmail } from '../model/mail.model.js';
import { MailTransformer, shownOf } from '../service/mail.transformer.js';
import { sentOf, TEST_DEFINITION, templateOf } from './fakes.js';

const transformer = new MailTransformer();
const AT = new Date('2026-10-03T08:00:00.000Z');
const SINCE = new Date('2026-10-03T07:30:00.000Z');

const TEMPLATE = templateOf(7, {
  key: 'zz_test_notice',
  module: 'zz_tests',
  active: true,
  formattingDropped: false,
  versions: [
    { locale: 'en', subject: 'Hi {staff_name}', message: 'See {link}' },
    { locale: 'ar', subject: 'S', message: 'M' },
  ],
});

const NEW_ROW: NewSentEmail = {
  templateKey: 'zz_test_notice',
  isTest: false,
  sourceRef: '1',
  recipientEmail: 'staff@example.test',
  locale: 'en',
  status: 'queued',
  failureReason: null,
  maxAttempts: 8,
  dedupeKey: null,
  resentFromId: null,
  requestedByStaffId: null,
  requestId: null,
};

describe('the catalog entries of plan 04.3-07', () => {
  it('ERP-MAIL-0007 is 429; 0002, 0004, 0005, 0006 and 0008 are 409; 0001 and 0003 are never thrown', () => {
    expect(ERROR_CODES['ERP-MAIL-0007'].status).toBe(429);
    for (const code of [
      'ERP-MAIL-0002',
      'ERP-MAIL-0004',
      'ERP-MAIL-0005',
      'ERP-MAIL-0006',
      'ERP-MAIL-0008',
    ] as const) {
      expect(ERROR_CODES[code].status, code).toBe(409);
    }
    expect(Object.keys(ERROR_CODES)).not.toContain('ERP-MAIL-0001');
    expect(Object.keys(ERROR_CODES)).not.toContain('ERP-MAIL-0003');
  });

  it('HTTP_STATUS.ACCEPTED is 202', () => {
    expect(HTTP_STATUS.ACCEPTED).toBe(202);
  });
});

describe('MailTransformer.template', () => {
  const sendTest = { configured: true, recipient: 'edit@example.test' };

  it('answers the editor: string id, merge fields without sampleKey, versions by locale, locales en first, the etag', () => {
    const dto = transformer.template(TEMPLATE, TEST_DEFINITION, sendTest);
    expect(dto).toEqual({
      id: '7',
      key: 'zz_test_notice',
      module: 'zz_tests',
      audience: 'staff',
      active: true,
      formattingDropped: false,
      locales: ['en', 'ar'],
      mergeFields: [
        { token: 'staff_name', kind: 'text' },
        { token: 'link', kind: 'url' },
      ],
      versions: {
        ar: { subject: 'S', message: 'M' },
        en: { subject: 'Hi {staff_name}', message: 'See {link}' },
      },
      sendTest,
      etag: etagOf({
        active: true,
        versions: {
          ar: { subject: 'S', message: 'M' },
          en: { subject: 'Hi {staff_name}', message: 'See {link}' },
        },
      }),
    });
    expect(dto.etag).toBe(etagOf(shownOf(TEMPLATE)));
  });

  it('the etag changes when a version message changes, and not when an unshown column does', () => {
    const before = transformer.template(TEMPLATE, TEST_DEFINITION, sendTest).etag;
    const edited = {
      ...TEMPLATE,
      versions: TEMPLATE.versions.map((v) => (v.locale === 'en' ? { ...v, message: 'x' } : v)),
    };
    expect(transformer.template(edited, TEST_DEFINITION, sendTest).etag).not.toBe(before);
    const stamped = { ...TEMPLATE, updatedAt: new Date(0), updatedByStaffId: 9 };
    expect(transformer.template(stamped, TEST_DEFINITION, sendTest).etag).toBe(before);
  });

  it('no registered definition: audience null and no merge fields (the editor is read-only)', () => {
    const dto = transformer.template(TEMPLATE, undefined, sendTest);
    expect(dto.audience).toBeNull();
    expect(dto.mergeFields).toEqual([]);
  });
});

describe('MailTransformer.templateList', () => {
  it('answers the envelope: audience from the definition or null, the modules and the locales', () => {
    const page = {
      items: [
        { id: 1, key: 'zz_test_notice', module: 'zz_tests', active: true, locales: ['en'] },
        { id: 2, key: 'zz_other', module: 'zz_mod_b', active: false, locales: ['ar', 'en'] },
      ],
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
    };
    const dto = transformer.templateList(
      page,
      (key) => (key === TEST_DEFINITION.key ? TEST_DEFINITION : undefined),
      ['zz_mod_b', 'zz_tests'],
    );
    expect(dto).toEqual({
      data: [
        {
          id: '1',
          key: 'zz_test_notice',
          module: 'zz_tests',
          audience: 'staff',
          active: true,
          locales: ['en'],
        },
        {
          id: '2',
          key: 'zz_other',
          module: 'zz_mod_b',
          audience: null,
          active: false,
          locales: ['ar', 'en'],
        },
      ],
      meta: {
        nextCursor: null,
        prevCursor: null,
        total: 2,
        rangeStart: 1,
        modules: ['zz_mod_b', 'zz_tests'],
        locales: ['en', 'ar'],
      },
    });
  });
});

describe('MailTransformer sent rows', () => {
  const queued = sentOf(5, NEW_ROW, AT);

  it('a row: string ids, ISO times, waiting only while queued or retrying with the server flag set', () => {
    expect(transformer.sentRow(queued, SINCE, true)).toEqual({
      id: '5',
      templateKey: 'zz_test_notice',
      isTest: false,
      recipient: 'staff@example.test',
      locale: 'en',
      status: 'queued',
      attempts: 0,
      maxAttempts: 8,
      nextTryAt: null,
      queuedAt: '2026-10-03T08:00:00.000Z',
      sentAt: null,
      failureReason: null,
      templateActive: true,
      waitingForServer: true,
    });
    expect(transformer.sentRow(queued, null, true).waitingForServer).toBe(false);
    const sent = { ...queued, status: 'sent' as const, sentAt: AT };
    expect(transformer.sentRow(sent, SINCE, null)).toMatchObject({
      waitingForServer: false,
      sentAt: '2026-10-03T08:00:00.000Z',
      templateActive: null,
    });
  });

  it('the detail adds the server reply and the resend link; no subject, body or source ref ever', () => {
    const failed = {
      ...queued,
      status: 'failed' as const,
      failureReason: 'recipient_refused' as const,
      serverReply: '550 no such user',
      resentFromId: 3,
    };
    const dto = transformer.sentEmail(failed, true, null, false);
    expect(dto).toMatchObject({
      serverReply: '550 no such user',
      resentFromId: '3',
      resentFromExists: true,
      failureReason: 'recipient_refused',
    });
    expect(Object.keys(dto)).not.toContain('sourceRef');
    expect(Object.keys(dto)).not.toContain('subject');
    expect(Object.keys(dto)).not.toContain('requestedByStaffId');
  });

  it('the list envelope carries every stored template key', () => {
    const dto = transformer.sentList(
      { items: [queued], nextCursor: null, prevCursor: null, total: 1, rangeStart: 1 },
      null,
      () => true,
      ['zz_test_notice'],
    );
    expect(dto.meta.templates).toEqual(['zz_test_notice']);
    expect(dto.data[0]?.templateActive).toBe(true);
  });

  it("a test's state: status, attempts and the recipient", () => {
    const test = { ...queued, isTest: true, templateKey: null };
    expect(transformer.testState(test, SINCE)).toEqual({
      id: '5',
      status: 'queued',
      attempts: 0,
      maxAttempts: 8,
      nextTryAt: null,
      sentAt: null,
      failureReason: null,
      recipient: 'staff@example.test',
      waitingForServer: true,
    });
  });
});

describe('MailTransformer.status', () => {
  it('configured: sender, host, port, encryption, the server state and the last send; nothing else', () => {
    const failed = {
      ...sentOf(9, NEW_ROW, AT),
      status: 'failed' as const,
      failureReason: 'auth_failed' as const,
      updatedAt: new Date('2026-10-03T08:05:00.000Z'),
    };
    const dto = transformer.status({
      configured: true,
      smtp: {
        host: 'mail.example.test',
        port: 587,
        encryption: 'tls',
        fromName: 'Company One',
        fromAddress: 'no-reply@example.test',
      },
      since: SINCE,
      last: failed,
      recipient: 'admin@example.test',
    });
    expect(dto).toEqual({
      configured: true,
      sender: { name: 'Company One', address: 'no-reply@example.test' },
      host: 'mail.example.test',
      port: 587,
      encryption: 'tls',
      server: { answering: false, since: '2026-10-03T07:30:00.000Z' },
      lastSend: {
        id: '9',
        status: 'failed',
        at: '2026-10-03T08:05:00.000Z',
        failureReason: 'auth_failed',
      },
      sendTest: { configured: true, recipient: 'admin@example.test' },
    });
  });

  it('not configured: no sender, host, port or encryption; a sent last send is dated by sentAt', () => {
    const sent = { ...sentOf(4, NEW_ROW, AT), status: 'sent' as const, sentAt: SINCE };
    const dto = transformer.status({
      configured: false,
      smtp: null,
      since: null,
      last: sent,
      recipient: null,
    });
    expect(dto).toMatchObject({
      configured: false,
      sender: null,
      host: null,
      port: null,
      encryption: null,
      server: { answering: true, since: null },
      lastSend: { id: '4', status: 'sent', at: '2026-10-03T07:30:00.000Z', failureReason: null },
      sendTest: { configured: false, recipient: null },
    });
  });
});
