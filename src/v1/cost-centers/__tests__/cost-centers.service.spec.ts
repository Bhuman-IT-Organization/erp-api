/**
 * CostCentersService over the real layers, the seeded in-memory fake, a fixed clock and the settings
 * fake answering `default_timezone`. Administrators first: on a 403 neither the repository nor the
 * settings facade is called. D-31: a create writes `createdBy` = the actor's staff id and
 * `datecreated` = `wallClockAt(clock, zone)`, `UTC` when the setting is absent or unusable; an
 * update calls `update(id, { name })` and nothing else. Each change publishes exactly one event
 * AFTER the write and writes exactly one `log` line with `{ id }` (D-08, F1: `log`, never `info`); a
 * 400, 403, 404 or 409 publishes and logs nothing. The delete refuses with 409
 * `ERP-COSTCENTERS-0001` while any group is in use, naming the non-zero groups in order, and fails
 * closed when the usage answer does not name the id. The facade reads assert nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CSV_BOM } from '../../../shared/http/csv.js';
import type { SettingsFacade } from '../../settings/index.js';
import {
  CostCentersCreatedV1,
  CostCentersDeletedV1,
  CostCentersUpdatedV1,
} from '../events/published.js';
import { CostCentersService } from '../service/cost-centers.service.js';
import { CostCentersTransformer, wallClockAt } from '../service/cost-centers.transformer.js';
import { CostCentersTransport } from '../service/cost-centers.transport.js';
import { CostCentersValidator } from '../service/cost-centers.validator.js';
import {
  RecordingLogger,
  settingsWithZone,
  TEST_NOW,
  TEST_ZONE,
} from './create-cost-centers-test-app.js';
import {
  asRepository,
  seededStore,
  ZERO_USAGE,
  type InMemoryCostCentersRepository,
} from './fakes.js';

const AT = TEST_NOW.toISOString();
const EXPIRY_S = 4_102_444_800;
const ACTOR_ID = 5;

function actor(isAdmin: boolean): AuthenticatedUser {
  return {
    staffId: isAdmin ? ACTOR_ID : 2,
    sessionId: 'sid',
    jti: 'jti',
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: EXPIRY_S,
  };
}

const ADMIN = actor(true);
const MEMBER = actor(false);

function build(zone: string | null = TEST_ZONE) {
  const repo = seededStore();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();
  const settings = settingsWithZone(zone);
  const service = new CostCentersService(
    new CostCentersValidator(),
    asRepository(repo),
    new CostCentersTransformer(),
    new CostCentersTransport(events, settings as unknown as SettingsFacade),
    logger,
  );
  service.now = () => TEST_NOW;
  return { service, repo, events, logger, settings };
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

/** Every repository method spied, so a case can assert none was called. */
function spyAll(repo: InMemoryCostCentersRepository) {
  return [
    vi.spyOn(repo, 'list'),
    vi.spyOn(repo, 'count'),
    vi.spyOn(repo, 'findById'),
    vi.spyOn(repo, 'create'),
    vi.spyOn(repo, 'update'),
    vi.spyOn(repo, 'remove'),
    vi.spyOn(repo, 'usageByCostCenter'),
    vi.spyOn(repo, 'listAll'),
    vi.spyOn(repo, 'findByIds'),
  ];
}

describe('CostCentersService: administrators only (D-06, D-26)', () => {
  const calls: readonly (readonly [string, (service: CostCentersService) => Promise<unknown>])[] = [
    ['list', (service) => service.list(MEMBER, {})],
    ['get', (service) => service.get(MEMBER, { id: '1' })],
    ['create', (service) => service.create(MEMBER, { name: 'X' })],
    ['update', (service) => service.update(MEMBER, { id: '1' }, { name: 'X' })],
    ['remove', (service) => service.remove(MEMBER, { id: '1' })],
    ['exportCsv', (service) => service.exportCsv(MEMBER, {})],
  ];

  it.each(calls)(
    '%s refuses a non-administrator with ERP-AUTH-0005 before any repository or settings call, publishing and logging nothing',
    async (_name, call) => {
      const { service, repo, events, logger, settings } = build();
      const spies = spyAll(repo);
      const error = await refusal(call(service));
      expect(error.code).toBe('ERP-AUTH-0005');
      expect(error.message).toBe('cost centers are managed by administrators only');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(settings.calls).toEqual([]);
      expect(events.count).toBe(0);
      expect(logger.lines).toEqual([]);
    },
  );
});

