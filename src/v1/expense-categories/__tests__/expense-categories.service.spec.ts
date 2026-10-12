/**
 * ExpenseCategoriesService over the real layers and the seeded in-memory fake: administrators only
 * (every use case asserts the flag first, so a refused caller reaches no repository method), the
 * list envelope with each row's usage counts, the one not-found answer, the writes (the description
 * stored in Perfex's `nl2br` form and answered in its read form), the delete with its in-use 409
 * (D-07, D-15), exactly one event and one `log` line per change and none on a refusal (D-08, D-18),
 * and the CSV export (count first and refuse over `EXPORT_MAX_ROWS` before any row is read; otherwise
 * BOM + header + one CRLF line per row in list order, every cell and label through the formula
 * escape).
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CSV_BOM, EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportFile } from '../../../shared/http/export.js';
import {
  ExpenseCategoriesCreatedV1,
  ExpenseCategoriesDeletedV1,
  ExpenseCategoriesUpdatedV1,
} from '../events/published.js';
import { ExpenseCategoriesService } from '../service/expense-categories.service.js';
import { ExpenseCategoriesTransformer } from '../service/expense-categories.transformer.js';
import { ExpenseCategoriesTransport } from '../service/expense-categories.transport.js';
import { ExpenseCategoriesValidator } from '../service/expense-categories.validator.js';
import { RecordingLogger } from './create-expense-categories-test-app.js';
import { asRepository, seededStore, type InMemoryExpenseCategoriesRepository } from './fakes.js';

const NOW = Date.parse('2026-09-26T08:30:00.000Z');
const AT = '2026-09-26T08:30:00.000Z';

function actor(isAdmin: boolean): AuthenticatedUser {
  return {
    staffId: isAdmin ? 1 : 2,
    sessionId: 'sid',
    jti: 'jti',
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: NOW / 1000 + 3600,
  };
}

const ADMIN = actor(true);
const MEMBER = actor(false);

async function build() {
  const repository = await seededStore();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();
  const service = new ExpenseCategoriesService(
    new ExpenseCategoriesValidator(),
    asRepository(repository),
    new ExpenseCategoriesTransformer(),
    new ExpenseCategoriesTransport(events),
    logger,
  );
  service.now = () => NOW;
  return { service, repository, events, logger };
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

/** A CSV export's body: the text the core wrote (Excel and PDF bytes or print rows are not CSV). */
function csvText(body: ExportFile['body']): string {
  if (typeof body !== 'string') throw new Error('the export answered no CSV text');
  return body;
}

/** Spies on every repository method, so a refusal can prove none was reached. */
function spyAll(repository: InMemoryExpenseCategoriesRepository) {
  return [
    vi.spyOn(repository, 'list'),
    vi.spyOn(repository, 'count'),
    vi.spyOn(repository, 'findById'),
    vi.spyOn(repository, 'create'),
    vi.spyOn(repository, 'update'),
    vi.spyOn(repository, 'remove'),
    vi.spyOn(repository, 'usageByCategory'),
  ];
}

describe('ExpenseCategoriesService: administrators only (D-06, BE-25)', () => {
  it.each([
    ['list', (s: ExpenseCategoriesService) => s.list(MEMBER, {})],
    ['exportCsv', (s: ExpenseCategoriesService) => s.exportCsv(MEMBER, {})],
    ['get', (s: ExpenseCategoriesService) => s.get(MEMBER, { id: '1' })],
    ['create', (s: ExpenseCategoriesService) => s.create(MEMBER, { name: 'X' })],
    ['update', (s: ExpenseCategoriesService) => s.update(MEMBER, { id: '1' }, { name: 'X' })],
    ['remove', (s: ExpenseCategoriesService) => s.remove(MEMBER, { id: '1' })],
  ] as const)(
    '%s refuses a non-administrator with 403 ERP-AUTH-0005 before any repository call, and publishes and logs nothing',
    async (_name, call) => {
      const { service, repository, events, logger } = await build();
      const spies = spyAll(repository);
      const error = await rejection(call(service));
      expect([error.code, error.status]).toEqual(['ERP-AUTH-0005', 403]);
      expect(error.message).toBe('expense categories are managed by administrators only');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(events.count).toBe(0);
      expect(logger.lines).toEqual([]);
    },
  );

  it('the refusal comes before validation: a non-administrator with a bad query still gets 403', async () => {
    const { service } = await build();
    expect((await rejection(service.list(MEMBER, { sort: 'nope' }))).code).toBe('ERP-AUTH-0005');
  });
});

