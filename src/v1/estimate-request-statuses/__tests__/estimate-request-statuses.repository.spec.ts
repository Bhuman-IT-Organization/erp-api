import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor, encodeCursor } from '../../../shared/http/keyset.js';
import {
  ESTIMATE_REQUEST_STATUSES_FACADE_MAX_ROWS,
  type EstimateRequestStatusesListRequest,
} from '../model/estimate-request-statuses.model.js';
import { EstimateRequestStatusesRepository } from '../repository/estimate-request-statuses.repository.js';

type ClientHolder = ConstructorParameters<typeof EstimateRequestStatusesRepository>[0];

const COLUMNS = { id: true, name: true, color: true, statusorder: true, flag: true };
const RAW_ROW = { id: 2, name: 'Ready', color: '#757575', statusorder: 2, flag: null };
const ROW = { ...RAW_ROW, total_request: 0 };

function request(
  overrides: Partial<EstimateRequestStatusesListRequest> = {},
): EstimateRequestStatusesListRequest {
  return { search: null, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

function stub(
  options: {
    readonly rows?: readonly unknown[];
    readonly grouped?: readonly unknown[];
    readonly counts?: readonly number[];
    readonly first?: unknown;
    readonly created?: unknown;
    readonly updated?: unknown;
    readonly updateError?: Error;
    readonly deleted?: number;
    readonly rawAnswers?: readonly unknown[];
  } = {},
) {
  const rawAnswers = [...(options.rawAnswers ?? [])];
  const counts = [...(options.counts ?? [])];
  const findMany = vi.fn().mockResolvedValue(options.rows ?? []);
  const groupBy = vi.fn().mockResolvedValue(options.grouped ?? []);
  const count = vi.fn().mockImplementation(() => Promise.resolve(counts.shift() ?? 0));
  const findFirst = vi.fn().mockResolvedValue(options.first ?? null);
  const create = vi.fn().mockResolvedValue(options.created ?? RAW_ROW);
  const update = options.updateError
    ? vi.fn().mockRejectedValue(options.updateError)
    : vi.fn().mockResolvedValue(options.updated ?? RAW_ROW);
  const deleteMany = vi.fn().mockResolvedValue({ count: options.deleted ?? 1 });
  const $queryRaw = vi.fn().mockImplementation(() => Promise.resolve(rawAnswers.shift() ?? []));
  const client = {
    tblestimate_request_status: { findMany, count, findFirst, create, update, deleteMany },
    tblestimate_requests: { groupBy, count: vi.fn().mockResolvedValue(0) },
    $queryRaw,
  };
  const repository = new EstimateRequestStatusesRepository({ client } as unknown as ClientHolder);
  return {
    repository,
    client,
    findMany,
    groupBy,
    count,
    findFirst,
    create,
    update,
    deleteMany,
    $queryRaw,
  };
}

describe('EstimateRequestStatusesRepository', () => {
  it('lists rows with request totals and the default name-ascending page metadata', async () => {
    const { repository, findMany, groupBy, count } = stub({
      rows: [RAW_ROW],
      grouped: [{ status: 2, _count: { _all: 4 } }],
      counts: [3, 0],
    });
    await expect(repository.list(request())).resolves.toMatchObject({
      items: [{ ...ROW, total_request: 4 }],
      total: 3,
      rangeStart: 1,
      prevCursor: null,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 25,
      select: COLUMNS,
    });
    expect(groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { status: { in: [2] } },
      _count: { _all: true },
    });
    expect(count).toHaveBeenCalledTimes(2);
  });

  it('pages forward and backward using the sort-bound cursor and returns rows in requested order', async () => {
    const forwardCursor = decodeCursor(encodeCursor('id', [2, 2], 'after'), 'id');
    const forward = stub({
      rows: [{ ...RAW_ROW, id: 3, name: 'Third' }],
      counts: [5, 2],
    });
    const page = await forward.repository.list(
      request({ sortField: 'id', cursor: forwardCursor, limit: 1 }),
    );
    expect(page.items.map(({ id }) => id)).toEqual([3]);
    expect(page.rangeStart).toBe(3);
    expect(forward.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ id: 'asc' }, { id: 'asc' }], take: 1 }),
    );

    const backwardCursor = decodeCursor(encodeCursor('id', [4, 4], 'before'), 'id');
    const backward = stub({
      rows: [
        { ...RAW_ROW, id: 2, name: 'Second' },
        { ...RAW_ROW, id: 1, name: 'First' },
      ],
      counts: [5, 1],
    });
    const previous = await backward.repository.list(
      request({ sortField: 'id', order: 'asc', cursor: backwardCursor, limit: 2 }),
    );
    expect(backward.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ id: 'desc' }, { id: 'desc' }], take: 2 }),
    );
    expect(previous.items.map(({ id }) => id)).toEqual([1, 2]);
    expect(previous.prevCursor).not.toBeNull();
  });

  it('counts by search, matches name and an in-range numeric id', async () => {
    const { repository, count } = stub();
    await repository.count(request({ search: '2' }));
    expect(count).toHaveBeenCalledWith({
      where: { OR: [{ name: { contains: '2' } }, { id: 2 }] },
    });
  });

  it('finds a row and returns null when absent', async () => {
    const found = stub({ first: RAW_ROW });
    await expect(found.repository.findById(2)).resolves.toEqual(ROW);
    expect(found.findFirst).toHaveBeenCalledWith({ where: { id: 2 }, select: COLUMNS });
    await expect(stub().repository.findById(404)).resolves.toBeNull();
  });

  it('creates with the supplied status fields and maps the stored row', async () => {
    const { repository, create } = stub();
    await expect(
      repository.create({ name: 'Ready', color: '#757575', statusorder: 2 }),
    ).resolves.toEqual(ROW);
    expect(create).toHaveBeenCalledWith({
      data: { name: 'Ready', color: '#757575', statusorder: 2 },
      select: COLUMNS,
    });
  });

  it('updates and preserves non-P2025 database errors', async () => {
    const updated = stub({ updated: { ...RAW_ROW, name: 'Available' } });
    await expect(updated.repository.update(2, { name: 'Available' })).resolves.toMatchObject({
      id: 2,
      name: 'Available',
    });
    expect(updated.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { name: 'Available' },
      select: COLUMNS,
    });
    const missing = stub({ updateError: Object.assign(new Error('missing'), { code: 'P2025' }) });
    await expect(missing.repository.update(404, { name: 'Missing' })).resolves.toBeNull();
    await expect(
      stub({
        updateError: Object.assign(new Error('deadlock'), { code: 'P2034' }),
      }).repository.update(2, { name: 'Ready' }),
    ).rejects.toThrow('deadlock');
  });

  it('removes only the requested id and answers false when nothing was deleted', async () => {
    const removed = stub({ deleted: 1 });
    await expect(removed.repository.remove(2)).resolves.toBe(true);
    expect(removed.deleteMany).toHaveBeenCalledWith({ where: { id: 2 } });
    await expect(stub({ deleted: 0 }).repository.remove(404)).resolves.toBe(false);
  });

  it('discovers and counts both status reference columns using information_schema', async () => {
    const { repository, $queryRaw } = stub({
      rawAnswers: [
        [
          { t: 'tblestimate_requests', c: 'status' },
          { t: 'tblestimate_request_forms', c: 'status' },
        ],
        [{ n: 1n }],
        [{ n: 2n }],
      ],
    });
    await expect(repository.deleteReferenceCount(12)).resolves.toEqual({
      requestCount: 1,
      formCount: 2,
    });
    expect($queryRaw).toHaveBeenCalledTimes(3);
    expect(String($queryRaw.mock.calls[0]?.[0])).toContain('information_schema.COLUMNS');
  });

  it('skips reference columns not present in the current schema', async () => {
    const { repository, $queryRaw } = stub({ rawAnswers: [[]] });
    await expect(repository.deleteReferenceCount(12)).resolves.toEqual({
      requestCount: 0,
      formCount: 0,
    });
    expect($queryRaw).toHaveBeenCalledOnce();
  });

  it('listAll accepts 1000 rows, reads at most 1001, and refuses rather than truncating', async () => {
    const small = stub({ rows: [RAW_ROW] });
    await expect(small.repository.listAll()).resolves.toEqual([ROW]);
    expect(small.findMany).toHaveBeenCalledWith({
      orderBy: [{ statusorder: 'asc' }, { id: 'asc' }],
      take: ESTIMATE_REQUEST_STATUSES_FACADE_MAX_ROWS + 1,
      select: COLUMNS,
    });
    const exactlyAtLimit = Array.from(
      { length: ESTIMATE_REQUEST_STATUSES_FACADE_MAX_ROWS },
      (_, index) => ({ ...RAW_ROW, id: index + 1, name: `Status ${String(index)}` }),
    );
    await expect(stub({ rows: exactlyAtLimit }).repository.listAll()).resolves.toHaveLength(
      ESTIMATE_REQUEST_STATUSES_FACADE_MAX_ROWS,
    );
    const many = Array.from(
      { length: ESTIMATE_REQUEST_STATUSES_FACADE_MAX_ROWS + 1 },
      (_, index) => ({
        ...RAW_ROW,
        id: index + 1,
        name: `Status ${String(index)}`,
      }),
    );
    await expect(stub({ rows: many }).repository.listAll()).rejects.toMatchObject({
      code: 'ERP-INTERNAL-0001',
    } satisfies Partial<AppError>);
  });
});