describe('CostCentersService: reads', () => {
  it('lists the id descending with each row usage, reading the usage and the zone once', async () => {
    const { service, repo, settings } = build();
    repo.usage.set(1, { ...ZERO_USAGE, expenses: 2 });
    const usage = vi.spyOn(repo, 'usageByCostCenter');
    const page = await service.list(ADMIN, {});
    expect(page.data.map((row) => [row.id, row.usage.expenses])).toEqual([
      ['3', 0],
      ['2', 0],
      ['1', 2],
    ]);
    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledWith([3, 2, 1]);
    expect(settings.calls).toEqual([['default_timezone']]);
  });

  it('get answers the record with its usage and its date in the company zone, or ERP-CORE-0004', async () => {
    const { service, repo } = build();
    repo.usage.set(1, { ...ZERO_USAGE, assets: 4 });
    expect(await service.get(ADMIN, { id: '1' })).toEqual({
      id: '1',
      name: 'Head Office',
      dateCreated: '2026-01-05T05:00:00.000Z',
      usage: { ...ZERO_USAGE, assets: 4 },
    });
    expect((await refusal(service.get(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
  });

  it('exports the id, the name and the date created in the list order, never reading the usage', async () => {
    const { service, repo } = build();
    const usage = vi.spyOn(repo, 'usageByCostCenter');
    const { body } = await service.exportCsv(ADMIN, {});
    if (typeof body !== 'string') throw new Error('the export answered no CSV text');
    expect(body.replace(CSV_BOM, '').split('\r\n').slice(0, 4)).toEqual([
      'id,name,dateCreated',
      '3,Head Office,2026-02-10T10:30:00.000Z',
      '2,Warehouse,',
      '1,Head Office,2026-01-05T05:00:00.000Z',
    ]);
    expect(usage).not.toHaveBeenCalled();
  });
});

describe('CostCentersService: create (D-29, D-31)', () => {
  it('writes createdBy = the actor and datecreated = the wall clock in the company zone; one event after the write, one log line', async () => {
    const { service, repo, events, logger } = build();
    const create = vi.spyOn(repo, 'create');
    const created = await service.create(ADMIN, { name: 'Fuel < 50 km' });
    expect(create).toHaveBeenCalledWith({
      name: 'Fuel < 50 km',
      createdBy: ACTOR_ID,
      datecreated: wallClockAt(TEST_NOW, TEST_ZONE),
    });
    expect(wallClockAt(TEST_NOW, TEST_ZONE).toISOString()).toBe('2026-10-03T00:30:15.000Z');
    expect(created).toMatchObject({
      name: 'Fuel < 50 km',
      dateCreated: '2026-10-02T20:30:15.000Z',
      usage: ZERO_USAGE,
    });
    const id = Number(created.id);
    const published = events.drain();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(CostCentersCreatedV1);
    expect(published[0]?.payload).toEqual({ id, at: AT });
    expect(logger.lines).toEqual([{ message: 'cost center created', meta: { id } }]);
  });

  it.each([[null], [''], ['Not/AZone']])(
    'with default_timezone %o the wall clock is UTC',
    async (zone) => {
      const { service, repo } = build(zone);
      const create = vi.spyOn(repo, 'create');
      await service.create(ADMIN, { name: 'Ops' });
      expect(create).toHaveBeenCalledWith({
        name: 'Ops',
        createdBy: ACTOR_ID,
        datecreated: new Date('2026-10-02T20:30:15.000Z'),
      });
    },
  );

  it('a name another cost center holds is accepted (Perfex has no uniqueness check)', async () => {
    const { service } = build();
    expect((await service.create(ADMIN, { name: 'Head Office' })).name).toBe('Head Office');
  });

  it('a body carrying created_by is a 400: nothing written, nothing published or logged', async () => {
    const { service, repo, events, logger } = build();
    const create = vi.spyOn(repo, 'create');
    const error = await refusal(service.create(ADMIN, { name: 'X', created_by: 9 }));
    expect(error.code).toBe('ERP-VALIDATION-0001');
    expect(create).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });
});

describe('CostCentersService: update (D-31: the name only)', () => {
  it('calls update(id, { name }) with no other key: exactly one event after the write and one log line', async () => {
    const { service, repo, events, logger } = build();
    const update = vi.spyOn(repo, 'update');
    expect(await service.update(ADMIN, { id: '1' }, { name: 'Renamed' })).toMatchObject({
      name: 'Renamed',
      dateCreated: '2026-01-05T05:00:00.000Z',
    });
    expect(update).toHaveBeenCalledWith(1, { name: 'Renamed' });
    expect(Object.keys(update.mock.calls[0]?.[1] ?? {})).toEqual(['name']);
    const published = events.drain();
    expect(published.map((event) => event.constructor)).toEqual([CostCentersUpdatedV1]);
    expect(published[0]?.payload).toEqual({ id: 1, at: AT });
    expect(logger.lines).toEqual([{ message: 'cost center updated', meta: { id: 1 } }]);
  });

  it('a missing id is 404, and neither publishes nor logs', async () => {
    const { service, events, logger } = build();
    expect((await refusal(service.update(ADMIN, { id: '404' }, { name: 'X' }))).code).toBe(
      'ERP-CORE-0004',
    );
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('{} is a 400 before the row is touched', async () => {
    const { service, repo } = build();
    const update = vi.spyOn(repo, 'update');
    expect((await refusal(service.update(ADMIN, { id: '1' }, {}))).code).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe('CostCentersService: remove (D-07, D-28)', () => {
  it('deletes an unused cost center: exactly one event after the delete and one log line with { id }', async () => {
    const { service, repo, events, logger } = build();
    await service.remove(ADMIN, { id: '2' });
    expect(await repo.findById(2)).toBeNull();
    const published = events.drain();
    expect(published.map((event) => event.constructor)).toEqual([CostCentersDeletedV1]);
    expect(published[0]?.payload).toEqual({ id: 2, at: AT });
    expect(logger.lines).toEqual([{ message: 'cost center deleted', meta: { id: 2 } }]);
  });

  it('a usage answer without the id fails closed: 409 ERP-COSTCENTERS-0001, nothing deleted', async () => {
    const { service, repo, events, logger } = build();
    vi.spyOn(repo, 'usageByCostCenter').mockResolvedValueOnce(new Map());
    const remove = vi.spyOn(repo, 'remove');
    const error = await refusal(service.remove(ADMIN, { id: '2' }));
    expect(error.code).toBe('ERP-COSTCENTERS-0001');
    expect(error.message).toBe('its use could not be counted');
    expect(remove).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('a usage read that rejects refuses too: nothing deleted', async () => {
    const { service, repo } = build();
    vi.spyOn(repo, 'usageByCostCenter').mockRejectedValueOnce(new Error('lock wait timeout'));
    const remove = vi.spyOn(repo, 'remove');
    await expect(service.remove(ADMIN, { id: '2' })).rejects.toThrow('lock wait timeout');
    expect(remove).not.toHaveBeenCalled();
  });

  it('in use: 409 naming only the non-zero groups, in order; nothing deleted', async () => {
    const { service, repo, events } = build();
    repo.usage.set(2, {
      purchaseRequests: 1,
      purchaseOrders: 2,
      purchaseQuotations: 3,
      shippingCharges: 4,
      expenses: 5,
      assets: 6,
    });
    const all = await refusal(service.remove(ADMIN, { id: '2' }));
    expect(all.code).toBe('ERP-COSTCENTERS-0001');
    expect(all.message).toBe(
      'used by 1 purchase request(s), 2 purchase order(s), 3 purchase quotation(s), 4 shipping charge(s), 5 expense(s) and 6 asset(s)',
    );
    repo.usage.set(2, { ...ZERO_USAGE, shippingCharges: 1 });
    expect((await refusal(service.remove(ADMIN, { id: '2' }))).message).toBe(
      'used by 1 shipping charge(s)',
    );
    expect(await repo.findById(2)).not.toBeNull();
    expect(events.count).toBe(0);
  });

  it('a missing id is 404 before the usage is read, and a row gone at the delete is 404 too', async () => {
    const { service, repo, events, logger } = build();
    const usage = vi.spyOn(repo, 'usageByCostCenter');
    expect((await refusal(service.remove(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
    expect(usage).not.toHaveBeenCalled();
    vi.spyOn(repo, 'remove').mockResolvedValueOnce(false);
    expect((await refusal(service.remove(ADMIN, { id: '2' }))).code).toBe('ERP-CORE-0004');
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });
});

describe('CostCentersService: the facade reads assert nothing', () => {
  it('findById, listAll and findByIds answer { id, name } without an actor', async () => {
    const { service, settings } = build();
    expect(service.describe()).toEqual({ module: 'cost-centers', version: 1 });
    expect(await service.findById(2)).toEqual({ id: 2, name: 'Warehouse' });
    expect(await service.findById(404)).toBeNull();
    expect((await service.listAll()).map((center) => center.id)).toEqual([1, 3, 2]);
    expect(await service.findByIds([3, 404, 2, 3])).toEqual([
      { id: 3, name: 'Head Office' },
      { id: 2, name: 'Warehouse' },
    ]);
    expect(await service.findByIds([])).toEqual([]);
    expect(settings.calls).toEqual([]);
  });
});
