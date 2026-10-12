/**
 * The HTTP contract of the seven routes under `/api/v1/payment-modes`, proven in-process with
 * Fastify `inject` over the in-memory fake and the stub settings facade: administrators only on
 * every handler (D-06, D-32: a bearer holding every catalogue code is refused 403 `ERP-AUTH-0005`
 * before any repository or settings call, an administrator is served, no bearer is 401
 * `ERP-AUTH-0004`), the list in Perfex's order (the name ascending) with each row's seven fields,
 * usage and lock, Perfex's outcomes (D-34: an absent box saves 0, every field rewritten on an
 * update, a duplicate name accepted, the description stored as Perfex stores it and read back as
 * typed, any other key a 400), the one-click switch with its no-op path, the DELETE with its two
 * 409s (D-33 for each of the eight groups, D-37 for the credit-expense mode), the four-format export
 * of the four columns with its formula escape, `x-request-id` on every response, and the ADR-0030
 * route assertion.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { CSV_BOM, EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import {
  paymentModesActiveResponseSchema,
  paymentModesListResponseSchema,
  paymentModesResponseSchema,
} from '../dto/payment-modes.dto.js';
import {
  PaymentModesActiveChangedV1,
  PaymentModesCreatedV1,
  PaymentModesDeletedV1,
  PaymentModesUpdatedV1,
} from '../events/published.js';
import type { PaymentModeUsage } from '../model/payment-modes.model.js';
import { PAYMENT_MODES_ROUTES } from '../payment-modes.routes.js';
import {
  createPaymentModesTestApp,
  TEST_BEARERS,
  TEST_NOW,
  type PaymentModesTestApp,
} from './create-payment-modes-test-app.js';
import { ZERO_USAGE } from './fakes.js';

const LIST = `/${API_PREFIX}/${PAYMENT_MODES_ROUTES.base}`;
const EXPORT = `${LIST}/${PAYMENT_MODES_ROUTES.export}`;
const record = (id: string | number): string => `${LIST}/${String(id)}`;
const active = (id: string | number): string => `${record(id)}/active`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HTTP = {
  ok: 200,
  created: 201,
  noContent: 204,
  bad: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
};
const AT = TEST_NOW.toISOString();
/** Every row: the fake's own match with no search, for a count. */
const ALL = { search: null, sortField: 'id', order: 'asc', cursor: null, limit: 1 } as const;
const ADMIN_ONLY = 'payment modes are managed by administrators only';
const SWITCH_OFF = 'switch it off instead to stop offering it';
const CREDIT_LOCK = `expenses use this payment mode to mark a credit expense (a Perfex setting), so it cannot be deleted; ${SWITCH_OFF}`;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * The seven routes, each with the body it needs and the status an administrator gets. A route
 * that changes a row runs on a fresh row (`fresh`), so the seed stays as the other cases read it.
 */
const ROUTES: readonly {
  name: string;
  method: Method;
  url: (id: string) => string;
  payload?: object;
  admin: number;
  fresh?: boolean;
}[] = [
  { name: 'GET list', method: 'GET', url: () => LIST, admin: HTTP.ok },
  { name: 'GET export', method: 'GET', url: () => EXPORT, admin: HTTP.ok },
  { name: 'GET :id', method: 'GET', url: () => record(1), admin: HTTP.ok },
  { name: 'POST', method: 'POST', url: () => LIST, payload: { name: 'New' }, admin: HTTP.created },
  {
    name: 'PATCH :id',
    method: 'PATCH',
    url: record,
    payload: { name: 'Target' },
    admin: HTTP.ok,
    fresh: true,
  },
  {
    name: 'PATCH :id/active',
    method: 'PATCH',
    url: active,
    payload: { active: false },
    admin: HTTP.ok,
    fresh: true,
  },
  { name: 'DELETE :id', method: 'DELETE', url: record, admin: HTTP.noContent, fresh: true },
];

