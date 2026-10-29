/**
 * ContractTypesService over the real layers, the seeded in-memory fake, a fixed clock.
 * Administrators first: on a 403 neither the repository nor transport is called.
 * A create writes `name`; an update calls `update(id, { name })` and nothing else.
 * Each change publishes exactly one event AFTER the write and writes exactly one `log` line with `{ id }`
 * (D-08, F1: `log`, never `info`); a 400, 403, 404 or 409 publishes and logs nothing.
 * The delete refuses with 409 `ERP-CONTRACTTYPES-0001` while any group is in use,
 * naming the non-zero groups in order, and fails closed when the usage count fails or does not name the id.
 * The facade reads assert nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CSV_BOM } from '../../../shared/http/csv.js';
import {
  ContractTypesCreatedV1,
  ContractTypesDeletedV1,
  ContractTypesUpdatedV1,
} from '../events/published.js';
import { ContractTypesService } from '../service/contract-types.service.js';
import { ContractTypesTransformer } from '../service/contract-types.transformer.js';
import { ContractTypesTransport } from '../service/contract-types.transport.js';
import { ContractTypesValidator } from '../service/contract-types.validator.js';
import {
  TEST_NOW,
} from './create-contract-types-test-app.js';
import {
  asRepository,
  seededStore,
  ZERO_USAGE,
  type InMemoryContractTypesRepository,
} from './fakes.js';
import { LoggerService, type LogMeta } from '../../../shared/logger/logger.service.js';

class RecordingLogger extends LoggerService {
  readonly lines: { readonly message: string; readonly meta?: LogMeta }[] = [];

  override log(message: string, meta?: LogMeta): void {
    this.lines.push({ message, ...(meta === undefined ? {} : { meta }) });
  }

  override error(): void {
    /* silent */
  }

  override warn(): void {
    /* silent */
  }

  override debug(): void {
    /* silent */
  }
}

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

