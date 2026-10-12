/**
 * `api/v1/mail` over HTTP (plan 04.3-07): the gates per handler (four bearers), the template list,
 * the detail and its ETag, the stale-guarded save, the Active switches, the preview, the test send to
 * the caller's own address (idempotent, rate-limited, refused when mail is not configured) and its
 * state; for administrators only, the sent-email log, its detail, Resend, the status and the status
 * test (Task 3). No database, Redis or SMTP: the repository, the state store, the queue, the email port and
 * the idempotency store are fakes; every address is synthetic.
 */
import 'reflect-metadata';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailFacade } from '../facade/mail.facade.js';
import type { SentEmail } from '../model/mail.model.js';
import { createMailTestApp, TEST_BEARERS, type MailTestApp } from './create-mail-test-app.js';
import { sentOf, TEST_DEFINITION, templateOf } from './fakes.js';

const BASE = '/api/v1/mail';
const LONG_DASH = String.fromCharCode(0x2014);
const DRAFT = { locale: 'en', subject: 'Hi {staff_name}', message: 'See {link}' };

type Bearer = keyof typeof TEST_BEARERS;

interface Call {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH';
  readonly url: string;
  readonly payload?: object;
  readonly headers?: Record<string, string>;
}

let keySeq = 0;
/** A fresh `Idempotency-Key` (16 to 128 of `[A-Za-z0-9_-]`). */
const newKey = (): string => {
  keySeq += 1;
  return `spec-key-${String(keySeq).padStart(8, '0')}`;
};

function send(
  ctx: MailTestApp,
  call: Call,
  bearer: Bearer | null,
): Promise<LightMyRequestResponse> {
  return ctx.app.inject({
    method: call.method,
    url: call.url,
    headers: {
      ...(bearer === null ? {} : { authorization: `Bearer ${TEST_BEARERS[bearer]}` }),
      ...call.headers,
    },
    ...(call.payload === undefined ? {} : { payload: call.payload }),
  });
}

const json = (res: LightMyRequestResponse): Record<string, unknown> =>
  JSON.parse(res.payload) as Record<string, unknown>;
const codeOf = (res: LightMyRequestResponse): unknown => json(res).code;

/** Two templates: `zz_test_notice` (the registered definition) in zz_mod_a, `zz_other` (none) in zz_mod_b. */
async function seededApp(): Promise<MailTestApp> {
  const ctx = await createMailTestApp();
  ctx.moduleRef.get(MailFacade).register(TEST_DEFINITION);
  ctx.repo.templates.push(
    templateOf(1, {
      key: 'zz_test_notice',
      module: 'zz_mod_a',
      active: true,
      formattingDropped: false,
      versions: [{ locale: 'en', subject: 'Hi {staff_name}', message: 'See {link}' }],
    }),
    templateOf(2, {
      key: 'zz_other',
      module: 'zz_mod_b',
      active: true,
      formattingDropped: false,
      versions: [{ locale: 'en', subject: 'Other', message: 'Other' }],
    }),
  );
  return ctx;
}

/** The eight template handlers: the first three and the preview need view, the rest edit. */
const TEMPLATE_CALLS = (): Record<string, Call> => ({
  list: { method: 'GET', url: `${BASE}/templates` },
  detail: { method: 'GET', url: `${BASE}/templates/1` },
  preview: { method: 'POST', url: `${BASE}/templates/1/preview`, payload: DRAFT },
  save: { method: 'PATCH', url: `${BASE}/templates/1`, payload: { active: true, versions: {} } },
  active: { method: 'PUT', url: `${BASE}/templates/1/active`, payload: { active: true } },
  moduleActive: {
    method: 'POST',
    url: `${BASE}/templates/active`,
    payload: { module: 'zz_mod_a', active: true },
  },
  test: {
    method: 'POST',
    url: `${BASE}/templates/1/test`,
    payload: DRAFT,
    headers: { 'idempotency-key': newKey() },
  },
  testState: { method: 'GET', url: `${BASE}/tests/1` },
});
/** One of `TEMPLATE_CALLS`, freshly built (a new Idempotency-Key each time). */
function callOf(name: string): Call {
  const call = TEMPLATE_CALLS()[name];
  if (call === undefined) throw new Error(`no call ${name}`);
  return call;
}

