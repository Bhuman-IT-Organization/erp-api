/**
 * ExampleItemService over the real layers and the seeded in-memory store: the list envelope, the
 * one not-found answer (a missing row and another member's row under `own` are the same
 * `ERP-CORE-0004`, so an id reveals nothing), the writes (the actor is the owner, the clock is the
 * time, one event each), and the CSV export (count first and refuse over `EXPORT_MAX_ROWS` before
 * any row is read; otherwise BOM + header + one CRLF line per row in list order, every cell and
 * every header label through the formula escape).
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CSV_BOM, EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportFile } from '../../../shared/http/export.js';
import { ExampleItemCreatedV1, ExampleItemUpdatedV1 } from '../events/published.js';
import { ExampleItemRepository } from '../repository/example-item.repository.js';
import { ExampleItemEnricher } from '../service/example-item.enricher.js';
import { ExampleItemService } from '../service/example-item.service.js';
import { ExampleItemTransformer } from '../service/example-item.transformer.js';
import { ExampleItemTransport } from '../service/example-item.transport.js';
import { ExampleItemValidator } from '../service/example-item.validator.js';
import { seedRepository } from './fakes.js';

/** Holds `view`, so the guard resolved `all`. */
const VIEWER = 1;
/** Holds `viewOwn` only, and owns id 2. */
const OWN_VIEWER = 3;
const WRITER = 4;
const NOW = Date.parse('2026-09-26T08:30:00.000Z');

function actor(staffId: number): AuthenticatedUser {
  return {
    staffId,
    sessionId: 'sid',
    jti: 'jti',
    isAdmin: false,
    roleId: null,
    tokenVersion: 0,
    expiresAt: NOW / 1000 + 3600,
  };
}

async function build() {
  const repository = new ExampleItemRepository();
  await seedRepository(repository);
  const events = new RecordingDomainEventPublisher();
  const service = new ExampleItemService(
    new ExampleItemValidator(),
    repository,
    new ExampleItemEnricher(),
    new ExampleItemTransformer(),
    new ExampleItemTransport(events),
  );
  service.now = () => NOW;
  return { service, repository, events };
}

