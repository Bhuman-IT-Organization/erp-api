import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  LEAD_SOURCES_FACADE_MAX_ROWS,
  type LeadSourcesListRequest,
} from '../model/lead-sources.model.js';
import { LeadSourcesRepository } from '../repository/lead-sources.repository.js';
import { NO_LEAD_SOURCE_USAGE } from '../service/lead-sources.transformer.js';

type ClientHolder = ConstructorParameters<typeof LeadSourcesRepository>[0];
interface RawCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface StubOptions {
  readonly columns?: readonly { readonly t: string; readonly c: string }[] | Error;
  readonly raw?: unknown[] | Error;
  readonly rows?: readonly unknown[];
  readonly first?: unknown;
  readonly updated?: unknown;
  readonly deleted?: number;
  readonly total?: number;
  readonly counts?: readonly number[];
}

function stub(options: StubOptions = {}) {
  const rawCalls: RawCall[] = [];
  const calls: { readonly method: string; readonly args: unknown }[] = [];
  const counts = [...(options.counts ?? [])];
  const record =
    <T>(method: string, result: () => T | Promise<T>) =>
    (args: unknown): Promise<T> => {
      calls.push({ method, args });
      try {
        return Promise.resolve(result());
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
  const client = {
    tblleads_sources: {
      findMany: record('findMany', () => options.rows ?? []),
      count: record('count', () => counts.shift() ?? options.total ?? 0),
      findFirst: record('findFirst', () => options.first ?? null),
      create: record('create', () => ({ id: 9, name: 'New' })),
      update: record('update', () => {
        if (options.updated instanceof Error) throw options.updated;
        return options.updated ?? { id: 7, name: 'Renamed' };
      }),
      deleteMany: record('deleteMany', () => ({ count: options.deleted ?? 1 })),
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
      const sql = strings.join('?');
      rawCalls.push({ sql, values });
      if (sql.includes('information_schema.COLUMNS')) {
        const columns = options.columns ?? [
          { t: 'tblleads', c: 'source' },
          { t: 'tblleads_email_integration', c: 'lead_source' },
          { t: 'tblweb_to_lead', c: 'lead_source' },
        ];
        return columns instanceof Error ? Promise.reject(columns) : Promise.resolve(columns);
      }
      return options.raw instanceof Error
        ? Promise.reject(options.raw)
        : Promise.resolve(options.raw ?? []);
    },
  };
  return {
    repository: new LeadSourcesRepository({ client } as unknown as ClientHolder),
    calls,
    rawCalls,
  };
}

function request(overrides: Partial<LeadSourcesListRequest> = {}): LeadSourcesListRequest {
  return { search: null, sortField: 'id', order: 'desc', cursor: null, limit: 25, ...overrides };
}

describe('LeadSourcesRepository', () => {
  it('queries a keyset page and counts matching rows', async () => {
    const { repository, calls } = stub({
      rows: [
        { id: 7, name: 'Seven' },
        { id: 5, name: 'Five' },
      ],
      counts: [2, 0, 2],
    });
    await expect(repository.list(request())).resolves.toMatchObject({
      items: [
        { id: 7, name: 'Seven' },
        { id: 5, name: 'Five' },
      ],
      total: 2,
      rangeStart: 1,
    });
    expect(calls[0]).toMatchObject({
      method: 'findMany',
      args: {
        orderBy: [{ id: 'desc' }, { id: 'desc' }],
        take: 25,
        select: { id: true, name: true },
      },
    });
    expect(await repository.count(request({ search: 'site' }))).toBe(2);
  });

  it('reads and writes the selected fields only, mapping P2025 updates to null', async () => {
    const { repository, calls } = stub({
      first: { id: 7, name: 'Website' },
      updated: { id: 7, name: 'Renamed' },
      deleted: 0,
    });
    await expect(repository.findById(7)).resolves.toEqual({ id: 7, name: 'Website' });
    await expect(repository.create({ name: 'New' })).resolves.toEqual({ id: 9, name: 'New' });
    await expect(repository.update(7, { name: 'Renamed' })).resolves.toEqual({
      id: 7,
      name: 'Renamed',
    });
    await expect(repository.remove(7)).resolves.toBe(false);
    expect(calls.find((call) => call.method === 'create')?.args).toEqual({
      data: { name: 'New' },
      select: { id: true, name: true },
    });
    expect(calls.find((call) => call.method === 'update')?.args).toMatchObject({
      where: { id: 7 },
      data: { name: 'Renamed' },
    });

    const missing = stub({
      updated: Object.assign(new Error('not found'), { code: 'P2025' }),
    });
    await expect(missing.repository.update(404, { name: 'No row' })).resolves.toBeNull();
  });

  it('counts references from all three tables and keeps ids bound as parameters', async () => {
    const { repository, rawCalls } = stub({ raw: [{ id: 7, n: 2n }] });
    const usage = await repository.usageByLeadSource([7, 9]);
    expect(usage.get(7)).toEqual({ leads: 6 });
    expect(usage.get(9)).toEqual(NO_LEAD_SOURCE_USAGE);
    expect(rawCalls).toHaveLength(4);
    expect(rawCalls[0]?.sql).toContain('information_schema.COLUMNS');
    expect(rawCalls[1]?.sql).toContain('FROM tblleads r');
    expect(rawCalls[1]?.sql).toContain('r.source IN (?)');
    expect(rawCalls[1]?.values).toHaveLength(1);
    expect(rawCalls[2]?.sql).toContain('FROM tblleads_email_integration r');
    expect(rawCalls[2]?.sql).toContain('r.lead_source IN (?)');
    expect(rawCalls[3]?.sql).toContain('FROM tblweb_to_lead r');
    expect(rawCalls[3]?.sql).toContain('r.lead_source IN (?)');
  });

  it('returns an empty usage map without querying for no ids', async () => {
    const { repository, rawCalls } = stub();
    await expect(repository.usageByLeadSource([])).resolves.toEqual(new Map());
    expect(rawCalls).toEqual([]);
  });

  it('returns zero usage if the leads reference column is not present', async () => {
    const { repository, rawCalls } = stub({ columns: [] });
    await expect(repository.usageByLeadSource([7])).resolves.toEqual(
      new Map([[7, NO_LEAD_SOURCE_USAGE]]),
    );
    expect(rawCalls).toHaveLength(1);
  });

  it('bounds listAll and sorts by name then id', async () => {
    const { repository, calls } = stub({ rows: [{ id: 1, name: 'A' }] });
    await expect(repository.listAll()).resolves.toEqual([{ id: 1, name: 'A' }]);
    expect(calls[0]).toMatchObject({
      args: {
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: LEAD_SOURCES_FACADE_MAX_ROWS + 1,
      },
    });

    const overLimit = stub({
      rows: Array.from({ length: LEAD_SOURCES_FACADE_MAX_ROWS + 1 }, (_, id) => ({
        id,
        name: `Source ${String(id)}`,
      })),
    });
    await expect(overLimit.repository.listAll()).rejects.toBeInstanceOf(AppError);
  });

  it('findByIds returns rows matching the supplied id set', async () => {
    const { repository, calls } = stub({ rows: [{ id: 2, name: 'Referral' }] });
    await expect(repository.findByIds([2, 4])).resolves.toEqual([{ id: 2, name: 'Referral' }]);
    expect(calls[0]).toMatchObject({ args: { where: { id: { in: [2, 4] } } } });
    await expect(repository.findByIds([])).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