/** One usage per group, that group at 1 and the rest at 0, with the words its 409 detail uses. */
const ONE_GROUP: readonly (readonly [keyof PaymentModeUsage, string])[] = [
  ['invoicePayments', '1 invoice payment(s)'],
  ['expenses', '1 expense(s)'],
  ['creditNoteRefunds', '1 credit note refund(s)'],
  ['purchaseInvoicePayments', '1 purchase invoice payment(s)'],
  ['purchaseOrderPayments', '1 purchase order payment(s)'],
  ['debitNoteRefunds', '1 debit note refund(s)'],
  ['fixedEquipmentRefunds', '1 fixed equipment refund(s)'],
  ['orderReturnRefunds', '1 order return refund(s)'],
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('PaymentModesController (Fastify inject, no network)', () => {
  let ctx: PaymentModesTestApp;

  beforeAll(async () => {
    ctx = await createPaymentModesTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    ctx.repo.usage.clear();
    ctx.setCreditMode(null);
    ctx.settings.calls.length = 0;
    vi.restoreAllMocks();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<PaymentModesTestApp['app']['inject']> =>
    ctx.app.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: bearer(token) }),
      ...(payload === undefined ? {} : { payload }),
    });

  /** A fresh row to change or delete, so each case owns its data; the log and events are cleared. */
  const created = async (name: string, extra: object = {}): Promise<string> => {
    const res = await send('POST', LIST, TEST_BEARERS.admin, { name, active: true, ...extra });
    expect(res.statusCode).toBe(HTTP.created);
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    return paymentModesResponseSchema.parse(JSON.parse(res.payload)).id;
  };

  it('registers the seven routes under /api/v1/payment-modes, the switch and DELETE included', () => {
    for (const route of [
      `GET ${LIST}`,
      `GET ${EXPORT}`,
      `GET ${LIST}/:id`,
      `POST ${LIST}`,
      `PATCH ${LIST}/:id`,
      `PATCH ${LIST}/:id/active`,
      `DELETE ${LIST}/:id`,
    ]) {
      expect(ctx.routes).toContain(route);
    }
  });

  describe('administrators only (D-06, D-32, T-4.1-111)', () => {
    it.each(ROUTES)(
      '$name with a bearer holding every catalogue code, not an administrator, is 403 ERP-AUTH-0005 before any repository or settings call',
      async ({ method, url, payload }) => {
        const spies = [
          vi.spyOn(ctx.repo, 'list'),
          vi.spyOn(ctx.repo, 'count'),
          vi.spyOn(ctx.repo, 'findById'),
          vi.spyOn(ctx.repo, 'create'),
          vi.spyOn(ctx.repo, 'update'),
          vi.spyOn(ctx.repo, 'setActive'),
          vi.spyOn(ctx.repo, 'remove'),
          vi.spyOn(ctx.repo, 'usageByPaymentMode'),
        ];
        const res = await send(method, url('1'), TEST_BEARERS.everyCode, payload);
        expect(res.statusCode).toBe(HTTP.forbidden);
        const body = problem(res);
        expect(body.code).toBe('ERP-AUTH-0005');
        expect(body.detail).toBe(ADMIN_ONLY);
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
        expect(ctx.settings.calls).toEqual([]);
        expect(ctx.events.count).toBe(0);
        expect(ctx.logger.lines).toEqual([]);
      },
    );

    it.each(ROUTES)(
      '$name with a bearer holding no code is 403 ERP-AUTH-0005',
      async ({ method, url, payload }) => {
        const res = await send(method, url('1'), TEST_BEARERS.noPermission, payload);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(problem(res).code).toBe('ERP-AUTH-0005');
      },
    );

    it.each(ROUTES)(
      '$name without a bearer is 401 ERP-AUTH-0004',
      async ({ method, url, payload }) => {
        const res = await send(method, url('1'), undefined, payload);
        expect(res.statusCode).toBe(HTTP.unauthorized);
        expect(problem(res).code).toBe('ERP-AUTH-0004');
      },
    );

    it.each(ROUTES)(
      '$name with the administrator bearer is served ($admin)',
      async ({ method, url, payload, admin, fresh }) => {
        const id = fresh === true ? await created('Target') : '1';
        const res = await send(method, url(id), TEST_BEARERS.admin, payload);
        expect(res.statusCode).toBe(admin);
      },
    );
  });

  describe('GET list', () => {
    it("defaults to Perfex's order, the name ascending, with no sort sent", async () => {
      const res = await send('GET', `${LIST}?q=a`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = paymentModesListResponseSchema.parse(JSON.parse(res.payload));
      const names = body.data.map((row) => row.name);
      expect(names).toEqual([...names].sort());
      expect(body.data.slice(0, 3).map((row) => row.id)).toEqual(['1', '3', '2']);
      expect(body.meta).toMatchObject({ exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS });
    });

    it('each row carries the seven fields, its usage and the credit-expense lock', async () => {
      ctx.repo.usage.set(3, { ...ZERO_USAGE, expenses: 2, orderReturnRefunds: 1 });
      ctx.setCreditMode('3');
      const res = await send('GET', `${LIST}?q=bank&sort=id`, TEST_BEARERS.admin);
      const body = paymentModesListResponseSchema.parse(JSON.parse(res.payload));
      expect(body.data.slice(0, 2)).toEqual([
        {
          id: '1',
          name: 'Bank',
          description: '',
          active: true,
          showOnPdf: true,
          selectedByDefault: true,
          invoicesOnly: false,
          expensesOnly: false,
          usage: ZERO_USAGE,
          isCreditExpenseMode: false,
        },
        {
          id: '3',
          name: 'Bank',
          description: 'Line one\nline two',
          active: true,
          showOnPdf: false,
          selectedByDefault: false,
          invoicesOnly: true,
          expensesOnly: false,
          usage: { ...ZERO_USAGE, expenses: 2, orderReturnRefunds: 1 },
          isCreditExpenseMode: true,
        },
      ]);
      expect(ctx.settings.calls).toEqual([['expense_credit_payment_mode']]);
      expect(res.payload).not.toContain('expense_credit_payment_mode');
    });

    it.each(['description', 'showOnPdf', 'name,-id'])(
      'sort=%s is 400 ERP-VALIDATION-0001 on sort',
      async (sort) => {
        const res = await send('GET', `${LIST}?sort=${sort}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.bad);
        expect(problem(res).issues).toEqual([expect.objectContaining({ path: ['sort'] })]);
      },
    );

    it('sorts by active both ways', async () => {
      const up = paymentModesListResponseSchema.parse(
        JSON.parse((await send('GET', `${LIST}?sort=active`, TEST_BEARERS.admin)).payload),
      );
      const flags = up.data.map((row) => row.active);
      expect(flags).toEqual([...flags].sort((x, y) => Number(x) - Number(y)));
      const down = paymentModesListResponseSchema.parse(
        JSON.parse((await send('GET', `${LIST}?sort=-active`, TEST_BEARERS.admin)).payload),
      );
      expect(down.data[0]?.active).toBe(true);
    });
  });

  describe('POST and PATCH (D-34, D-29)', () => {
    it('POST 201: a two-line description read back as sent, the five boxes false when absent; one event and one log line', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, {
        name: '  Cash < 50  ',
        description: 'First line\nsecond line',
      });
      expect(res.statusCode).toBe(HTTP.created);
      const dto = paymentModesResponseSchema.parse(JSON.parse(res.payload));
      expect(dto).toEqual({
        id: dto.id,
        name: 'Cash < 50',
        description: 'First line\nsecond line',
        active: false,
        showOnPdf: false,
        selectedByDefault: false,
        invoicesOnly: false,
        expensesOnly: false,
        usage: ZERO_USAGE,
        isCreditExpenseMode: false,
      });
      const id = Number(dto.id);
      expect((await ctx.repo.findById(id))?.description).toBe('First line<br />\nsecond line');
      const read = await send('GET', record(dto.id), TEST_BEARERS.admin);
      expect(JSON.parse(read.payload)).toEqual(dto);
      const events = ctx.events.drain();
      expect(events.map((event) => event.constructor)).toEqual([PaymentModesCreatedV1]);
      expect(events[0]?.payload).toEqual({ id, at: AT });
      expect(ctx.logger.lines).toEqual([{ message: 'payment mode created', meta: { id } }]);
    });

    it('a name and a description holding markup save (201) and read back byte-identical (T-4.1-118)', async () => {
      const text = '<script>alert(1)</script>';
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: text, description: text });
      expect(res.statusCode).toBe(HTTP.created);
      const { id } = paymentModesResponseSchema.parse(JSON.parse(res.payload));
      const read = paymentModesResponseSchema.parse(
        JSON.parse((await send('GET', record(id), TEST_BEARERS.admin)).payload),
      );
      expect(read).toMatchObject({ name: text, description: text });
    });

    it('POST a name the seed already holds is 201: Perfex has no uniqueness check (D-34)', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: 'Bank' });
      expect(res.statusCode).toBe(HTTP.created);
    });

    it.each([{ showToClient: true }, { id: 77 }, { usage: {} }, { isCreditExpenseMode: true }])(
      'POST with %o is 400 naming the key, and nothing is stored (T-4.1-112, D-35)',
      async (extra) => {
        const total = await ctx.repo.count(ALL);
        const res = await send('POST', LIST, TEST_BEARERS.admin, { name: 'Sneaky', ...extra });
        expect(res.statusCode).toBe(HTTP.bad);
        const key = Object.keys(extra)[0] ?? '';
        expect(JSON.stringify(problem(res).issues)).toContain(key);
        expect(await ctx.repo.count(ALL)).toBe(total);
        expect(ctx.events.count).toBe(0);
      },
    );

    it('PATCH 200 rewrites all seven: a box sent false is saved false, an absent box 0; one event and one log line', async () => {
      const id = await created('Every box', {
        description: 'old',
        showOnPdf: true,
        selectedByDefault: true,
        invoicesOnly: true,
        expensesOnly: true,
      });
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, {
        name: 'Every box',
        active: false,
        showOnPdf: false,
        invoicesOnly: true,
      });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(paymentModesResponseSchema.parse(JSON.parse(res.payload))).toMatchObject({
        description: '',
        active: false,
        showOnPdf: false,
        selectedByDefault: false,
        invoicesOnly: true,
        expensesOnly: false,
      });
      expect(await ctx.repo.findById(Number(id))).toEqual({
        id: Number(id),
        name: 'Every box',
        description: '',
        active: false,
        showOnPdf: 0,
        selectedByDefault: 0,
        invoicesOnly: 1,
        expensesOnly: 0,
      });
      expect(ctx.events.drain().map((event) => event.constructor)).toEqual([PaymentModesUpdatedV1]);
      expect(ctx.logger.lines).toEqual([
        { message: 'payment mode updated', meta: { id: Number(id) } },
      ]);
    });

    it('both invoicesOnly and expensesOnly may be set, as Perfex accepts them', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, {
        name: 'Both',
        invoicesOnly: true,
        expensesOnly: true,
      });
      expect(res.statusCode).toBe(HTTP.created);
      expect(JSON.parse(res.payload)).toMatchObject({ invoicesOnly: true, expensesOnly: true });
    });

    it("PATCH {} is 400 on ['name']; PATCH of a missing id is 404; a non-numeric :id is 400", async () => {
      const empty = await send('PATCH', record(1), TEST_BEARERS.admin, {});
      expect(empty.statusCode).toBe(HTTP.bad);
      expect(problem(empty).issues).toEqual([expect.objectContaining({ path: ['name'] })]);
      const missing = await send('PATCH', record(9_999), TEST_BEARERS.admin, { name: 'Nobody' });
      expect(missing.statusCode).toBe(HTTP.notFound);
      expect(problem(missing).code).toBe('ERP-CORE-0004');
      expect((await send('GET', record('abc'), TEST_BEARERS.admin)).statusCode).toBe(HTTP.bad);
      expect(ctx.events.count).toBe(0);
    });
  });

  describe('PATCH :id/active (D-34, the one-click switch)', () => {
    it('{ active: false } answers 200 { id, active }, GET shows it; one event, one log line', async () => {
      const id = await created('Switch me');
      const res = await send('PATCH', active(id), TEST_BEARERS.admin, { active: false });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(paymentModesActiveResponseSchema.parse(JSON.parse(res.payload))).toEqual({
        id,
        active: false,
      });
      const read = await send('GET', record(id), TEST_BEARERS.admin);
      expect(JSON.parse(read.payload)).toMatchObject({ active: false });
      const events = ctx.events.drain();
      expect(events.map((event) => event.constructor)).toEqual([PaymentModesActiveChangedV1]);
      expect(events[0]?.payload).toEqual({ id: Number(id), active: false, at: AT });
      expect(ctx.logger.lines).toEqual([
        { message: 'payment mode deactivated', meta: { id: Number(id) } },
      ]);
    });

    it('the same call again answers 200 with no write, no second event and no log line', async () => {
      const id = await created('Already off', { active: false });
      const write = vi.spyOn(ctx.repo, 'setActive');
      const res = await send('PATCH', active(id), TEST_BEARERS.admin, { active: false });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(res.payload)).toEqual({ id, active: false });
      expect(write).not.toHaveBeenCalled();
      expect(ctx.events.count).toBe(0);
      expect(ctx.logger.lines).toEqual([]);
    });

    it('switching back on logs "payment mode activated"', async () => {
      const id = await created('Back on', { active: false });
      await send('PATCH', active(id), TEST_BEARERS.admin, { active: true });
      expect(ctx.logger.lines).toEqual([
        { message: 'payment mode activated', meta: { id: Number(id) } },
      ]);
    });

    it('a missing id is 404; { active: "no" } and an extra key are 400', async () => {
      const missing = await send('PATCH', active(9_999), TEST_BEARERS.admin, { active: false });
      expect(missing.statusCode).toBe(HTTP.notFound);
      expect(problem(missing).code).toBe('ERP-CORE-0004');
      const text = await send('PATCH', active(1), TEST_BEARERS.admin, { active: 'no' });
      expect(text.statusCode).toBe(HTTP.bad);
      expect(problem(text).issues).toEqual([expect.objectContaining({ path: ['active'] })]);
      const extra = await send('PATCH', active(1), TEST_BEARERS.admin, {
        active: false,
        name: 'X',
      });
      expect(extra.statusCode).toBe(HTTP.bad);
      expect(ctx.events.count).toBe(0);
    });

    it('is allowed for the credit-expense mode and for a mode in use (D-37, D-33)', async () => {
      const credit = await created('Credit mode');
      ctx.setCreditMode(credit);
      expect(
        (await send('PATCH', active(credit), TEST_BEARERS.admin, { active: false })).statusCode,
      ).toBe(HTTP.ok);
      const used = await created('Used mode');
      ctx.repo.usage.set(Number(used), { ...ZERO_USAGE, expenses: 3 });
      expect(
        (await send('PATCH', active(used), TEST_BEARERS.admin, { active: false })).statusCode,
      ).toBe(HTTP.ok);
    });
  });

  describe('DELETE :id (D-33, D-37)', () => {
    it('answers 204 with no body, then GET :id is 404 ERP-CORE-0004; one event and one log line', async () => {
      const id = await created('Short-lived');
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.noContent);
      expect(res.payload).toBe('');
      const gone = await send('GET', record(id), TEST_BEARERS.admin);
      expect(gone.statusCode).toBe(HTTP.notFound);
      expect(problem(gone).code).toBe('ERP-CORE-0004');
      const events = ctx.events.drain();
      expect(events.map((event) => event.constructor)).toEqual([PaymentModesDeletedV1]);
      expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual(['at', 'id']);
      expect(ctx.logger.lines).toEqual([
        { message: 'payment mode deleted', meta: { id: Number(id) } },
      ]);
    });

    it('of a missing id is 404 ERP-CORE-0004, and nothing is published', async () => {
      const res = await send('DELETE', record(9_999), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.notFound);
      expect(problem(res).code).toBe('ERP-CORE-0004');
      expect(ctx.events.count).toBe(0);
    });

    it.each(ONE_GROUP)(
      'of a payment mode used in %s is 409 ERP-PAYMENTMODES-0001 ending with the switch-off advice: the row stays readable, no event, no log line',
      async (group, words) => {
        const id = await created(`In use: ${group}`);
        ctx.repo.usage.set(Number(id), { ...ZERO_USAGE, [group]: 1 });
        const total = await ctx.repo.count(ALL);
        const res = await send('DELETE', record(id), TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.conflict);
        const body = problem(res);
        expect(body.code).toBe('ERP-PAYMENTMODES-0001');
        expect(body.detail).toBe(`used by ${words}; ${SWITCH_OFF}`);
        expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.ok);
        expect(await ctx.repo.count(ALL)).toBe(total);
        expect(ctx.events.count).toBe(0);
        expect(ctx.logger.lines).toEqual([]);
      },
    );

    it('names only the non-zero groups, in order', async () => {
      const id = await created('Busy');
      ctx.repo.usage.set(Number(id), {
        ...ZERO_USAGE,
        invoicePayments: 2,
        creditNoteRefunds: 1,
        orderReturnRefunds: 4,
      });
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(problem(res).detail).toBe(
        `used by 2 invoice payment(s), 1 credit note refund(s) and 4 order return refund(s); ${SWITCH_OFF}`,
      );
    });

    it.each([['exact'], ['padded']])(
      'of the mode the credit option names (%s text) is 409 ERP-PAYMENTMODES-0002 even when unused',
      async (form) => {
        const id = await created(`Credit ${form}`);
        ctx.setCreditMode(form === 'exact' ? id : ` ${id}abc`);
        const res = await send('DELETE', record(id), TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.conflict);
        const body = problem(res);
        expect(body.code).toBe('ERP-PAYMENTMODES-0002');
        expect(body.detail).toBe(CREDIT_LOCK);
        expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.ok);
        expect(ctx.events.count).toBe(0);
      },
    );

    it.each([['0'], [''], ['abc'], ['another id']])(
      'with the credit option %j the mode deletes (204)',
      async (option) => {
        const id = await created(`Not credit ${option}`);
        ctx.setCreditMode(option === 'another id' ? String(Number(id) + 1000) : option);
        expect((await send('DELETE', record(id), TEST_BEARERS.admin)).statusCode).toBe(
          HTTP.noContent,
        );
      },
    );

    it('when the mode is both in use and the credit mode, 0002 answers and the usage is never read', async () => {
      const id = await created('Both locks');
      ctx.repo.usage.set(Number(id), { ...ZERO_USAGE, expenses: 1 });
      ctx.setCreditMode(id);
      const usage = vi.spyOn(ctx.repo, 'usageByPaymentMode');
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(problem(res).code).toBe('ERP-PAYMENTMODES-0002');
      expect(usage).not.toHaveBeenCalled();
    });
  });

  describe('every export format through the shared core', () => {
    const FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;

    it('csv answers id, name, description and active only (active 1 or 0), the attachment name, no-store and a BOM', async () => {
      const res = await send('GET', `${EXPORT}?q=bank&sort=id`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="payment-modes-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(
        res.payload.startsWith(
          `${CSV_BOM}id,name,description,active\r\n1,Bank,,1\r\n3,Bank,"Line one\nline two",1\r\n`,
        ),
      ).toBe(true);
      const inactive = await send('GET', `${EXPORT}?q=cash&sort=id`, TEST_BEARERS.admin);
      expect(inactive.payload.split('\r\n')[1]).toBe('2,Cash,,0');
    });

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)(
      'format=%s answers its content type and payment-modes-<date>.<ext>',
      async (format, type, magic) => {
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.ok);
        expect(res.headers['content-type']).toBe(type);
        expect(res.headers['content-disposition']).toMatch(
          new RegExp(`^attachment; filename="payment-modes-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`),
        );
        expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      },
    );

    it('format=print answers the four columns as text rows with the sent yes and no words, no attachment', async () => {
      const res = await send(
        'GET',
        `${EXPORT}?format=print&q=cash&sort=id&yes=Yes&no=No`,
        TEST_BEARERS.admin,
      );
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name', 'description', 'active']);
      expect(body.rows[0]).toEqual(['2', 'Cash', '', 'No']);
    });

    it.each(FORMATS)(
      'format=%s from the every-code bearer is 403 and nothing is counted',
      async (format) => {
        const count = vi.spyOn(ctx.repo, 'count');
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.everyCode);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(count).not.toHaveBeenCalled();
      },
    );

    it('escapes a formula in a name and in a header label (T-4.1-119)', async () => {
      await created('=HYPERLINK("http://x","y")');
      const labels = ['@SUM(1)', 'Name', 'Description', 'Active'].map(
        (label) => `header=${encodeURIComponent(label)}`,
      );
      const res = await send(
        'GET',
        `${EXPORT}?q=hyperlink&${labels.join('&')}`,
        TEST_BEARERS.admin,
      );
      expect(res.statusCode).toBe(HTTP.ok);
      const [header, row] = res.payload.slice(CSV_BOM.length).split('\r\n');
      expect(header).toBe("'@SUM(1),Name,Description,Active");
      expect(row).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    });

    it("key is a 400 on ['key'] (no bulk actions); limit and cursor still are", async () => {
      for (const [query, path] of [
        ['key=3', 'key'],
        ['limit=10', 'limit'],
        ['cursor=abc', 'cursor'],
      ] as const) {
        const res = await send('GET', `${EXPORT}?${query}`, TEST_BEARERS.admin);
        expect(res.statusCode, query).toBe(HTTP.bad);
        expect(problem(res).issues, query).toEqual([expect.objectContaining({ path: [path] })]);
      }
    });

    it('column=name exports that one column (D-13); neither the usage nor the setting is read', async () => {
      const usage = vi.spyOn(ctx.repo, 'usageByPaymentMode');
      const res = await send('GET', `${EXPORT}?column=name&q=cash&sort=id`, TEST_BEARERS.admin);
      expect(res.payload.startsWith(`${CSV_BOM}name\r\nCash\r\n`)).toBe(true);
      expect(usage).not.toHaveBeenCalled();
      expect(ctx.settings.calls).toEqual([]);
    });
  });

  it.each(ROUTES.filter((route) => route.method === 'GET'))(
    '$name carries x-request-id, minted when absent and echoed when valid',
    async ({ url }) => {
      const minted = await send('GET', url('1'), TEST_BEARERS.admin);
      expect(minted.headers['x-request-id']).toMatch(UUID);
      const echoed = await ctx.app.inject({
        method: 'GET',
        url: url('1'),
        headers: { ...bearer(TEST_BEARERS.admin), 'x-request-id': 'web-trace-1' },
      });
      expect(echoed.headers['x-request-id']).toBe('web-trace-1');
    },
  );

  it('ADR-0030: every route is under /api/v1/ or one of UNPREFIXED_ROUTES', () => {
    expect(ctx.routes.length).toBeGreaterThanOrEqual(7);
    const unprefixed: readonly string[] = UNPREFIXED_ROUTES.map((route) => `/${route}`);
    for (const route of ctx.routes) {
      const url = route.slice(route.indexOf(' ') + 1);
      expect(url.startsWith(`/${API_PREFIX}/`) || unprefixed.includes(url), route).toBe(true);
    }
  });
});