/** A CSV export's body: the text the core wrote (Excel and PDF bytes or print rows are not CSV). */
function csvText(body: ExportFile['body']): string {
  if (typeof body !== 'string') throw new Error('the export answered no CSV text');
  return body;
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

describe('ExampleItemService — reads', () => {
  it('describe() names the module and its version', async () => {
    expect((await build()).service.describe()).toEqual({ module: 'example-item', version: 1 });
  });

  it('list answers the envelope on the superset meta, narrowed by the scope', async () => {
    const { service } = await build();
    const all = await service.list({ limit: '2' }, 'all', VIEWER);
    expect(all.data.map((item) => item.id)).toEqual(['1', '2']);
    expect(all.meta).toMatchObject({ total: 3, rangeStart: 1, prevCursor: null });
    expect(all.meta.exportLimit).toBe(EXPORT_MAX_ROWS);
    expect(all.meta.nextCursor).toEqual(expect.any(String));
    const own = await service.list({}, 'own', OWN_VIEWER);
    expect(own.data.map((item) => item.id)).toEqual(['2']);
  });

  it('a bad query stops at the validator: nothing is read', async () => {
    const { service, repository } = await build();
    const list = vi.spyOn(repository, 'list');
    expect((await rejection(service.list({ sort: 'label' }, 'all', VIEWER))).code).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('get answers the DTO without the internal fields', async () => {
    const { service } = await build();
    expect(await service.get({ id: '2' }, 'all', VIEWER)).toEqual({
      id: '2',
      name: 'Second',
      label: 'Second (2)',
      createdAt: '2026-01-02T00:00:00.000Z',
    });
  });

  it("a missing id and another member's row under own are the SAME ERP-CORE-0004", async () => {
    const { service } = await build();
    const missing = await rejection(service.get({ id: '404' }, 'all', VIEWER));
    const foreign = await rejection(service.get({ id: '1' }, 'own', OWN_VIEWER));
    expect(missing.code).toBe('ERP-CORE-0004');
    expect(missing.status).toBe(404);
    expect([foreign.code, foreign.status, foreign.message]).toEqual([
      missing.code,
      missing.status,
      missing.message,
    ]);
  });
});

describe('ExampleItemService — writes', () => {
  it('create stores the actor as owner and the clock as the time, answers the DTO and publishes ExampleItemCreatedV1 once', async () => {
    const { service, repository, events } = await build();
    const dto = await service.create(actor(WRITER), { name: '  Fourth ' });
    expect(dto).toEqual({
      id: '4',
      name: 'Fourth',
      label: 'Fourth (4)',
      createdAt: '2026-09-26T08:30:00.000Z',
    });
    const stored = await repository.findById(4, 'all', WRITER);
    expect(stored?.ownerStaffId).toBe(WRITER);
    expect(stored?.internalRef).toEqual(expect.any(String));
    const published = events.drain();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(ExampleItemCreatedV1);
    expect(published[0]?.payload).toEqual({ id: 4, at: '2026-09-26T08:30:00.000Z' });
  });

  it('a refused body stores nothing and publishes nothing', async () => {
    const { service, repository, events } = await build();
    const create = vi.spyOn(repository, 'create');
    expect(
      (await rejection(service.create(actor(WRITER), { name: 'X', ownerStaffId: 9 }))).code,
    ).toBe('ERP-VALIDATION-0001');
    expect(create).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
  });

  it('update changes the name, answers the DTO and publishes ExampleItemUpdatedV1', async () => {
    const { service, events } = await build();
    const dto = await service.update({ id: '1' }, { name: 'Renamed' });
    expect(dto).toMatchObject({ id: '1', name: 'Renamed', label: 'Renamed (1)' });
    const published = events.drain();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(ExampleItemUpdatedV1);
    expect(published[0]?.payload).toEqual({ id: 1, at: '2026-09-26T08:30:00.000Z' });
  });

  it('update of a missing id is ERP-CORE-0004 and publishes nothing', async () => {
    const { service, events } = await build();
    expect((await rejection(service.update({ id: '404' }, { name: 'Nobody' }))).code).toBe(
      'ERP-CORE-0004',
    );
    expect(events.count).toBe(0);
  });
});

describe('ExampleItemService — the CSV export (D-26, D-42)', () => {
  it('counts first; over EXPORT_MAX_ROWS it refuses on the export path with the limit and the total, and reads no row', async () => {
    const { service, repository } = await build();
    vi.spyOn(repository, 'count').mockResolvedValue(EXPORT_MAX_ROWS + 1);
    const list = vi.spyOn(repository, 'list');
    const error = await rejection(service.exportCsv({}, 'all', VIEWER));
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
    await expect(service.exportCsv({}, 'all', VIEWER)).resolves.toMatchObject({
      filename: 'example-item-2026-09-26.csv',
    });
  });

  it('answers BOM + the header row + one CRLF line per row, in the list order, the cells the DTO fields', async () => {
    const { service } = await build();
    const file = await service.exportCsv({ sort: '-name' }, 'all', VIEWER);
    expect(file.filename).toBe('example-item-2026-09-26.csv');
    expect(file.body).toBe(
      `${CSV_BOM}id,name,label,createdAt\r\n` +
        '3,Third,Third (3),2026-01-03T00:00:00.000Z\r\n' +
        '2,Second,Second (2),2026-01-02T00:00:00.000Z\r\n' +
        '1,First,First (1),2026-01-01T00:00:00.000Z\r\n',
    );
    expect(file.body).not.toContain('ref-');
  });

  it('honours the row scope and pages through every batch', async () => {
    const { service, repository } = await build();
    const list = vi.spyOn(repository, 'list');
    const file = await service.exportCsv({}, 'own', OWN_VIEWER);
    expect(
      csvText(file.body)
        .split('\r\n')
        .filter((line) => line !== ''),
    ).toHaveLength(2);
    expect(file.body).toContain('2,Second');
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("a ' goes before a leading = + - @ in a cell AND in a translated header label (T-3.2-89)", async () => {
    const { service } = await build();
    await service.create(actor(WRITER), { name: '=HYPERLINK("http://x","y")' });
    const file = await service.exportCsv(
      { q: 'hyperlink', header: ['@SUM(1)', 'Name', '+Label', '-Created'] },
      'all',
      VIEWER,
    );
    const [header, row] = csvText(file.body).slice(CSV_BOM.length).split('\r\n');
    expect(header).toBe("'@SUM(1),Name,'+Label,'-Created");
    expect(row).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
  });
});

describe('ExampleItemService: every format and the ticked keys (04.1.1-02)', () => {
  it('passes the ticked keys as ids to count and list, AND-ed with the search and the scope (D-03, D-27)', async () => {
    const { service, repository } = await build();
    const count = vi.spyOn(repository, 'count');
    const list = vi.spyOn(repository, 'list');
    const file = await service.exportCsv({ key: ['1', '2', '3'], q: 'ir' }, 'all', VIEWER);
    expect(count.mock.calls[0]?.[0]).toMatchObject({ ids: [1, 2, 3], search: 'ir' });
    expect(list.mock.calls[0]?.[0]).toMatchObject({ ids: [1, 2, 3], search: 'ir' });
    expect(csvText(file.body).split('\r\n').slice(1, -1)).toEqual([
      '1,First,First (1),2026-01-01T00:00:00.000Z',
      '3,Third,Third (3),2026-01-03T00:00:00.000Z',
    ]);
  });

  it("a key outside the member's scope exports nothing", async () => {
    const { service } = await build();
    const file = await service.exportCsv({ key: ['1', '3'] }, 'own', OWN_VIEWER);
    expect(csvText(file.body)).toBe(`${CSV_BOM}id,name,label,createdAt\r\n`);
  });

  it('with no key the request carries no ids, so nothing is narrowed', async () => {
    const { service, repository } = await build();
    const count = vi.spyOn(repository, 'count');
    await service.exportCsv({}, 'all', VIEWER);
    expect(count.mock.calls[0]?.[0]).not.toHaveProperty('ids');
  });

  it.each([
    ['pdf', PRINT_MAX_ROWS],
    ['print', PRINT_MAX_ROWS],
    ['xlsx', EXPORT_MAX_ROWS],
  ] as const)('over its cap a %s lists nothing', async (format, limit) => {
    const { service, repository } = await build();
    vi.spyOn(repository, 'count').mockResolvedValue(limit + 1);
    const list = vi.spyOn(repository, 'list');
    const error = await rejection(service.exportCsv({ format }, 'all', VIEWER));
    expect(error.extras?.issues).toEqual([
      expect.objectContaining({ path: ['export'], params: { limit, total: limit + 1 } }),
    ]);
    expect(list).not.toHaveBeenCalled();
  });

  it('answers print rows with createdAt in the sent date format and zone, and no file name', async () => {
    const { service } = await build();
    const file = await service.exportCsv(
      { format: 'print', column: ['id', 'createdAt'], dateFormat: 'd/m/Y', timeZone: 'Asia/Dubai' },
      'all',
      VIEWER,
    );
    expect(file.filename).toBeNull();
    expect(file.body).toEqual({
      exportedAt: new Date(NOW).toISOString(),
      headers: ['id', 'createdAt'],
      rows: [
        ['1', '01/01/2026 04:00:00'],
        ['2', '02/01/2026 04:00:00'],
        ['3', '03/01/2026 04:00:00'],
      ],
    });
  });
});