describe('ExpenseCategoriesService: reads', () => {
  it('describe() names the module and its version', async () => {
    expect((await build()).service.describe()).toEqual({
      module: 'expense-categories',
      version: 1,
    });
  });

  it('list answers the envelope on the superset meta, sorted by name, with the usage counts read once for the page', async () => {
    const { service, repository } = await build();
    repository.usage.set(2, { expenses: 3, accountingMappings: 1, pettyCashAdvances: 0 });
    const usage = vi.spyOn(repository, 'usageByCategory');
    const page = await service.list(ADMIN, { limit: '2' });
    expect(page.data).toEqual([
      {
        id: '1',
        name: 'First',
        description: '',
        expenseCount: 0,
        mappingCount: 0,
        pettyCashCount: 0,
      },
      {
        id: '2',
        name: 'Second',
        description: 'Line one\nline two',
        expenseCount: 3,
        mappingCount: 1,
        pettyCashCount: 0,
      },
    ]);
    expect(page.meta).toMatchObject({ total: 3, rangeStart: 1, prevCursor: null });
    expect(page.meta.exportLimit).toBe(EXPORT_MAX_ROWS);
    expect(page.meta.nextCursor).toEqual(expect.any(String));
    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledWith([1, 2]);
  });

  it('a bad query stops at the validator: nothing is read', async () => {
    const { service, repository } = await build();
    const list = vi.spyOn(repository, 'list');
    expect((await rejection(service.list(ADMIN, { sort: 'description' }))).code).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('get answers the DTO with the description in its read form', async () => {
    const { service } = await build();
    expect(await service.get(ADMIN, { id: '2' })).toEqual({
      id: '2',
      name: 'Second',
      description: 'Line one\nline two',
    });
  });

  it('a missing id is ERP-CORE-0004; the facade read answers null', async () => {
    const { service } = await build();
    const missing = await rejection(service.get(ADMIN, { id: '404' }));
    expect([missing.code, missing.status]).toEqual(['ERP-CORE-0004', 404]);
    expect(await service.findById(404)).toBeNull();
    expect(await service.findById(1)).toEqual({ id: 1, name: 'First', description: '' });
  });
});

describe('ExpenseCategoriesService: create and update (one event, then one log line)', () => {
  it('create stores the description in its nl2br form, answers the read form, publishes ExpenseCategoriesCreatedV1 once and logs once', async () => {
    const { service, repository, events, logger } = await build();
    const dto = await service.create(ADMIN, { name: '  Fourth ', description: 'Taxi\nTrain' });
    expect(dto).toEqual({ id: '4', name: 'Fourth', description: 'Taxi\nTrain' });
    expect(await repository.findById(4)).toEqual({
      id: 4,
      name: 'Fourth',
      description: 'Taxi<br />\nTrain',
    });
    const published = events.drain();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(ExpenseCategoriesCreatedV1);
    expect(published[0]?.payload).toEqual({ id: 4, at: AT });
    expect(logger.lines).toEqual([{ message: 'expense category created', meta: { id: 4 } }]);
  });

  it('the event comes after the write and the log line after the event', async () => {
    const { service, repository, events, logger } = await build();
    const order: string[] = [];
    vi.spyOn(repository, 'create').mockImplementation((input) => {
      order.push('write');
      return Promise.resolve({ id: 9, ...input });
    });
    vi.spyOn(events, 'publish').mockImplementation(() => {
      order.push('publish');
      return Promise.resolve();
    });
    vi.spyOn(logger, 'log').mockImplementation(() => {
      order.push('log');
    });
    await service.create(ADMIN, { name: 'Ordered' });
    expect(order).toEqual(['write', 'publish', 'log']);
  });

  it('create without a description stores the empty string', async () => {
    const { service, repository } = await build();
    await service.create(ADMIN, { name: 'Bare' });
    expect((await repository.findById(4))?.description).toBe('');
  });

  it('a refused body stores nothing, publishes nothing and logs nothing', async () => {
    const { service, repository, events, logger } = await build();
    const create = vi.spyOn(repository, 'create');
    expect((await rejection(service.create(ADMIN, { name: 'X', id: 9 }))).code).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(create).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('update changes the name only when only the name is sent, publishes ExpenseCategoriesUpdatedV1 once and logs once', async () => {
    const { service, repository, events, logger } = await build();
    const dto = await service.update(ADMIN, { id: '2' }, { name: 'Renamed' });
    expect(dto).toEqual({ id: '2', name: 'Renamed', description: 'Line one\nline two' });
    expect((await repository.findById(2))?.description).toBe('Line one<br />\nline two');
    const published = events.drain();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(ExpenseCategoriesUpdatedV1);
    expect(published[0]?.payload).toEqual({ id: 2, at: AT });
    expect(logger.lines).toEqual([{ message: 'expense category updated', meta: { id: 2 } }]);
  });

  it('update stores a new description in its nl2br form', async () => {
    const { service, repository } = await build();
    await service.update(ADMIN, { id: '1' }, { description: 'a\r\nb' });
    expect(await repository.findById(1)).toEqual({
      id: 1,
      name: 'First',
      description: 'a<br />\r\nb',
    });
  });

  it('update of a missing id is ERP-CORE-0004: nothing published, nothing logged', async () => {
    const { service, events, logger } = await build();
    expect((await rejection(service.update(ADMIN, { id: '404' }, { name: 'Nobody' }))).code).toBe(
      'ERP-CORE-0004',
    );
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });
});

describe('ExpenseCategoriesService: remove (D-07, D-15)', () => {
  it('deletes an unused row, publishes ExpenseCategoriesDeletedV1 { id, at } once and logs once', async () => {
    const { service, repository, events, logger } = await build();
    const usage = vi.spyOn(repository, 'usageByCategory');
    await expect(service.remove(ADMIN, { id: '3' })).resolves.toBeUndefined();
    expect(usage).toHaveBeenCalledWith([3]);
    expect(await repository.findById(3)).toBeNull();
    const published = events.drain();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(ExpenseCategoriesDeletedV1);
    expect(published[0]?.payload).toEqual({ id: 3, at: AT });
    expect(logger.lines).toEqual([{ message: 'expense category deleted', meta: { id: 3 } }]);
  });

  it('a missing id is ERP-CORE-0004 and no usage is read', async () => {
    const { service, repository, events, logger } = await build();
    const usage = vi.spyOn(repository, 'usageByCategory');
    const error = await rejection(service.remove(ADMIN, { id: '404' }));
    expect([error.code, error.status]).toEqual(['ERP-CORE-0004', 404]);
    expect(usage).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it.each([
    [{ expenses: 2, accountingMappings: 0, pettyCashAdvances: 0 }, 2, 0, 0],
    [{ expenses: 0, accountingMappings: 1, pettyCashAdvances: 0 }, 0, 1, 0],
    [{ expenses: 0, accountingMappings: 0, pettyCashAdvances: 5 }, 0, 0, 5],
    [{ expenses: 1, accountingMappings: 1, pettyCashAdvances: 1 }, 1, 1, 1],
  ])(
    'a row in use (%o) is 409 ERP-EXPENSECATEGORIES-0001 naming the three counts; nothing deleted, published or logged',
    async (usage, e, m, p) => {
      const { service, repository, events, logger } = await build();
      repository.usage.set(2, usage);
      const remove = vi.spyOn(repository, 'remove');
      const error = await rejection(service.remove(ADMIN, { id: '2' }));
      expect([error.code, error.status]).toEqual(['ERP-EXPENSECATEGORIES-0001', 409]);
      expect(error.message).toBe(
        `used by ${String(e)} expense(s), ${String(m)} accounting mapping(s) and ${String(p)} petty cash advance(s)`,
      );
      expect(remove).not.toHaveBeenCalled();
      expect(await repository.findById(2)).not.toBeNull();
      expect(events.count).toBe(0);
      expect(logger.lines).toEqual([]);
    },
  );

  it('a usage answer without the id fails closed: 409, nothing deleted (D-15)', async () => {
    const { service, repository, events } = await build();
    vi.spyOn(repository, 'usageByCategory').mockResolvedValue(new Map());
    const remove = vi.spyOn(repository, 'remove');
    const error = await rejection(service.remove(ADMIN, { id: '2' }));
    expect(error.code).toBe('ERP-EXPENSECATEGORIES-0001');
    expect(error.message).toBe('its use could not be counted');
    expect(remove).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
  });

  it('a row gone between the read and the delete is ERP-CORE-0004: nothing published or logged', async () => {
    const { service, repository, events, logger } = await build();
    vi.spyOn(repository, 'remove').mockResolvedValue(false);
    expect((await rejection(service.remove(ADMIN, { id: '1' }))).code).toBe('ERP-CORE-0004');
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('a non-numeric id is a 400 before any read', async () => {
    const { service, repository } = await build();
    const find = vi.spyOn(repository, 'findById');
    expect((await rejection(service.remove(ADMIN, { id: 'abc' }))).code).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(find).not.toHaveBeenCalled();
  });
});

describe('ExpenseCategoriesService: the CSV export (D-26, D-42)', () => {
  it('counts first; over EXPORT_MAX_ROWS it refuses on the export path with the limit and the total, and reads no row', async () => {
    const { service, repository } = await build();
    vi.spyOn(repository, 'count').mockResolvedValue(EXPORT_MAX_ROWS + 1);
    const list = vi.spyOn(repository, 'list');
    const error = await rejection(service.exportCsv(ADMIN, {}));
    expect(error.code).toBe('ERP-VALIDATION-0001');
    expect(error.extras?.issues).toEqual([
      {
        path: ['export'],
        message: 'too many rows to export',
        params: { limit: EXPORT_MAX_ROWS, total: EXPORT_MAX_ROWS + 1 },
      },
    ]);
    expect(list).not.toHaveBeenCalled();
  });

  it('exactly EXPORT_MAX_ROWS still exports', async () => {
    const { service, repository } = await build();
    vi.spyOn(repository, 'count').mockResolvedValue(EXPORT_MAX_ROWS);
    await expect(service.exportCsv(ADMIN, {})).resolves.toMatchObject({
      filename: 'expense-categories-2026-09-26.csv',
    });
  });

  it('answers BOM + the header row + one CRLF line per row in the list order; the description in its read form; no count is read', async () => {
    const { service, repository } = await build();
    const usage = vi.spyOn(repository, 'usageByCategory');
    const file = await service.exportCsv(ADMIN, { sort: '-name' });
    expect(file.filename).toBe('expense-categories-2026-09-26.csv');
    expect(file.body).toBe(
      `${CSV_BOM}id,name,description\r\n` +
        '3,Third,Fuel only\r\n' +
        '2,Second,"Line one\nline two"\r\n' +
        '1,First,\r\n',
    );
    expect(file.body).not.toContain('<br');
    expect(usage).not.toHaveBeenCalled();
  });

  it('pages through every batch with the list read', async () => {
    const { service, repository } = await build();
    const list = vi.spyOn(repository, 'list');
    const file = await service.exportCsv(ADMIN, { q: 'second' });
    expect(file.body).toContain('2,Second');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("a ' goes before a leading = + - @ in a cell AND in a translated header label (T-3.2-89)", async () => {
    const { service } = await build();
    await service.create(ADMIN, { name: '=HYPERLINK("http://x","y")', description: '@SUM(1)' });
    const file = await service.exportCsv(ADMIN, {
      q: 'hyperlink',
      header: ['@SUM(1)', 'Name', '+Description'],
    });
    const [header, row] = csvText(file.body).slice(CSV_BOM.length).split('\r\n');
    expect(header).toBe("'@SUM(1),Name,'+Description");
    expect(row).toBe(`4,"'=HYPERLINK(""http://x"",""y"")",'@SUM(1)`);
  });
});

describe('ExpenseCategoriesService: every format through the shared core (04.1.1-02)', () => {
  it.each(['csv', 'xlsx', 'pdf', 'print', 'docx'])(
    'format=%s from a non-administrator is 403 ERP-AUTH-0005 before any parse or count',
    async (format) => {
      const { service, repository } = await build();
      const count = vi.spyOn(repository, 'count');
      const error = await rejection(service.exportCsv(MEMBER, { format }));
      expect(error.code).toBe('ERP-AUTH-0005');
      expect(count).not.toHaveBeenCalled();
    },
  );

  it('a key is refused on its path before the count (D-27)', async () => {
    const { service, repository } = await build();
    const count = vi.spyOn(repository, 'count');
    const error = await rejection(service.exportCsv(ADMIN, { key: '3' }));
    expect(error.extras?.issues).toEqual([expect.objectContaining({ path: ['key'] })]);
    expect(count).not.toHaveBeenCalled();
  });

  it('over PRINT_MAX_ROWS a pdf is refused with the PDF cap, and no row is read (D-06)', async () => {
    const { service, repository } = await build();
    vi.spyOn(repository, 'count').mockResolvedValue(PRINT_MAX_ROWS + 1);
    const list = vi.spyOn(repository, 'list');
    const error = await rejection(service.exportCsv(ADMIN, { format: 'pdf' }));
    expect(error.extras?.issues).toEqual([
      expect.objectContaining({ params: { limit: PRINT_MAX_ROWS, total: PRINT_MAX_ROWS + 1 } }),
    ]);
    expect(list).not.toHaveBeenCalled();
  });

  it('names the Excel file expense-categories-<date>.xlsx', async () => {
    const { service } = await build();
    const file = await service.exportCsv(ADMIN, { format: 'xlsx' });
    expect(file.filename).toBe('expense-categories-2026-09-26.xlsx');
    expect(Buffer.isBuffer(file.body)).toBe(true);
  });

  it('answers print rows in the list order, the description in its read form, with the api clock', async () => {
    const { service } = await build();
    const file = await service.exportCsv(ADMIN, { format: 'print', sort: '-name' });
    expect(file.filename).toBeNull();
    expect(file.body).toEqual({
      exportedAt: AT,
      headers: ['id', 'name', 'description'],
      rows: [
        ['3', 'Third', 'Fuel only'],
        ['2', 'Second', 'Line one\nline two'],
        ['1', 'First', ''],
      ],
    });
  });
});