function build() {
  const repo = seededStore();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();
  const service = new ContractTypesService(
    new ContractTypesValidator(),
    asRepository(repo),
    new ContractTypesTransformer(),
    new ContractTypesTransport(events),
    logger,
  );
  service.now = () => TEST_NOW;
  return { service, repo, events, logger };
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
function spyAll(repo: InMemoryContractTypesRepository) {
  return [
    vi.spyOn(repo, 'list'),
    vi.spyOn(repo, 'count'),
    vi.spyOn(repo, 'findById'),
    vi.spyOn(repo, 'create'),
    vi.spyOn(repo, 'update'),
    vi.spyOn(repo, 'remove'),
    vi.spyOn(repo, 'usageByContractType'),
    vi.spyOn(repo, 'listAll'),
    vi.spyOn(repo, 'findByIds'),
  ];
}

describe('ContractTypesService: administrators only (D-06, D-26)', () => {
  const calls: readonly (readonly [string, (service: ContractTypesService) => Promise<unknown>])[] =
    [
      ['list', (service) => service.list(MEMBER, {})],
      ['get', (service) => service.get(MEMBER, { id: '1' })],
      ['create', (service) => service.create(MEMBER, { name: 'X' })],
      ['update', (service) => service.update(MEMBER, { id: '1' }, { name: 'X' })],
      ['remove', (service) => service.remove(MEMBER, { id: '1' })],
      ['exportCsv', (service) => service.exportCsv(MEMBER, {})],
    ];

  it.each(calls)(
    '%s refuses a non-administrator with ERP-AUTH-0005 before any repository call, publishing and logging nothing',
    async (_name, call) => {
      const { service, repo, events, logger } = build();
      const spies = spyAll(repo);
      const error = await refusal(call(service));
      expect(error.code).toBe('ERP-AUTH-0005');
      expect(error.message).toBe('contract types are managed by administrators only');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(events.count).toBe(0);
      expect(logger.lines).toEqual([]);
    },
  );
});

describe('ContractTypesService: reads', () => {
  it('lists the name descending with each row usage by default', async () => {
    const { service, repo } = build();
    repo.usage.set(1, { ...ZERO_USAGE, contracts: 2 });
    const usage = vi.spyOn(repo, 'usageByContractType');
    const page = await service.list(ADMIN, {});
    expect(page.data.map((row) => [row.name, row.usage.contracts])).toEqual([
      ['Warehouse', 0],
      ['Head Office', 0],
      ['Head Office', 2],
    ]);
    expect(usage).toHaveBeenCalledTimes(1);
  });

  it('get answers the record with its usage, or ERP-CORE-0004', async () => {
    const { service, repo } = build();
    repo.usage.set(1, { ...ZERO_USAGE, contracts: 4 });
    expect(await service.get(ADMIN, { id: '1' })).toEqual({
      id: '1',
      name: 'Head Office',
      usage: { contracts: 4 },
    });
    expect((await refusal(service.get(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
  });

  it('exports name and contracts in the list order', async () => {
    const { service, repo } = build();
    repo.usage.set(1, { ...ZERO_USAGE, contracts: 2 });
    const usage = vi.spyOn(repo, 'usageByContractType');
    const { body } = await service.exportCsv(ADMIN, {});
    if (typeof body !== 'string') throw new Error('the export answered no CSV text');
    expect(body.replace(CSV_BOM, '').split('\r\n').slice(0, 4)).toEqual([
      'name,contracts',
      'Warehouse,0',
      'Head Office,0',
      'Head Office,2',
    ]);
    expect(usage).toHaveBeenCalled();
  });
});

describe('ContractTypesService: create (D-29, D-31)', () => {
  it('stores the name; one event after the write, one log line', async () => {
    const { service, repo, events, logger } = build();
    const create = vi.spyOn(repo, 'create');
    const created = await service.create(ADMIN, { name: 'Fixed-Term < 6 months' });
    expect(create).toHaveBeenCalledWith({
      name: 'Fixed-Term < 6 months',
    });
    expect(created).toMatchObject({
      name: 'Fixed-Term < 6 months',
      usage: ZERO_USAGE,
    });
    const id = Number(created.id);
    const published = events.drain();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(ContractTypesCreatedV1);
    expect(published[0]?.payload).toEqual({ id, at: AT });
    expect(logger.lines).toEqual([{ message: 'contract type created', meta: { id } }]);
  });

  it('a name another contract type holds is accepted (Perfex has no uniqueness check)', async () => {
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

describe('ContractTypesService: update (D-31: the name only)', () => {
  it('calls update(id, { name }) with no other key: exactly one event after the write and one log line', async () => {
    const { service, repo, events, logger } = build();
    const update = vi.spyOn(repo, 'update');
    expect(await service.update(ADMIN, { id: '1' }, { name: 'Renamed' })).toMatchObject({
      name: 'Renamed',
    });
    expect(update).toHaveBeenCalledWith(1, { name: 'Renamed' });
    expect(Object.keys(update.mock.calls[0]?.[1] ?? {})).toEqual(['name']);
    const published = events.drain();
    expect(published.map((event) => event.constructor)).toEqual([ContractTypesUpdatedV1]);
    expect(published[0]?.payload).toEqual({ id: 1, at: AT });
    expect(logger.lines).toEqual([{ message: 'contract type updated', meta: { id: 1 } }]);
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

describe('ContractTypesService: remove (D-07, D-28)', () => {
  it('deletes an unused contract type: exactly one event after the delete and one log line with { id }', async () => {
    const { service, repo, events, logger } = build();
    await service.remove(ADMIN, { id: '2' });
    expect(await repo.findById(2)).toBeNull();
    const published = events.drain();
    expect(published.map((event) => event.constructor)).toEqual([ContractTypesDeletedV1]);
    expect(published[0]?.payload).toEqual({ id: 2, at: AT });
    expect(logger.lines).toEqual([{ message: 'contract type deleted', meta: { id: 2 } }]);
  });

  it('a usage answer without the id fails closed: 409 ERP-CONTRACTTYPES-0001, nothing deleted', async () => {
    const { service, repo, events, logger } = build();
    vi.spyOn(repo, 'usageByContractType').mockResolvedValueOnce(new Map());
    const remove = vi.spyOn(repo, 'remove');
    const error = await refusal(service.remove(ADMIN, { id: '2' }));
    expect(error.code).toBe('ERP-CONTRACTTYPES-0001');
    expect(error.message).toBe('its use could not be counted');
    expect(remove).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('a usage read that rejects answers 409 its use could not be counted: nothing deleted', async () => {
    const { service, repo, events, logger } = build();
    vi.spyOn(repo, 'usageByContractType').mockRejectedValueOnce(new Error('lock wait timeout'));
    const remove = vi.spyOn(repo, 'remove');
    const error = await refusal(service.remove(ADMIN, { id: '2' }));
    expect(error.code).toBe('ERP-CONTRACTTYPES-0001');
    expect(error.message).toBe('its use could not be counted');
    expect(remove).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('in use: 409 naming only the non-zero groups, in order; nothing deleted', async () => {
    const { service, repo, events } = build();
    repo.usage.set(2, {
      ...ZERO_USAGE,
      contracts: 1,
    });
    const res = await refusal(service.remove(ADMIN, { id: '2' }));
    expect(res.code).toBe('ERP-CONTRACTTYPES-0001');
    expect(res.message).toBe('used by 1 contract(s)');
    expect(await repo.findById(2)).not.toBeNull();
    expect(events.count).toBe(0);
  });

  it('a missing id is 404 before the usage is read, and a row gone at the delete is 404 too', async () => {
    const { service, repo, events, logger } = build();
    const usage = vi.spyOn(repo, 'usageByContractType');
    expect((await refusal(service.remove(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
    expect(usage).not.toHaveBeenCalled();
    vi.spyOn(repo, 'remove').mockResolvedValueOnce(false);
    expect((await refusal(service.remove(ADMIN, { id: '2' }))).code).toBe('ERP-CORE-0004');
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });
});

describe('ContractTypesService: the facade reads assert nothing', () => {
  it('findById, listAll and findByIds answer { id, name } without an actor', async () => {
    const { service } = build();
    expect(service.describe()).toEqual({ module: 'contract-types', version: 1 });
    expect(await service.findById(2)).toEqual({ id: 2, name: 'Warehouse' });
    expect(await service.findById(404)).toBeNull();
    expect((await service.listAll()).map((item) => item.id)).toEqual([1, 3, 2]);
    expect(await service.findByIds([3, 404, 2, 3])).toEqual([
      { id: 3, name: 'Head Office' },
      { id: 2, name: 'Warehouse' },
    ]);
    expect(await service.findByIds([])).toEqual([]);
  });
});
