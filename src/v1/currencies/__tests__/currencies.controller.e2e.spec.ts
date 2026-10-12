/**
 * The HTTP contract of `api/v1/currencies` in-process (the test app: the real module, guards,
 * prefix and filter; the repository faked; one `probeRows` counter registered through the real
 * facade at init, its answers settable): administrators only on all seven routes (D-06, D-38), the
 * record with every count, the shared code schema on the wire, the widened code lock (D-42, answers
 * 2 and 8 c), make-base on Perfex's rule (D-39), the DELETE with its three 409s (D-40, D-41), the
 * events and log lines (D-43), and the four export formats (ADR-0043).
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { CSV_BOM, EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import { CURRENCIES_ROUTES } from '../currencies.routes.js';
import {
  currenciesBaseResponseSchema,
  currenciesListResponseSchema,
  currenciesResponseSchema,
} from '../dto/currencies.dto.js';
import {
  CurrenciesBaseChangedV1,
  CurrenciesCreatedV1,
  CurrenciesDeletedV1,
  CurrenciesUpdatedV1,
} from '../events/published.js';
import type { CurrencyLockUsage, CurrencyUsage } from '../model/currencies.model.js';
import {
  NO_CURRENCY_LOCK_USAGE,
  NO_CURRENCY_USAGE,
  USAGE_WORDS,
} from '../service/currencies.transformer.js';
import {
  createCurrenciesTestApp,
  TEST_BEARERS,
  TEST_NOW,
  type CurrenciesTestApp,
} from './create-currencies-test-app.js';
import { SEED_CURRENCIES } from './fakes.js';

const LIST = `/${API_PREFIX}/${CURRENCIES_ROUTES.base}`;
const EXPORT = `${LIST}/${CURRENCIES_ROUTES.export}`;
const record = (id: string | number): string => `${LIST}/${String(id)}`;
const base = (id: string | number): string => `${record(id)}/base`;
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
const ADMIN_ONLY = 'currencies are managed by administrators only';
const NOT_COUNTED = 'its use could not be counted';
const LOCK_TAIL =
  'so its code cannot change: past records would show another code; the symbol, the separators and the placement can';

const BODY = {
  name: 'usd',
  symbol: '$',
  decimalSeparator: '.',
  thousandSeparator: ',',
  placement: 'before',
} as const;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/**
 * The seven routes, each with the body it needs and the status an administrator gets. A route that
 * changes a row runs on a fresh row (`fresh`), so the seed stays as the other cases read it.
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
  { name: 'POST', method: 'POST', url: () => LIST, payload: BODY, admin: HTTP.created },
  {
    name: 'PATCH :id',
    method: 'PATCH',
    url: record,
    payload: { ...BODY, name: 'zzb' },
    admin: HTTP.ok,
    fresh: true,
  },
  { name: 'PATCH :id/base', method: 'PATCH', url: base, payload: {}, admin: HTTP.ok, fresh: true },
  { name: 'DELETE :id', method: 'DELETE', url: record, admin: HTTP.noContent, fresh: true },
];

const usage = (overrides: Partial<CurrencyUsage>) => ({
  usage: { ...NO_CURRENCY_USAGE, ...overrides },
  lockUsage: NO_CURRENCY_LOCK_USAGE,
});
const lockOnly = (overrides: Partial<CurrencyLockUsage>) => ({
  usage: NO_CURRENCY_USAGE,
  lockUsage: { ...NO_CURRENCY_LOCK_USAGE, ...overrides },
});

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('CurrenciesController (Fastify inject, no network)', () => {
  let ctx: CurrenciesTestApp;

  beforeAll(async () => {
    ctx = await createCurrenciesTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    // The seed back as it was (a make-base case moves the flag), every other row not the base.
    ctx.repo.seed(ctx.repo.all().map((row) => ({ ...row, isBase: false })));
    ctx.repo.seed(SEED_CURRENCIES);
    ctx.repo.counts.clear();
    ctx.repo.usageError = null;
    ctx.repo.calls.length = 0;
    ctx.counter.answers.clear();
    ctx.counter.error = null;
    ctx.counter.asked.length = 0;
    ctx.events.drain();
    ctx.logger.lines.length = 0;
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<CurrenciesTestApp['app']['inject']> =>
    ctx.app.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: bearer(token) }),
      ...(payload === undefined ? {} : { payload }),
    });

  /** A fresh row to change or delete, so each case owns its data; the log, events and calls are cleared. */
  const created = async (name = 'zza', extra: object = {}): Promise<string> => {
    const res = await send('POST', LIST, TEST_BEARERS.admin, { ...BODY, name, ...extra });
    expect(res.statusCode).toBe(HTTP.created);
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    ctx.repo.calls.length = 0;
    ctx.counter.asked.length = 0;
    return currenciesResponseSchema.parse(JSON.parse(res.payload)).id;
  };

  const eventsOf = () => ctx.events.drain().map((event) => [event.name, event.payload]);

  it('registers the seven routes under /api/v1/currencies, make-base and DELETE included', () => {
    for (const route of [
      `GET ${LIST}`,
      `GET ${EXPORT}`,
      `GET ${LIST}/:id`,
      `POST ${LIST}`,
      `PATCH ${LIST}/:id`,
      `PATCH ${LIST}/:id/base`,
      `DELETE ${LIST}/:id`,
    ]) {
      expect(ctx.routes).toContain(route);
    }
  });

  describe('administrators only (D-06, D-38, T-4.1-145)', () => {
    it.each(ROUTES)(
      '$name with a bearer holding every catalogue code, not an administrator, is 403 ERP-AUTH-0005 before any repository read or registered counter',
      async ({ method, url, payload }) => {
        const res = await send(method, url('2'), TEST_BEARERS.everyCode, payload);
        expect(res.statusCode).toBe(HTTP.forbidden);
        const body = problem(res);
        expect(body.code).toBe('ERP-AUTH-0005');
        expect(body.detail).toBe(ADMIN_ONLY);
        expect(ctx.repo.calls).toEqual([]);
        expect(ctx.counter.asked).toEqual([]);
        expect(ctx.events.count).toBe(0);
        expect(ctx.logger.lines).toEqual([]);
      },
    );

    it.each(ROUTES)('$name with a bearer holding no code is 403 ERP-AUTH-0005', async (route) => {
      const res = await send(
        route.method,
        route.url('2'),
        TEST_BEARERS.noPermission,
        route.payload,
      );
      expect(res.statusCode).toBe(HTTP.forbidden);
      expect(problem(res).code).toBe('ERP-AUTH-0005');
    });

    it.each(ROUTES)('$name without a bearer is 401 ERP-AUTH-0004', async (route) => {
      const res = await send(route.method, route.url('2'), undefined, route.payload);
      expect(res.statusCode).toBe(HTTP.unauthorized);
      expect(problem(res).code).toBe('ERP-AUTH-0004');
    });

    it.each(ROUTES)(
      '$name with the administrator bearer is served ($admin)',
      async ({ method, url, payload, admin, fresh }) => {
        const id = fresh === true ? await created() : '2';
        const res = await send(method, url(id), TEST_BEARERS.admin, payload);
        expect(res.statusCode).toBe(admin);
      },
    );
  });

  describe('GET list and GET :id', () => {
    it("defaults to Perfex's order, the code descending, with both limits in meta", async () => {
      const res = await send('GET', LIST, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = currenciesListResponseSchema.parse(JSON.parse(res.payload));
      const codes = body.data.map((row) => row.name);
      expect(codes).toEqual([...codes].sort().reverse());
      expect(body.meta).toMatchObject({ exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS });
    });

    it('each row carries every field, usage, lockUsage, registeredUsage and canMakeBase', async () => {
      ctx.repo.counts.set(2, {
        usage: { ...NO_CURRENCY_USAGE, vendors: 2 },
        lockUsage: { ...NO_CURRENCY_LOCK_USAGE, exchangeRates: 1 },
      });
      ctx.counter.answers.set(2, 3);
      const res = await send('GET', `${LIST}?sort=id`, TEST_BEARERS.admin);
      const body = currenciesListResponseSchema.parse(JSON.parse(res.payload));
      expect(body.data[1]).toEqual({
        id: '2',
        name: 'EUR',
        symbol: 'EUR',
        decimalSeparator: ',',
        thousandSeparator: '.',
        placement: 'after',
        isBase: false,
        usage: { ...NO_CURRENCY_USAGE, vendors: 2 },
        lockUsage: { ...NO_CURRENCY_LOCK_USAGE, exchangeRates: 1 },
        registeredUsage: { probeRows: 3 },
        canMakeBase: true,
      });
      expect(body.data[0]).toMatchObject({ id: '1', isBase: true, canMakeBase: false });
    });

    it('the base read once per page: findBase is called once for a list', async () => {
      await send('GET', LIST, TEST_BEARERS.admin);
      expect(ctx.repo.calls.filter((call) => call === 'findBase')).toHaveLength(1);
    });

    it('GET :id of a missing id is 404; a non-numeric :id is 400', async () => {
      expect(problem(await send('GET', record(99), TEST_BEARERS.admin)).code).toBe('ERP-CORE-0004');
      expect((await send('GET', record('abc'), TEST_BEARERS.admin)).statusCode).toBe(HTTP.bad);
    });
  });

  describe('POST and PATCH :id (D-38, the shared code schema)', () => {
    it('create with usd reads back USD; one Created event and one log line with the id', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, BODY);
      expect(res.statusCode).toBe(HTTP.created);
      const body = currenciesResponseSchema.parse(JSON.parse(res.payload));
      expect(body).toMatchObject({ name: 'USD', isBase: false });
      expect(eventsOf()).toEqual([[CurrenciesCreatedV1.NAME, { id: Number(body.id), at: AT }]]);
      expect(ctx.logger.lines).toEqual([
        { message: 'currency created', meta: { id: Number(body.id) } },
      ]);
    });

    it('create with ABCD is a 400 on [name]; isBase or isdefault in a body is a 400', async () => {
      const long = await send('POST', LIST, TEST_BEARERS.admin, { ...BODY, name: 'ABCD' });
      expect(long.statusCode).toBe(HTTP.bad);
      expect(problem(long).issues).toEqual([
        expect.objectContaining({ path: ['name'], message: 'at most 3 characters' }),
      ]);
      for (const key of ['isBase', 'isdefault']) {
        const res = await send('POST', LIST, TEST_BEARERS.admin, { ...BODY, [key]: true });
        expect(res.statusCode, key).toBe(HTTP.bad);
      }
      expect(ctx.events.count).toBe(0);
    });

    it('a code the seed holds is accepted (Perfex has no uniqueness check)', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { ...BODY, name: 'eur' });
      expect(res.statusCode).toBe(HTTP.created);
    });

    it('update rewrites the five fields; one Updated event and one log line', async () => {
      const id = await created('zzc');
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, {
        name: 'zzd',
        symbol: 'Fr',
        decimalSeparator: ',',
        thousandSeparator: "'",
        placement: 'after',
      });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(res.payload)).toMatchObject({
        name: 'ZZD',
        symbol: 'Fr',
        decimalSeparator: ',',
        thousandSeparator: "'",
        placement: 'after',
      });
      expect(eventsOf()).toEqual([[CurrenciesUpdatedV1.NAME, { id: Number(id), at: AT }]]);
      expect(ctx.logger.lines).toEqual([{ message: 'currency updated', meta: { id: Number(id) } }]);
    });

    it('PATCH {} is 400; PATCH of a missing id is 404', async () => {
      expect((await send('PATCH', record(2), TEST_BEARERS.admin, {})).statusCode).toBe(HTTP.bad);
      expect(problem(await send('PATCH', record(99), TEST_BEARERS.admin, BODY)).code).toBe(
        'ERP-CORE-0004',
      );
    });
  });

  describe('the code lock (D-42 widened, answers 2 and 8 c)', () => {
    it('a code change on a row with a delete-counting use is 409 ERP-CURRENCIES-0005, nothing written', async () => {
      const id = await created('zza');
      ctx.repo.counts.set(Number(id), usage({ invoices: 2 }));
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, { ...BODY, name: 'zzb' });
      expect(res.statusCode).toBe(HTTP.conflict);
      const body = problem(res);
      expect(body.code).toBe('ERP-CURRENCIES-0005');
      expect(body.detail).toBe(`it is in use (2 invoice(s)), ${LOCK_TAIL}`);
      expect(ctx.repo.calls).not.toContain('update');
      expect(ctx.events.count).toBe(0);
      expect(ctx.logger.lines).toEqual([]);
    });

    it('an exchange rate alone locks the code too (lockUsage)', async () => {
      const id = await created('zza');
      ctx.repo.counts.set(Number(id), lockOnly({ exchangeRates: 1 }));
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, { ...BODY, name: 'zzb' });
      expect(problem(res)).toMatchObject({
        code: 'ERP-CURRENCIES-0005',
        detail: `it is in use (1 exchange rate reference(s)), ${LOCK_TAIL}`,
      });
    });

    it('D-42: a probe row alone locks the code', async () => {
      const id = await created('zza');
      ctx.counter.answers.set(Number(id), 1);
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, { ...BODY, name: 'zzb' });
      expect(res.statusCode).toBe(HTTP.conflict);
      expect(problem(res)).toMatchObject({
        code: 'ERP-CURRENCIES-0005',
        detail: `it is in use (1 probe row(s)), ${LOCK_TAIL}`,
      });
      expect(ctx.repo.calls).not.toContain('update');
      expect(ctx.repo.all().find((row) => row.id === Number(id))?.name).toBe('ZZA');
    });

    it('a counter that rejects on a code change is 409 0005 its use could not be counted', async () => {
      const id = await created('zza');
      ctx.counter.error = new Error('lock wait timeout');
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, { ...BODY, name: 'zzb' });
      expect(problem(res)).toMatchObject({ code: 'ERP-CURRENCIES-0005', detail: NOT_COUNTED });
    });

    it('a usage read that fails on a code change is 409 0005 its use could not be counted', async () => {
      const id = await created('zza');
      ctx.repo.usageError = new Error('information_schema unavailable');
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, { ...BODY, name: 'zzb' });
      expect(problem(res)).toMatchObject({ code: 'ERP-CURRENCIES-0005', detail: NOT_COUNTED });
    });

    it('the symbol, the separators and the placement change on a row in use while the code stays (200)', async () => {
      const id = await created('zza');
      ctx.repo.counts.set(Number(id), {
        usage: { ...NO_CURRENCY_USAGE, invoices: 1 },
        lockUsage: { ...NO_CURRENCY_LOCK_USAGE, exchangeRates: 1 },
      });
      ctx.counter.answers.set(Number(id), 4);
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, {
        name: ' zza ',
        symbol: 'Z',
        decimalSeparator: ',',
        thousandSeparator: ' ',
        placement: 'after',
      });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(res.payload)).toMatchObject({
        name: 'ZZA',
        symbol: 'Z',
        placement: 'after',
      });
    });

    it('the usage and the counters are read on an update only when the code changes', async () => {
      const id = await created('zza');
      await send('PATCH', record(id), TEST_BEARERS.admin, { ...BODY, name: 'zza', symbol: 'Q' });
      const beforeWrite = ctx.repo.calls.slice(0, ctx.repo.calls.indexOf('update'));
      expect(beforeWrite).toEqual(['findById']);
    });

    it('a code change on an unused row is 200', async () => {
      const id = await created('zza');
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, { ...BODY, name: 'zzc' });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(res.payload)).toMatchObject({ name: 'ZZC' });
    });
  });

  describe('PATCH :id/base (D-39, Perfex make_base_currency)', () => {
    it('makes the row the base: 200 { id, isBase: true }; the old base is not; one baseChanged with previousId', async () => {
      const res = await send('PATCH', base(3), TEST_BEARERS.admin, {});
      expect(res.statusCode).toBe(HTTP.ok);
      expect(currenciesBaseResponseSchema.parse(JSON.parse(res.payload))).toEqual({
        id: '3',
        isBase: true,
      });
      expect(
        ctx.repo
          .all()
          .filter((row) => row.isBase)
          .map((row) => row.id),
      ).toEqual([3]);
      expect(eventsOf()).toEqual([
        [CurrenciesBaseChangedV1.NAME, { id: 3, previousId: 1, at: AT }],
      ]);
      expect(ctx.logger.lines).toEqual([
        { message: 'base currency changed', meta: { id: 3, previousId: 1 } },
      ]);
    });

    it('on the base itself answers 200 with no write, no event and no log line', async () => {
      const res = await send('PATCH', base(1), TEST_BEARERS.admin, {});
      expect(res.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(res.payload)).toEqual({ id: '1', isBase: true });
      expect(ctx.repo.calls).not.toContain('setBase');
      expect(ctx.events.count).toBe(0);
      expect(ctx.logger.lines).toEqual([]);
    });

    it('409 ERP-CURRENCIES-0004 while the base has a use in Perfex seven core columns', async () => {
      ctx.repo.counts.set(1, usage({ invoices: 2, expenses: 1 }));
      const res = await send('PATCH', base(3), TEST_BEARERS.admin, {});
      expect(res.statusCode).toBe(HTTP.conflict);
      expect(problem(res)).toMatchObject({
        code: 'ERP-CURRENCIES-0004',
        detail:
          'the base currency is used by 2 invoice(s) and 1 expense(s); Perfex does not allow changing the base currency once it has transactions',
      });
      expect(ctx.repo.all().find((row) => row.isBase)?.id).toBe(1);
      expect(ctx.events.count).toBe(0);
    });

    it('a module-only use of the base does not block (Perfex counts its seven columns)', async () => {
      ctx.repo.counts.set(1, {
        usage: { ...NO_CURRENCY_USAGE, vendors: 5, purchaseOrders: 2 },
        lockUsage: { ...NO_CURRENCY_LOCK_USAGE, exchangeRates: 3 },
      });
      ctx.counter.answers.set(1, 9);
      expect((await send('PATCH', base(3), TEST_BEARERS.admin, {})).statusCode).toBe(HTTP.ok);
    });

    it('a missing id is 404; a body key is 400', async () => {
      expect(problem(await send('PATCH', base(99), TEST_BEARERS.admin, {})).code).toBe(
        'ERP-CORE-0004',
      );
      expect((await send('PATCH', base(3), TEST_BEARERS.admin, { isBase: true })).statusCode).toBe(
        HTTP.bad,
      );
    });

    it('a usage read that fails is 409 0004 its use could not be counted', async () => {
      ctx.repo.usageError = new Error('lock wait timeout');
      expect(problem(await send('PATCH', base(3), TEST_BEARERS.admin, {}))).toMatchObject({
        code: 'ERP-CURRENCIES-0004',
        detail: NOT_COUNTED,
      });
    });
  });

  describe('DELETE :id (D-40, D-41)', () => {
    it('answers 204 with no body, then GET :id is 404; one Deleted event and one log line', async () => {
      const id = await created('zza');
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.noContent);
      expect(res.payload).toBe('');
      expect(eventsOf()).toEqual([[CurrenciesDeletedV1.NAME, { id: Number(id), at: AT }]]);
      expect(ctx.logger.lines).toEqual([{ message: 'currency deleted', meta: { id: Number(id) } }]);
      expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.notFound);
    });

    it('of a missing id is 404 ERP-CORE-0004, and nothing is published', async () => {
      expect(problem(await send('DELETE', record(99), TEST_BEARERS.admin)).code).toBe(
        'ERP-CORE-0004',
      );
      expect(ctx.events.count).toBe(0);
    });

    it.each(USAGE_WORDS)(
      '409 ERP-CURRENCIES-0001 while the %s group holds the currency',
      async (group, words) => {
        const id = await created('zza');
        ctx.repo.counts.set(Number(id), usage({ [group]: 1 }));
        const res = await send('DELETE', record(id), TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.conflict);
        expect(problem(res)).toMatchObject({
          code: 'ERP-CURRENCIES-0001',
          detail: `used by 1 ${words}`,
        });
        expect(ctx.repo.calls).not.toContain('remove');
        expect(ctx.counter.asked).toEqual([]);
        expect(ctx.events.count).toBe(0);
      },
    );

    it('a lockUsage-only row deletes: the exchange rates never block a delete', async () => {
      const id = await created('zza');
      ctx.repo.counts.set(Number(id), lockOnly({ exchangeRates: 4, exchangeRateLogs: 2 }));
      expect((await send('DELETE', record(id), TEST_BEARERS.admin)).statusCode).toBe(
        HTTP.noContent,
      );
    });

    it('409 ERP-CURRENCIES-0002 for the base (Perfex), the counters never read', async () => {
      const res = await send('DELETE', record(1), TEST_BEARERS.admin);
      expect(problem(res)).toMatchObject({
        code: 'ERP-CURRENCIES-0002',
        detail: 'it is the base currency; make another currency the base first',
      });
      expect(ctx.counter.asked).toEqual([]);
    });

    it('409 ERP-CURRENCIES-0003 while a registered counter answers more than 0', async () => {
      const id = await created('zza');
      ctx.counter.answers.set(Number(id), 2);
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(problem(res)).toMatchObject({
        code: 'ERP-CURRENCIES-0003',
        detail: 'used by 2 probe row(s); remove them first',
      });
      expect(ctx.repo.calls).not.toContain('remove');
    });

    it('a counter that rejects is 409 0003 its use could not be counted', async () => {
      const id = await created('zza');
      ctx.counter.error = new Error('lock wait timeout');
      expect(problem(await send('DELETE', record(id), TEST_BEARERS.admin))).toMatchObject({
        code: 'ERP-CURRENCIES-0003',
        detail: NOT_COUNTED,
      });
    });

    it('a usage read that fails is 409 0001 its use could not be counted', async () => {
      const id = await created('zza');
      ctx.repo.usageError = new Error('information_schema unavailable');
      expect(problem(await send('DELETE', record(id), TEST_BEARERS.admin))).toMatchObject({
        code: 'ERP-CURRENCIES-0001',
        detail: NOT_COUNTED,
      });
    });
  });

  describe('every export format through the shared core', () => {
    const FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;

    it('csv answers name, symbol and isBase only (1 or 0), the attachment name, no-store and a BOM', async () => {
      const res = await send('GET', `${EXPORT}?sort=id`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="currencies-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(
        res.payload.startsWith(`${CSV_BOM}name,symbol,isBase\r\nUSD,$,1\r\nEUR,EUR,0\r\n`),
      ).toBe(true);
    });

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)(
      'format=%s answers its content type and currencies-<date>.<ext>',
      async (format, type, magic) => {
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.ok);
        expect(res.headers['content-type']).toBe(type);
        expect(res.headers['content-disposition']).toMatch(
          new RegExp(`^attachment; filename="currencies-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`),
        );
        expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      },
    );

    it('format=print answers the three columns as text rows with the sent yes and no words', async () => {
      const res = await send(
        'GET',
        `${EXPORT}?format=print&sort=id&yes=Yes&no=No`,
        TEST_BEARERS.admin,
      );
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['name', 'symbol', 'isBase']);
      expect(body.rows.slice(0, 2)).toEqual([
        ['USD', '$', 'Yes'],
        ['EUR', 'EUR', 'No'],
      ]);
    });

    it.each(FORMATS)(
      'format=%s from the every-code bearer is 403 and nothing is counted',
      async (format) => {
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.everyCode);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(ctx.repo.calls).toEqual([]);
      },
    );

    it('escapes a formula in a symbol and in a header label (T-4.1-154)', async () => {
      await created('zzh', { symbol: '=HYPERLINK' });
      const labels = ['@SUM(1)', 'Symbol', 'Base'].map(
        (label) => `header=${encodeURIComponent(label)}`,
      );
      const res = await send('GET', `${EXPORT}?q=zzh&${labels.join('&')}`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const [header, row] = res.payload.slice(CSV_BOM.length).split('\r\n');
      expect(header).toBe("'@SUM(1),Symbol,Base");
      expect(row).toBe("ZZH,'=HYPERLINK,0");
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

    it('column=name exports that one column; no count is read', async () => {
      const res = await send('GET', `${EXPORT}?column=name&sort=id`, TEST_BEARERS.admin);
      expect(res.payload.startsWith(`${CSV_BOM}name\r\nUSD\r\n`)).toBe(true);
      expect(ctx.repo.calls).not.toContain('usageByCurrency');
      expect(ctx.counter.asked).toEqual([]);
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
