/**
 * The HTTP contract of the six routes under `/api/v1/fixed-equipment-depreciations`, proven
 * in-process with Fastify `inject` over the in-memory fake and the real guards: no bearer is 401
 * `ERP-AUTH-0004`, a member without a code is 403 `ERP-AUTH-0005` before any read, `view` reads
 * every row, `viewOwn` only the rows the member created (another member's row is the same 404 as a
 * missing one), and each write needs its own code. Then the list in Perfex's order (the id
 * descending), create (the creator is the caller) and update (the name and the term only), the
 * DELETE (refused with 409 while an asset model or an asset uses it, or when its use cannot be
 * counted), the export of `id`, `name` and `term`, `x-request-id` on
 * every response, and the ADR-0030 route assertion.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { CSV_BOM, EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import { fixedEquipmentDepreciationsResponseSchema } from '../dto/fixed-equipment-depreciations.dto.js';
import {
  FixedEquipmentDepreciationsCreatedV1,
  FixedEquipmentDepreciationsDeletedV1,
  FixedEquipmentDepreciationsUpdatedV1,
} from '../events/published.js';
import {
  createFixedEquipmentDepreciationsTestApp,
  TEST_BEARERS,
  TEST_STAFF,
  type FixedEquipmentDepreciationsTestApp,
} from './create-fixed-equipment-depreciations-test-app.js';

const LIST = `/${API_PREFIX}/fixed-equipment-depreciations`;
const EXPORT = `${LIST}/export`;
const record = (id: string | number): string => `${LIST}/${String(id)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HTTP = {
  ok: 200,
  created: 201,
  noContent: 204,
  bad: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
};
/** Every row: the fake's own match with no search, for a count. */
const ALL = { search: null, sortField: 'id', order: 'asc', cursor: null, limit: 1 } as const;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface ListBody {
  readonly data: readonly {
    readonly id: string;
    readonly name: string;
    readonly term: number | null;
  }[];
  readonly meta: { readonly exportLimit: number; readonly printLimit: number };
}

/**
 * The six routes, each with the body it needs and the status each bearer gets. Row 1 is staff 1's,
 * so the view-own member never sees it; DELETE targets a fresh row (see `created`).
 */