const VIEW_HANDLERS = ['list', 'detail', 'preview'];
const EDIT_HANDLERS = ['save', 'active', 'moduleActive', 'test', 'testState'];

describe('MailController template gates (D-09, T-4.3-29)', () => {
  let ctx: MailTestApp;

  beforeAll(async () => {
    ctx = await seededApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it.each(Object.keys(TEMPLATE_CALLS()))('%s: 401 ERP-AUTH-0004 without a bearer', async (name) => {
    const res = await send(ctx, callOf(name), null);
    expect(res.statusCode).toBe(401);
    expect(codeOf(res)).toBe('ERP-AUTH-0004');
  });

  it.each(Object.keys(TEMPLATE_CALLS()))(
    '%s: 403 ERP-AUTH-0005 for a member with no code',
    async (name) => {
      const res = await send(ctx, callOf(name), 'noCode');
      expect(res.statusCode).toBe(403);
      expect(codeOf(res)).toBe('ERP-AUTH-0005');
    },
  );

  it.each(VIEW_HANDLERS)('%s: the view code admits', async (name) => {
    const res = await send(ctx, callOf(name), 'templatesView');
    expect(res.statusCode).toBe(200);
  });

  it.each(EDIT_HANDLERS)(
    '%s: 403 ERP-AUTH-0005 for the view code alone (edit missing)',
    async (name) => {
      const res = await send(ctx, callOf(name), 'templatesView');
      expect(res.statusCode).toBe(403);
      expect(codeOf(res)).toBe('ERP-AUTH-0005');
    },
  );

  it.each([...VIEW_HANDLERS, ...EDIT_HANDLERS])(
    '%s: the edit bearer (view and edit) and the administrator get through the gate',
    async (name) => {
      for (const bearer of ['templatesEdit', 'admin'] as const) {
        const res = await send(ctx, callOf(name), bearer);
        expect([401, 403], `${name} as ${bearer}`).not.toContain(res.statusCode);
      }
    },
  );
});

describe('MailController templates list, detail and save (ADR-0040)', () => {
  let ctx: MailTestApp;

  beforeAll(async () => {
    ctx = await seededApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const read = (url: string) => send(ctx, { method: 'GET', url }, 'templatesEdit');
  const save = (payload: object, ifMatch?: string) =>
    send(
      ctx,
      {
        method: 'PATCH',
        url: `${BASE}/templates/1`,
        payload,
        ...(ifMatch === undefined ? {} : { headers: { 'if-match': ifMatch } }),
      },
      'templatesEdit',
    );
  const etagNow = async (): Promise<string> =>
    json(await read(`${BASE}/templates/1`)).etag as string;

  it('lists one module: the row with its audience; meta carries the modules and the locales', async () => {
    const res = await read(`${BASE}/templates?filter[module][in]=zz_mod_a`);
    expect(res.statusCode).toBe(200);
    const body = json(res) as { data: unknown[]; meta: Record<string, unknown> };
    expect(body.data).toEqual([
      {
        id: '1',
        key: 'zz_test_notice',
        module: 'zz_mod_a',
        audience: 'staff',
        active: true,
        locales: ['en'],
      },
    ]);
    expect(body.meta.modules).toEqual(['zz_mod_a', 'zz_mod_b']);
    expect(body.meta.locales).toEqual(['en', 'ar']);
  });

  it('refuses an unknown filter with 400 naming it', async () => {
    const res = await read(`${BASE}/templates?filter[name][eq]=x`);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('ERP-VALIDATION-0001');
  });

  it('the detail: etag in the body and the ETag header, versions by locale, my own test address', async () => {
    const res = await read(`${BASE}/templates/1`);
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(res.headers.etag).toBe(body.etag);
    expect(body.versions).toEqual({ en: { subject: 'Hi {staff_name}', message: 'See {link}' } });
    expect(body.sendTest).toEqual({ configured: true, recipient: 'edit@example.test' });
    expect(body.mergeFields).toEqual([
      { token: 'staff_name', kind: 'text' },
      { token: 'link', kind: 'url' },
    ]);
  });

  it('a missing template is 404 ERP-CORE-0004; a bad id 400', async () => {
    expect(codeOf(await read(`${BASE}/templates/99`))).toBe('ERP-CORE-0004');
    expect((await read(`${BASE}/templates/x`)).statusCode).toBe(400);
  });

  const VALID = {
    active: true,
    versions: { en: { subject: 'Hello {staff_name}', message: 'Open {link}' } },
  };

  it('a save without If-Match is 428 ERP-CORE-0014', async () => {
    const res = await save(VALID);
    expect(res.statusCode).toBe(428);
    expect(codeOf(res)).toBe('ERP-CORE-0014');
  });

  it('a stale If-Match is 412 ERP-CORE-0013 and nothing is saved', async () => {
    const before = await etagNow();
    const res = await save(VALID, '"stale-fingerprint"');
    expect(res.statusCode).toBe(412);
    expect(codeOf(res)).toBe('ERP-CORE-0013');
    expect(await etagNow()).toBe(before);
  });

  it('an unknown token, a long dash and a lone Arabic subject are field issues with their rule', async () => {
    const etag = await etagNow();
    const unknown = await save(
      { active: true, versions: { en: { subject: 'Hi', message: 'See {nope}' } } },
      etag,
    );
    expect(unknown.statusCode).toBe(400);
    expect(json(unknown).issues).toEqual([
      expect.objectContaining({
        path: ['versions', 'en', 'message'],
        rule: 'unknown_merge_field',
        params: { token: 'nope' },
      }),
    ]);
    const dash = await save(
      { active: true, versions: { en: { subject: `Hi ${LONG_DASH} there`, message: 'M' } } },
      etag,
    );
    expect(json(dash).issues).toEqual([
      expect.objectContaining({ path: ['versions', 'en', 'subject'], rule: 'long_dash' }),
    ]);
    const pair = await save(
      { active: true, versions: { ...VALID.versions, ar: { subject: 'S', message: '' } } },
      etag,
    );
    expect(json(pair).issues).toEqual([
      expect.objectContaining({ path: ['versions', 'ar', 'message'], rule: 'version_pair' }),
    ]);
  });

  it('the right If-Match saves: 200, a new etag in the body and the header', async () => {
    const before = await etagNow();
    const res = await save(VALID, before);
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body.etag).not.toBe(before);
    expect(res.headers.etag).toBe(body.etag);
    expect(body.versions).toEqual({ en: VALID.versions.en });
  });
});

describe('MailController Active switches and preview', () => {
  let ctx: MailTestApp;

  beforeAll(async () => {
    ctx = await seededApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('Disable All of one module answers how many changed', async () => {
    const res = await send(
      ctx,
      {
        method: 'POST',
        url: `${BASE}/templates/active`,
        payload: { module: 'zz_mod_a', active: false },
      },
      'templatesEdit',
    );
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ changed: 1 });
  });

  it('the single switch answers the list row', async () => {
    const res = await send(
      ctx,
      { method: 'PUT', url: `${BASE}/templates/2/active`, payload: { active: false } },
      'templatesEdit',
    );
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ id: '2', key: 'zz_other', active: false, audience: null });
    const missing = await send(
      ctx,
      { method: 'PUT', url: `${BASE}/templates/99/active`, payload: { active: false } },
      'templatesEdit',
    );
    expect(codeOf(missing)).toBe('ERP-CORE-0004');
  });

  it('the preview renders the samples escaped and the url merge field as one link', async () => {
    const res = await send(
      ctx,
      { method: 'POST', url: `${BASE}/templates/1/preview`, payload: DRAFT },
      'templatesView',
    );
    expect(res.statusCode).toBe(200);
    const { subject, html } = json(res) as { subject: string; html: string };
    expect(subject).toBe('Hi Sample Staff');
    expect(html).toContain('Sample Staff');
    expect(html.split('<a href="https://example.test/sample-record"')).toHaveLength(2);
  });

  it('a preview of a missing template is 404', async () => {
    const res = await send(
      ctx,
      { method: 'POST', url: `${BASE}/templates/99/preview`, payload: DRAFT },
      'templatesView',
    );
    expect(res.statusCode).toBe(404);
  });
});

describe('MailController test send to me (D-04, D-10, T-4.3-03, T-4.3-19)', () => {
  let ctx: MailTestApp;

  beforeAll(async () => {
    ctx = await seededApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const test = (key: string | null, payload: object = DRAFT, bearer: Bearer = 'templatesEdit') =>
    send(
      ctx,
      {
        method: 'POST',
        url: `${BASE}/templates/1/test`,
        payload,
        ...(key === null ? {} : { headers: { 'idempotency-key': key } }),
      },
      bearer,
    );

  it('a body naming an address is 400: no endpoint accepts a recipient', async () => {
    for (const field of ['to', 'recipient', 'email']) {
      const res = await test(newKey(), { ...DRAFT, [field]: 'someone@example.test' });
      expect(res.statusCode, field).toBe(400);
      expect(codeOf(res)).toBe('ERP-VALIDATION-0001');
    }
    expect(ctx.repo.sent).toHaveLength(0);
  });

  it('without an Idempotency-Key it is 400 ERP-CORE-0010 and nothing is queued', async () => {
    const res = await test(null);
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('ERP-CORE-0010');
    expect(ctx.queue.added).toHaveLength(0);
  });

  it('202 { id }: one queued test row to MY address and one job carrying the draft; a replay queues nothing', async () => {
    const key = newKey();
    const res = await test(key);
    expect(res.statusCode).toBe(202);
    const { id } = json(res) as { id: string };
    expect(ctx.repo.sent).toHaveLength(1);
    expect(ctx.repo.sent[0]).toMatchObject({
      id: Number(id),
      isTest: true,
      templateKey: 'zz_test_notice',
      recipientEmail: 'edit@example.test',
      locale: 'en',
      status: 'queued',
      requestedByStaffId: 3,
    });
    expect(ctx.queue.added).toEqual([
      expect.objectContaining({
        queue: 'mail.send',
        data: {
          sentEmailId: Number(id),
          draft: { subject: DRAFT.subject, message: DRAFT.message },
        },
      }),
    ]);
    const replay = await test(key);
    expect(replay.statusCode).toBe(202);
    expect(json(replay)).toEqual({ id });
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(ctx.repo.sent).toHaveLength(1);
    expect(ctx.queue.added).toHaveLength(1);
  });

  it("my own test state is 200; another member's test and a non-test row are 404 (T-4.3-13)", async () => {
    const mine = ctx.repo.sent[0];
    const own = await send(
      ctx,
      { method: 'GET', url: `${BASE}/tests/${String(mine?.id)}` },
      'templatesEdit',
    );
    expect(own.statusCode).toBe(200);
    expect(json(own)).toMatchObject({ status: 'queued', recipient: 'edit@example.test' });

    const theirs = await test(newKey(), DRAFT, 'admin');
    const theirId = (json(theirs) as { id: string }).id;
    const peek = await send(
      ctx,
      { method: 'GET', url: `${BASE}/tests/${theirId}` },
      'templatesEdit',
    );
    expect(peek.statusCode).toBe(404);
    expect(codeOf(peek)).toBe('ERP-CORE-0004');

    const real = sentOf(
      ctx.repo.sent.length + 1,
      {
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
        requestedByStaffId: 3,
        requestId: null,
      },
      new Date(),
    );
    ctx.repo.sent.push(real);
    const notATest = await send(
      ctx,
      { method: 'GET', url: `${BASE}/tests/${String(real.id)}` },
      'templatesEdit',
    );
    expect(notATest.statusCode).toBe(404);
  });

  it('409 ERP-MAIL-0002 while mail is not configured, nothing queued', async () => {
    ctx.email.configured = false;
    const before = ctx.repo.sent.length;
    const res = await test(newKey());
    ctx.email.configured = true;
    expect(res.statusCode).toBe(409);
    expect(codeOf(res)).toBe('ERP-MAIL-0002');
    expect(ctx.repo.sent).toHaveLength(before);
  });

  it('the sixth test in ten minutes is 429 ERP-MAIL-0007 with a positive Retry-After', async () => {
    // The first test of this member is already counted above: four more pass, then the sixth is refused.
    for (let i = 0; i < 4; i += 1) expect((await test(newKey())).statusCode).toBe(202);
    const before = ctx.repo.sent.length;
    const res = await test(newKey());
    expect(res.statusCode).toBe(429);
    expect(codeOf(res)).toBe('ERP-MAIL-0007');
    const retryAfter = Number(res.headers['retry-after']);
    expect(Number.isInteger(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(600);
    expect(ctx.repo.sent).toHaveLength(before);
  });
});

// --- administrators only (plan 04.3-07 Task 3: D-02, D-05, D-09, T-4.3-04, T-4.3-06, T-4.3-30) ---

const T0 = Date.parse('2026-10-03T06:00:00.000Z');
const MINUTE_MS = 60_000;

/** A log row as stored (synthetic): a real send of `zz_test_notice` about record '1' unless changed. */
function logRow(id: number, changes: Partial<SentEmail> = {}): SentEmail {
  return {
    ...sentOf(
      id,
      {
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
      },
      new Date(T0 + id * MINUTE_MS),
    ),
    ...changes,
  };
}

/**
 * The log: 1 a failed real send (with a server reply), 2 still queued, 3 a status-page test (sent),
 * 4 a template test (failed), 5 a failed send of `zz_other` (no definition), 6 a failed send whose
 * record is gone (the resolver knows record '1' only).
 */
async function loggedApp(): Promise<MailTestApp> {
  const ctx = await seededApp();
  ctx.repo.sent.push(
    logRow(1, {
      status: 'failed',
      failureReason: 'recipient_refused',
      serverReply: '550 synthetic refusal',
    }),
    logRow(2),
    logRow(3, {
      templateKey: null,
      isTest: true,
      sourceRef: null,
      status: 'sent',
      sentAt: new Date(T0),
    }),
    logRow(4, { isTest: true, sourceRef: null, status: 'failed', failureReason: 'unknown' }),
    logRow(5, { templateKey: 'zz_other', status: 'failed', failureReason: 'timeout' }),
    logRow(6, { sourceRef: '2', status: 'failed', failureReason: 'timeout' }),
  );
  return ctx;
}

const ADMIN_CALLS = (): Record<string, Call> => ({
  sentList: { method: 'GET', url: `${BASE}/sent-emails` },
  sentDetail: { method: 'GET', url: `${BASE}/sent-emails/1` },
  resend: {
    method: 'POST',
    url: `${BASE}/sent-emails/1/resend`,
    headers: { 'idempotency-key': newKey() },
  },
  status: { method: 'GET', url: `${BASE}/status` },
  statusTest: {
    method: 'POST',
    url: `${BASE}/status/test`,
    headers: { 'idempotency-key': newKey() },
  },
});

function adminCallOf(name: string): Call {
  const call = ADMIN_CALLS()[name];
  if (call === undefined) throw new Error(`no call ${name}`);
  return call;
}

describe('MailController administrator gates (D-05, D-02, T-4.3-30)', () => {
  let ctx: MailTestApp;

  beforeAll(async () => {
    ctx = await loggedApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it.each(Object.keys(ADMIN_CALLS()))('%s: 401 ERP-AUTH-0004 without a bearer', async (name) => {
    const res = await send(ctx, adminCallOf(name), null);
    expect(res.statusCode).toBe(401);
    expect(codeOf(res)).toBe('ERP-AUTH-0004');
  });

  it.each(Object.keys(ADMIN_CALLS()))(
    '%s: 403 ERP-AUTH-0005 for the edit, view and no-code members (no code admits them)',
    async (name) => {
      for (const bearer of ['templatesEdit', 'templatesView', 'noCode'] as const) {
        const res = await send(ctx, adminCallOf(name), bearer);
        expect(res.statusCode, `${name} as ${bearer}`).toBe(403);
        expect(codeOf(res)).toBe('ERP-AUTH-0005');
      }
    },
  );

  it.each(Object.keys(ADMIN_CALLS()))('%s: the administrator gets 200 or 202', async (name) => {
    const res = await send(ctx, adminCallOf(name), 'admin');
    expect([200, 202]).toContain(res.statusCode);
  });
});

/** The keys a log row answers: nothing about the email's content. */
const ROW_KEYS = [
  'attempts',
  'failureReason',
  'id',
  'isTest',
  'locale',
  'maxAttempts',
  'nextTryAt',
  'queuedAt',
  'recipient',
  'sentAt',
  'status',
  'templateActive',
  'templateKey',
  'waitingForServer',
];

describe('MailController sent-email log and detail (D-05, B11)', () => {
  let ctx: MailTestApp;

  beforeAll(async () => {
    ctx = await loggedApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const read = (url: string) => send(ctx, { method: 'GET', url }, 'admin');
  const idsOf = async (url: string): Promise<unknown[]> =>
    (json(await read(url)) as { data: { id: string }[] }).data.map((row) => row.id);

  it('newest first; each row only who, when and the result; meta lists every template key', async () => {
    const res = await read(`${BASE}/sent-emails`);
    expect(res.statusCode).toBe(200);
    const body = json(res) as { data: Record<string, unknown>[]; meta: { templates: string[] } };
    expect(body.data.map((row) => row.id)).toEqual(['6', '5', '4', '3', '2', '1']);
    for (const row of body.data) expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(res.payload).not.toContain('Hi {staff_name}');
    expect(res.payload).not.toContain('See {link}');
    expect(body.meta.templates).toEqual(['zz_other', 'zz_test_notice']);
    expect(body.data.find((row) => row.id === '1')?.templateActive).toBe(true);
    expect(body.data.find((row) => row.id === '3')?.templateActive).toBeNull();
  });

  it('filters by status and by the status-page tests (template key null)', async () => {
    expect(await idsOf(`${BASE}/sent-emails?filter[status][in]=failed`)).toEqual([
      '6',
      '5',
      '4',
      '1',
    ]);
    const tests = json(await read(`${BASE}/sent-emails?filter[template][in]=status-test`)) as {
      data: { id: string; templateKey: unknown }[];
    };
    expect(tests.data).toEqual([expect.objectContaining({ id: '3', templateKey: null })]);
  });

  it('waitingForServer is true for a queued row only while the server is recorded unreachable', async () => {
    const waitingOf = async (): Promise<unknown> =>
      (json(await read(`${BASE}/sent-emails/2`)) as { waitingForServer: unknown }).waitingForServer;
    expect(await waitingOf()).toBe(false);
    await ctx.state.markServerUnreachable(new Date(T0));
    expect(await waitingOf()).toBe(true);
    const failed = json(await read(`${BASE}/sent-emails/1`)) as { waitingForServer: unknown };
    expect(failed.waitingForServer).toBe(false);
    await ctx.state.clearServerUnreachable();
    expect(await waitingOf()).toBe(false);
  });

  it('the detail adds the server reply; a missing id is a uniform 404', async () => {
    const res = await read(`${BASE}/sent-emails/1`);
    expect(json(res)).toMatchObject({
      id: '1',
      status: 'failed',
      failureReason: 'recipient_refused',
      serverReply: '550 synthetic refusal',
      resentFromId: null,
      resentFromExists: false,
    });
    const missing = await read(`${BASE}/sent-emails/99`);
    expect(missing.statusCode).toBe(404);
    expect(codeOf(missing)).toBe('ERP-CORE-0004');
  });
});

describe('MailController Resend (D-05, D-09 O-6)', () => {
  let ctx: MailTestApp;

  beforeAll(async () => {
    ctx = await loggedApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const resend = (id: number, key: string = newKey()) =>
    send(
      ctx,
      {
        method: 'POST',
        url: `${BASE}/sent-emails/${String(id)}/resend`,
        headers: { 'idempotency-key': key },
      },
      'admin',
    );

  it('a failed real send: 202 with a NEW id linked to the untouched original, one job; a replay adds nothing', async () => {
    const original = structuredClone(ctx.repo.sent[0]);
    const key = newKey();
    const res = await resend(1, key);
    expect(res.statusCode).toBe(202);
    const { id } = json(res) as { id: string };
    expect(id).toBe('7');
    expect(ctx.repo.sent[6]).toMatchObject({
      id: 7,
      resentFromId: 1,
      templateKey: 'zz_test_notice',
      sourceRef: '1',
      recipientEmail: 'staff@example.test',
      isTest: false,
      status: 'queued',
      requestedByStaffId: 1,
    });
    expect(ctx.repo.sent[0]).toEqual(original);
    expect(ctx.queue.added).toEqual([expect.objectContaining({ data: { sentEmailId: 7 } })]);
    const replay = await resend(1, key);
    expect(replay.statusCode).toBe(202);
    expect(json(replay)).toEqual({ id: '7' });
    expect(ctx.repo.sent).toHaveLength(7);
    expect(ctx.queue.added).toHaveLength(1);
  });

  it('the resent row links back; resentFromExists turns false once the original is purged', async () => {
    const read = () => send(ctx, { method: 'GET', url: `${BASE}/sent-emails/7` }, 'admin');
    expect(json(await read())).toMatchObject({ resentFromId: '1', resentFromExists: true });
    ctx.repo.sent.splice(0, 1);
    expect(json(await read())).toMatchObject({ resentFromId: '1', resentFromExists: false });
  });

  it.each([
    [3, 'ERP-MAIL-0008', 'a status-page test'],
    [4, 'ERP-MAIL-0008', 'a template test'],
    [2, 'ERP-MAIL-0006', 'a row still queued'],
    [5, 'ERP-MAIL-0004', 'a template no module defines'],
    [6, 'ERP-MAIL-0005', 'a record that is gone'],
  ])('row %i is refused 409 %s (%s), nothing queued', async (id, code) => {
    const before = ctx.repo.sent.length;
    const res = await resend(id);
    expect(res.statusCode).toBe(409);
    expect(codeOf(res)).toBe(code);
    expect(ctx.repo.sent).toHaveLength(before);
  });

  it('a template switched off is 409 ERP-MAIL-0004; mail not configured 409 ERP-MAIL-0002; a missing row 404', async () => {
    const template = ctx.repo.templates[0];
    if (template === undefined) throw new Error('expected template 1');
    ctx.repo.templates[0] = { ...template, active: false };
    expect(codeOf(await resend(6))).toBe('ERP-MAIL-0004');
    ctx.repo.templates[0] = template;
    ctx.email.configured = false;
    expect(codeOf(await resend(6))).toBe('ERP-MAIL-0002');
    ctx.email.configured = true;
    const missing = await resend(99);
    expect(missing.statusCode).toBe(404);
    expect(codeOf(missing)).toBe('ERP-CORE-0004');
  });
});

describe('MailController email status and its test (D-02, T-4.3-06)', () => {
  let ctx: MailTestApp;

  beforeAll(async () => {
    ctx = await loggedApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const status = () => send(ctx, { method: 'GET', url: `${BASE}/status` }, 'admin');

  it('configured: sender, host, port, encryption, the server answering, the last send; never a credential', async () => {
    const res = await status();
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({
      configured: true,
      sender: { name: 'Company One', address: 'no-reply@example.test' },
      host: 'smtp.example.test',
      port: 587,
      encryption: 'tls',
      server: { answering: true, since: null },
      lastSend: {
        id: '6',
        status: 'failed',
        at: new Date(T0 + 6 * MINUTE_MS).toISOString(),
        failureReason: 'timeout',
      },
      sendTest: { configured: true, recipient: 'admin@example.test' },
    });
    expect(res.payload).not.toContain('smtp-user-zz');
    expect(res.payload).not.toContain('pw-not-a-secret');
  });

  it('the server recorded unreachable: answering false since that time', async () => {
    await ctx.state.markServerUnreachable(new Date(T0));
    const body = json(await status());
    await ctx.state.clearServerUnreachable();
    expect(body.server).toEqual({ answering: false, since: new Date(T0).toISOString() });
  });

  it('not configured: configured false, no sender, host, port or encryption; still no credential', async () => {
    ctx.email.configured = false;
    const res = await status();
    ctx.email.configured = true;
    expect(json(res)).toMatchObject({
      configured: false,
      sender: null,
      host: null,
      port: null,
      encryption: null,
      sendTest: { configured: false, recipient: 'admin@example.test' },
    });
    expect(res.payload).not.toContain('smtp-user-zz');
    expect(res.payload).not.toContain('pw-not-a-secret');
  });

  it('the status test: 202, one queued test row with no template to MY address in MY locale, no draft', async () => {
    const before = ctx.repo.sent.length;
    const res = await send(
      ctx,
      { method: 'POST', url: `${BASE}/status/test`, headers: { 'idempotency-key': newKey() } },
      'admin',
    );
    expect(res.statusCode).toBe(202);
    const { id } = json(res) as { id: string };
    expect(ctx.repo.sent).toHaveLength(before + 1);
    expect(ctx.repo.sent.at(-1)).toMatchObject({
      id: Number(id),
      templateKey: null,
      isTest: true,
      recipientEmail: 'admin@example.test',
      locale: 'ar',
      status: 'queued',
      requestedByStaffId: 1,
    });
    expect(ctx.queue.added.at(-1)?.data).toEqual({ sentEmailId: Number(id) });
  });
});