const ROUTES: readonly {
  method: Method;
  url: string;
  payload?: object;
  admin: number;
  viewer: number;
  owner: number;
}[] = [
  { method: 'GET', url: LIST, admin: HTTP.ok, viewer: HTTP.ok, owner: HTTP.ok },
  { method: 'GET', url: EXPORT, admin: HTTP.ok, viewer: HTTP.ok, owner: HTTP.ok },
  { method: 'GET', url: record(1), admin: HTTP.ok, viewer: HTTP.ok, owner: HTTP.notFound },
  {
    method: 'POST',
    url: LIST,
    payload: { name: 'New', term: 12 },
    admin: HTTP.created,
    viewer: HTTP.created,
    owner: HTTP.created,
  },
  {
    method: 'PATCH',
    url: record(1),
    payload: { name: 'Depreciation 1', term: 12 },
    admin: HTTP.ok,
    viewer: HTTP.ok,
    owner: HTTP.forbidden,
  },
  {
    method: 'DELETE',
    url: record(2),
    admin: HTTP.noContent,
    viewer: HTTP.noContent,
    owner: HTTP.forbidden,
  },
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('FixedEquipmentDepreciationsController (Fastify inject, no network)', () => {
  let ctx: FixedEquipmentDepreciationsTestApp;

  beforeAll(async () => {
    ctx = await createFixedEquipmentDepreciationsTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.repo.usageOf.clear();
    ctx.repo.usageFails = false;
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    vi.restoreAllMocks();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<FixedEquipmentDepreciationsTestApp['app']['inject']> =>
    ctx.app.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: bearer(token) }),
      ...(payload === undefined ? {} : { payload }),
    });

  /** A fresh row (the administrator's) to delete or change; the log and events are cleared. */
  const created = async (name: string, token: string = TEST_BEARERS.admin): Promise<string> => {
    const res = await send('POST', LIST, token, { name, term: 24 });
    expect(res.statusCode).toBe(HTTP.created);
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    return fixedEquipmentDepreciationsResponseSchema.parse(JSON.parse(res.payload)).id;
  };

  /** The creator the fake stored for a row, read under `all`. */
  const creatorOf = async (id: string): Promise<number | null | undefined> =>
    (await ctx.repo.findById(Number(id), 'all', 0))?.creatorId;

  it('registers the six routes under /api/v1/fixed-equipment-depreciations, DELETE included', () => {
    for (const route of [
      `GET ${LIST}`,
      `GET ${EXPORT}`,
      `GET ${LIST}/:id`,
      `POST ${LIST}`,
      `PATCH ${LIST}/:id`,
      `DELETE ${LIST}/:id`,
    ]) {
      expect(ctx.routes).toContain(route);
    }
  });

  describe('the guards', () => {
    it.each(ROUTES)(
      '$method $url without a bearer is 401 ERP-AUTH-0004',
      async ({ method, url, payload }) => {
        const res = await send(method, url, undefined, payload);
        expect(res.statusCode).toBe(HTTP.unauthorized);
        expect(problem(res).code).toBe('ERP-AUTH-0004');
      },
    );

    it.each(ROUTES)(
      '$method $url with an unknown bearer is 401 ERP-AUTH-0004',
      async ({ method, url, payload }) => {
        const res = await send(method, url, 'not-a-real-token', payload);
        expect(res.statusCode).toBe(HTTP.unauthorized);
        expect(problem(res).code).toBe('ERP-AUTH-0004');
      },
    );

    it.each(ROUTES)(
      '$method $url with a bearer holding no code is 403 ERP-AUTH-0005 before any read',
      async ({ method, url, payload }) => {
        const reads = [
          vi.spyOn(ctx.repo, 'list'),
          vi.spyOn(ctx.repo, 'count'),
          vi.spyOn(ctx.repo, 'findById'),
          vi.spyOn(ctx.repo, 'create'),
          vi.spyOn(ctx.repo, 'update'),
          vi.spyOn(ctx.repo, 'remove'),
        ];
        const res = await send(method, url, TEST_BEARERS.noPermission, payload);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(problem(res).code).toBe('ERP-AUTH-0005');
        for (const spy of reads) expect(spy).not.toHaveBeenCalled();
        expect(ctx.events.count).toBe(0);
        expect(ctx.logger.lines).toEqual([]);
      },
    );

    it.each(ROUTES)(
      '$method $url with the administrator bearer is served ($admin)',
      async ({ method, url, payload, admin }) => {
        const target = method === 'DELETE' ? record(await created('Doomed by admin')) : url;
        const res = await send(method, target, TEST_BEARERS.admin, payload);
        expect(res.statusCode).toBe(admin);
      },
    );

    it.each(ROUTES)(
      '$method $url with the view-and-writes bearer is served ($viewer)',
      async ({ method, url, payload, viewer }) => {
        const target = method === 'DELETE' ? record(await created('Doomed by viewer')) : url;
        const res = await send(method, target, TEST_BEARERS.viewer, payload);
        expect(res.statusCode).toBe(viewer);
      },
    );

    it.each(ROUTES)(
      '$method $url with the view-own bearer answers $owner',
      async ({ method, url, payload, owner }) => {
        const target = method === 'DELETE' ? record(await created('Not theirs to delete')) : url;
        const res = await send(method, target, TEST_BEARERS.owner, payload);
        expect(res.statusCode).toBe(owner);
        if (owner === HTTP.forbidden) expect(problem(res).code).toBe('ERP-AUTH-0005');
      },
    );
  });

  describe('view own: only the rows the member created', () => {
    it('the list shows only the view-own member’s rows; the full viewer sees them all', async () => {
      await created('Mine', TEST_BEARERS.owner);
      const own = JSON.parse((await send('GET', LIST, TEST_BEARERS.owner)).payload) as ListBody;
      expect(own.data.length).toBeGreaterThan(0);
      for (const row of own.data) expect(await creatorOf(row.id)).toBe(TEST_STAFF.owner);

      const all = JSON.parse((await send('GET', LIST, TEST_BEARERS.viewer)).payload) as ListBody;
      expect(all.data.length).toBeGreaterThan(own.data.length);
    });

    it('another member’s row is 404 ERP-CORE-0004, exactly like a missing one; their own row is 200', async () => {
      const hidden = await send('GET', record(1), TEST_BEARERS.owner);
      expect(hidden.statusCode).toBe(HTTP.notFound);
      expect(problem(hidden).code).toBe('ERP-CORE-0004');
      const mine = await send('GET', record(3), TEST_BEARERS.owner);
      expect(mine.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(mine.payload)).toEqual({ id: '3', name: 'Straight line', term: 60 });
    });

    it('under view own, the export holds the member’s own rows only (the list gets the own scope)', async () => {
      const mine = await created('Mine to export', TEST_BEARERS.owner);
      const res = await send('GET', `${EXPORT}?format=print`, TEST_BEARERS.owner);
      expect(res.statusCode).toBe(HTTP.ok);
      const ids = (JSON.parse(res.payload) as { rows: string[][] }).rows.map((row) => row[0]);
      expect(ids).toContain(mine);
      expect(ids).not.toContain('1');
      expect(ids).not.toContain('2');
    });
  });

  describe('GET list and GET :id', () => {
    it("defaults to Perfex's order, the id descending, with no sort sent", async () => {
      const res = await send('GET', LIST, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = JSON.parse(res.payload) as ListBody;
      const order = body.data.map((row) => Number(row.id));
      expect(order).toEqual([...order].sort((x, y) => y - x));
      expect(body.meta).toMatchObject({ exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS });
    });

    it('searches the name, case-insensitively', async () => {
      const res = await send('GET', `${LIST}?q=STRAIGHT`, TEST_BEARERS.admin);
      const body = JSON.parse(res.payload) as ListBody;
      expect(body.data).toEqual([{ id: '3', name: 'Straight line', term: 60 }]);
    });

    it('a row stored without a term reads null; the creator never reaches the wire', async () => {
      const res = await send('GET', record(4), TEST_BEARERS.admin);
      expect(JSON.parse(res.payload)).toEqual({ id: '4', name: 'Legacy', term: null });
      expect(res.payload).not.toContain('creator');
    });

    it('a bad list query is 400 ERP-VALIDATION-0001 with the issues (term is no sort)', async () => {
      const res = await send('GET', `${LIST}?sort=term`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      const body = problem(res);
      expect(body.code).toBe('ERP-VALIDATION-0001');
      expect(JSON.stringify(body.issues)).toContain('sort');
    });

    it('a non-numeric :id is a 400, never a 404 probe; a missing id is 404 ERP-CORE-0004', async () => {
      expect((await send('GET', record('abc'), TEST_BEARERS.admin)).statusCode).toBe(HTTP.bad);
      const missing = await send('GET', record(9_999), TEST_BEARERS.admin);
      expect(missing.statusCode).toBe(HTTP.notFound);
      expect(problem(missing).code).toBe('ERP-CORE-0004');
    });

    it('an id above 4294967295 is 400 ERP-VALIDATION-0001; 4294967295 itself is a plain 404', async () => {
      const tooBig = await send('GET', record(4_294_967_296), TEST_BEARERS.admin);
      expect(tooBig.statusCode).toBe(400);
      expect(problem(tooBig).code).toBe('ERP-VALIDATION-0001');
      const largest = await send('GET', record(4_294_967_295), TEST_BEARERS.admin);
      expect(largest.statusCode).toBe(HTTP.notFound);
    });
  });

  describe('paging with a cursor (the default sort, the id descending)', () => {
    interface Page {
      readonly data: readonly { readonly id: string }[];
      readonly meta: { readonly nextCursor: string | null; readonly prevCursor: string | null };
    }
    const page = async (bearer: string, cursor?: string | null): Promise<Page> => {
      const query =
        cursor === undefined || cursor === null
          ? '?limit=2'
          : `?limit=2&cursor=${encodeURIComponent(cursor)}`;
      const res = await send('GET', `${LIST}${query}`, bearer);
      expect(res.statusCode).toBe(HTTP.ok);
      return JSON.parse(res.payload) as Page;
    };
    const idsOf = (one: Page): string[] => one.data.map((row) => row.id);

    it.each([
      ['view', TEST_BEARERS.viewer],
      ['view own', TEST_BEARERS.owner],
    ])(
      'as %s, ?limit=2 walks forward with nextCursor and back with prevCursor',
      async (_label, bearer) => {
        for (const name of ['Walk one', 'Walk two', 'Walk three'])
          await created(name, TEST_BEARERS.owner);

        const first = await page(bearer);
        expect(first.data).toHaveLength(2);
        expect(first.meta.prevCursor).toBeNull();
        expect(first.meta.nextCursor).not.toBeNull();
        const firstIds = idsOf(first).map(Number);
        expect(firstIds[0]).toBeGreaterThan(firstIds[1] ?? 0);

        const second = await page(bearer, first.meta.nextCursor);
        expect(second.data.length).toBeGreaterThan(0);
        expect(idsOf(second).some((id) => idsOf(first).includes(id))).toBe(false);
        expect(Math.max(...idsOf(second).map(Number))).toBeLessThan(Math.min(...firstIds));

        const back = await page(bearer, second.meta.prevCursor);
        expect(idsOf(back)).toEqual(idsOf(first));
      },
    );
  });

  describe('an item group reaches this tab: the assets group’s codes alone', () => {
    const idsOf = (payload: string): string[] =>
      (JSON.parse(payload) as { data: { id: string }[] }).data.map((row) => row.id);

    it('a member holding only fixedEquipment.assets.view reads every row', async () => {
      const res = await send('GET', LIST, TEST_BEARERS.assetsViewer);
      expect(res.statusCode).toBe(HTTP.ok);
      const ids = idsOf(res.payload);
      expect(ids).toContain('1');
      expect(ids).toContain('2');
    });

    it('a member holding only fixedEquipment.assets.viewOwn reads only their own rows', async () => {
      const mine = await ctx.repo.create({
        name: 'Assets own row',
        term: 12,
        creatorId: TEST_STAFF.assetsOwner,
      });
      const res = await send('GET', LIST, TEST_BEARERS.assetsOwner);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(idsOf(res.payload)).toEqual([String(mine.id)]);
      expect((await send('GET', record(1), TEST_BEARERS.assetsOwner)).statusCode).toBe(
        HTTP.notFound,
      );
    });

    it('a member holding both reads every row: the full view wins', async () => {
      await ctx.repo.create({
        name: 'Assets both row',
        term: 12,
        creatorId: TEST_STAFF.assetsBoth,
      });
      const res = await send('GET', LIST, TEST_BEARERS.assetsBoth);
      expect(res.statusCode).toBe(HTTP.ok);
      const ids = idsOf(res.payload);
      expect(ids).toContain('1');
      expect(ids).toContain('2');
    });

    it('a member holding only fixedEquipment.assets.edit can edit, and cannot read the list', async () => {
      const res = await send('PATCH', record(1), TEST_BEARERS.assetsEditor, {
        name: 'Edited by assets',
        term: 24,
      });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(res.payload)).toMatchObject({
        id: '1',
        name: 'Edited by assets',
        term: 24,
      });
      expect((await send('GET', LIST, TEST_BEARERS.assetsEditor)).statusCode).toBe(HTTP.forbidden);
    });
  });

  describe('POST and PATCH', () => {
    it('POST 201 saves the caller as creator; PATCH changes the name and the term only; one event and one log line each', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.viewer, {
        name: '  Declining  ',
        term: 24,
      });
      expect(res.statusCode).toBe(HTTP.created);
      const dto = fixedEquipmentDepreciationsResponseSchema.parse(JSON.parse(res.payload));
      expect(dto).toEqual({ id: dto.id, name: 'Declining', term: 24 });
      expect(await creatorOf(dto.id)).toBe(TEST_STAFF.viewer);

      const updated = await send('PATCH', record(dto.id), TEST_BEARERS.admin, {
        name: 'Five years',
        term: 60,
      });
      expect(updated.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(updated.payload)).toEqual({ id: dto.id, name: 'Five years', term: 60 });
      expect(await creatorOf(dto.id)).toBe(TEST_STAFF.viewer);

      expect(ctx.events.drain().map((event) => event.constructor)).toEqual([
        FixedEquipmentDepreciationsCreatedV1,
        FixedEquipmentDepreciationsUpdatedV1,
      ]);
      const id = Number(dto.id);
      expect(ctx.logger.lines).toEqual([
        { message: 'depreciation created', meta: { id } },
        { message: 'depreciation updated', meta: { id } },
      ]);
    });

    it.each([
      ['an empty name', { name: '', term: 12 }],
      ['a 201-character name', { name: 'a'.repeat(201), term: 12 }],
      ['no term', { name: 'Declining' }],
      ['a zero term', { name: 'Declining', term: 0 }],
      ['a creator in the body', { name: 'Sneaky', term: 12, creator_id: 9 }],
      ['an id in the body', { name: 'Sneaky', term: 12, id: 77 }],
    ])('POST with %s is 400, and nothing is stored', async (_label, body) => {
      const total = await ctx.repo.count(ALL, 'all', 0);
      const res = await send('POST', LIST, TEST_BEARERS.admin, body);
      expect(res.statusCode).toBe(HTTP.bad);
      expect(problem(res).code).toBe('ERP-VALIDATION-0001');
      expect(await ctx.repo.count(ALL, 'all', 0)).toBe(total);
      expect(ctx.events.count).toBe(0);
    });

    it('PATCH of a missing id is 404 ERP-CORE-0004 and nothing is published', async () => {
      const patch = await send('PATCH', record(9_999), TEST_BEARERS.admin, {
        name: 'Nobody',
        term: 12,
      });
      expect(patch.statusCode).toBe(HTTP.notFound);
      expect(problem(patch).code).toBe('ERP-CORE-0004');
      expect(ctx.events.count).toBe(0);
    });
  });

  describe('DELETE :id', () => {
    it('answers 204 with no body, then GET :id is 404; one event and one log line', async () => {
      const id = await created('Short-lived');
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.noContent);
      expect(res.payload).toBe('');
      const gone = await send('GET', record(id), TEST_BEARERS.admin);
      expect(gone.statusCode).toBe(HTTP.notFound);
      const events = ctx.events.drain();
      expect(events.map((event) => event.constructor)).toEqual([
        FixedEquipmentDepreciationsDeletedV1,
      ]);
      expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual(['at', 'id']);
      expect(ctx.logger.lines).toEqual([
        { message: 'depreciation deleted', meta: { id: Number(id) } },
      ]);
    });

    it('of a missing id is 404 ERP-CORE-0004, and nothing is published', async () => {
      const res = await send('DELETE', record(9_999), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.notFound);
      expect(problem(res).code).toBe('ERP-CORE-0004');
      expect(ctx.events.count).toBe(0);
    });

    it('while an asset model or an asset uses it is 409 ERP-FIXEDEQUIPMENTDEPRECIATIONS-0001, the detail naming both counts: the row stays, no event, no log line', async () => {
      const id = await created('In use');
      ctx.repo.usageOf.set(Number(id), { models: 1, assets: 2 });
      const total = await ctx.repo.count(ALL, 'all', 0);
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(409);
      const body = problem(res);
      expect(body.code).toBe('ERP-FIXEDEQUIPMENTDEPRECIATIONS-0001');
      expect(body.detail).toBe('used by 1 asset model and 2 assets');
      expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.ok);
      expect(await ctx.repo.count(ALL, 'all', 0)).toBe(total);
      expect(ctx.events.count).toBe(0);
      expect(ctx.logger.lines).toEqual([]);
    });

    it('when its use could not be counted is 409 ERP-FIXEDEQUIPMENTDEPRECIATIONS-0002, never a 500; the row stays', async () => {
      const id = await created('Uncountable');
      ctx.repo.usageFails = true;
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(409);
      const body = problem(res);
      expect(body.code).toBe('ERP-FIXEDEQUIPMENTDEPRECIATIONS-0002');
      expect(body.detail).toBe('its use could not be counted');
      expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.ok);
      expect(ctx.events.count).toBe(0);
    });
  });

  describe('GET export', () => {
    it('csv answers id, name and term, the attachment name, no-store and a BOM', async () => {
      const res = await send('GET', `${EXPORT}?sort=id`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="fixed-equipment-depreciations-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.payload.startsWith(`${CSV_BOM}id,name,term\r\n`)).toBe(true);
      expect(res.payload).toContain('\r\n3,Straight line,60\r\n');
      expect(res.payload).toContain('\r\n4,Legacy,\r\n');
    });

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)(
      'format=%s answers its content type and fixed-equipment-depreciations-<date>.<ext>',
      async (format, type, magic) => {
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.ok);
        expect(res.headers['content-type']).toBe(type);
        expect(res.headers['content-disposition']).toMatch(
          new RegExp(
            `^attachment; filename="fixed-equipment-depreciations-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`,
          ),
        );
        expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      },
    );

    it('format=print answers the three columns as text rows, no attachment', async () => {
      const res = await send('GET', `${EXPORT}?format=print&q=legacy`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name', 'term']);
      expect(body.rows).toEqual([['4', 'Legacy', '']]);
    });

    it('format=print with blank= per column writes "-" in the Term cell of a row with no term; without blank= it is empty', async () => {
      const legacy = await ctx.repo.create({
        name: 'Blankterm legacy',
        term: null as unknown as number,
        creatorId: 1,
      });

      const withBlank = await send(
        'GET',
        `${EXPORT}?format=print&q=Blankterm&blank=&blank=&blank=-`,
        TEST_BEARERS.admin,
      );
      expect(withBlank.statusCode).toBe(HTTP.ok);

      const body = JSON.parse(withBlank.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name', 'term']);
      expect(body.rows).toEqual([[String(legacy.id), 'Blankterm legacy', '-']]);

      const without = await send('GET', `${EXPORT}?format=print&q=Blankterm`, TEST_BEARERS.admin);
      const plain = JSON.parse(without.payload) as { rows: string[][] };
      expect(plain.rows).toEqual([[String(legacy.id), 'Blankterm legacy', '']]);
    });

    it('?column=name exports that one column', async () => {
      const res = await send('GET', `${EXPORT}?format=print&column=name`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['name']);
      expect(body.rows.every((row) => row.length === 1)).toBe(true);
    });

    it.each([
      ['an unknown parameter', '?key=1'],
      ['a page size', '?limit=10'],
      ['a cursor', '?cursor=abc'],
    ])('%s on the export is 400 ERP-VALIDATION-0001', async (_label, query) => {
      const res = await send('GET', `${EXPORT}${query}`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(400);
      expect(problem(res).code).toBe('ERP-VALIDATION-0001');
    });
  });

  it.each(ROUTES.filter((route) => route.method !== 'DELETE'))(
    '$method $url carries x-request-id, minted when absent and echoed when valid',
    async ({ method, url, payload }) => {
      const minted = await send(method, url, TEST_BEARERS.admin, payload);
      expect(minted.headers['x-request-id']).toMatch(UUID);
      const echoed = await ctx.app.inject({
        method,
        url,
        headers: { ...bearer(TEST_BEARERS.admin), 'x-request-id': 'web-trace-1' },
        ...(payload === undefined ? {} : { payload }),
      });
      expect(echoed.headers['x-request-id']).toBe('web-trace-1');
    },
  );

  it('ADR-0030: every route is under /api/v1/ or one of UNPREFIXED_ROUTES', () => {
    expect(ctx.routes.length).toBeGreaterThanOrEqual(6);
    const unprefixed: readonly string[] = UNPREFIXED_ROUTES.map((route) => `/${route}`);
    for (const route of ctx.routes) {
      const url = route.slice(route.indexOf(' ') + 1);
      expect(url.startsWith(`/${API_PREFIX}/`) || unprefixed.includes(url), route).toBe(true);
    }
  });
});
