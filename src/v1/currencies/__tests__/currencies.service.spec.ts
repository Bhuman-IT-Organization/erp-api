/**
 * CurrenciesService over the in-memory repository, a real registry and the recording publisher and
 * logger: the reads carry every count and `canMakeBase`, a change publishes one event and writes one
 * log line with the id only, and the registered counters are read for each id in one go and fail
 * the read closed.
 */
import { describe, expect, it } from 'vitest';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CSV_BOM } from '../../../shared/http/csv.js';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  CurrenciesBaseChangedV1,
  CurrenciesCreatedV1,
  CurrenciesDeletedV1,
  CurrenciesUpdatedV1,
} from '../events/published.js';
import { CurrenciesService } from '../service/currencies.service.js';
import {
  CurrenciesTransformer,
  NO_CURRENCY_LOCK_USAGE,
  NO_CURRENCY_USAGE,
} from '../service/currencies.transformer.js';
import { CurrenciesTransport } from '../service/currencies.transport.js';
import { CurrenciesValidator } from '../service/currencies.validator.js';
import { CurrencyUsageRegistry } from '../service/currency-usage.registry.js';
import { RecordingLogger, SettableUsageCounter, TEST_NOW } from './create-currencies-test-app.js';
import { asRepository, seededStore } from './fakes.js';

const AT = TEST_NOW.toISOString();
const EXPIRY_S = 4_102_444_800;

function actor(isAdmin: boolean): AuthenticatedUser {
  return {
    staffId: isAdmin ? 5 : 2,
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

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

const BODY = {
  name: 'gbp',
  symbol: 'GBP',
  decimalSeparator: '.',
  thousandSeparator: ',',
  placement: 'after',
} as const;

function build() {
  const repo = seededStore();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();
  const registry = new CurrencyUsageRegistry();
  const counter = new SettableUsageCounter();
  registry.register({
    key: 'probeRows',
    module: 'probe',
    noun: 'probe row',
    count: (id) => counter.count(id),
  });
  const service = new CurrenciesService(
    new CurrenciesValidator(),
    asRepository(repo),
    new CurrenciesTransformer(),
    new CurrenciesTransport(events),
    registry,
    logger,
  );
  service.now = () => TEST_NOW;
  return { service, repo, events, logger, registry, counter };
}

describe('CurrenciesService: the reads', () => {
  it('list: the code descending, every count, the registered counters and canMakeBase', async () => {
    const { service, repo, counter } = build();
    repo.counts.set(2, {
      usage: { ...NO_CURRENCY_USAGE, vendors: 1 },
      lockUsage: NO_CURRENCY_LOCK_USAGE,
    });
    counter.answers.set(3, 2);
    const page = await service.list(ADMIN, {});
    expect(page.data.map((row) => row.id)).toEqual(['1', '3', '2', '4']);
    expect(page.data.map((row) => row.usage.vendors)).toEqual([0, 0, 1, 0]);
    expect(page.data.map((row) => row.registeredUsage)).toEqual([
      { probeRows: 0 },
      { probeRows: 2 },
      { probeRows: 0 },
      { probeRows: 0 },
    ]);
    expect(page.data.map((row) => row.canMakeBase)).toEqual([false, true, true, true]);
    expect([...counter.asked].sort()).toEqual([1, 2, 3, 4]);
  });

  it('the base state: a base with a core use makes no row a candidate', async () => {
    const { service, repo } = build();
    repo.counts.set(1, {
      usage: { ...NO_CURRENCY_USAGE, invoices: 1 },
      lockUsage: NO_CURRENCY_LOCK_USAGE,
    });
    const page = await service.list(ADMIN, { q: 'EUR' });
    expect(page.data.map((row) => row.canMakeBase)).toEqual([false, false]);
  });

  it('the base state: a module-only use of the base does not lock it', async () => {
    const { service, repo } = build();
    repo.counts.set(1, {
      usage: { ...NO_CURRENCY_USAGE, vendors: 3 },
      lockUsage: { ...NO_CURRENCY_LOCK_USAGE, exchangeRates: 2 },
    });
    expect((await service.get(ADMIN, { id: '2' })).canMakeBase).toBe(true);
  });

  it('a counter that rejects or answers a non-count fails the read closed', async () => {
    const rejecting = build();
    rejecting.counter.error = new Error('lock wait timeout');
    await expect(rejecting.service.list(ADMIN, {})).rejects.toThrow('lock wait timeout');

    const malformed = build();
    malformed.registry.register({
      key: 'zBroken',
      module: 'probe',
      noun: 'probe',
      count: () => Promise.resolve(-1),
    });
    await expect(malformed.service.get(ADMIN, { id: '1' })).rejects.toThrow(
      'currency usage zBroken answered something other than a count',
    );
  });

  it('get: a missing id is ERP-CORE-0004', async () => {
    const { service } = build();
    await expect(service.get(ADMIN, { id: '99' })).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
  });
});

describe('CurrenciesService: the writes (D-38, D-43)', () => {
  it('create stores the shared code, publishes one Created and logs one line with the id', async () => {
    const { service, repo, events, logger } = build();
    const created = await service.create(ADMIN, BODY);
    expect(created).toMatchObject({ id: '5', name: 'GBP', isBase: false, canMakeBase: true });
    expect(repo.all().at(-1)).toMatchObject({ name: 'GBP', symbol: 'GBP', isBase: false });
    expect(events.drain().map((event) => [event.name, event.payload])).toEqual([
      [CurrenciesCreatedV1.NAME, { id: 5, at: AT }],
    ]);
    expect(logger.lines).toEqual([{ message: 'currency created', meta: { id: 5 } }]);
  });

  it('a code another currency holds is accepted', async () => {
    const { service } = build();
    expect((await service.create(ADMIN, { ...BODY, name: 'usd' })).name).toBe('USD');
  });

  it('update rewrites the five, publishes one Updated and logs one line', async () => {
    const { service, repo, events, logger } = build();
    const updated = await service.update(ADMIN, { id: '4' }, { ...BODY, name: 'aed' });
    expect(updated).toMatchObject({ id: '4', name: 'AED', symbol: 'GBP', placement: 'after' });
    expect(repo.all().find((row) => row.id === 4)).toMatchObject({
      decimalSeparator: '.',
      thousandSeparator: ',',
    });
    expect(events.drain().map((event) => [event.name, event.payload])).toEqual([
      [CurrenciesUpdatedV1.NAME, { id: 4, at: AT }],
    ]);
    expect(logger.lines).toEqual([{ message: 'currency updated', meta: { id: 4 } }]);
  });

  it('update of a missing id is ERP-CORE-0004 with no event and no log line', async () => {
    const { service, events, logger } = build();
    await expect(service.update(ADMIN, { id: '99' }, BODY)).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
    expect(events.drain()).toEqual([]);
    expect(logger.lines).toEqual([]);
  });
});

describe('CurrenciesService: the export and the facade reads', () => {
  it('exports the code, the symbol and isBase as CSV without reading a count', async () => {
    const { service, repo } = build();
    const file = await service.exportCsv(ADMIN, { format: 'csv' });
    const text = typeof file.body === 'string' ? file.body : '';
    expect(text.startsWith(CSV_BOM)).toBe(true);
    expect(text).toContain('name,symbol,isBase');
    expect(repo.calls).not.toContain('usageByCurrency');
  });

  it('listAll and baseCurrency answer the facade shape', async () => {
    const { service } = build();
    expect((await service.listAll()).map((currency) => currency.id)).toEqual([1, 2, 3, 4]);
    expect((await service.baseCurrency())?.name).toBe('USD');
  });
});

describe('CurrenciesService: administrators only (D-06, D-38)', () => {
  const calls: readonly [string, (service: CurrenciesService) => Promise<unknown>][] = [
    ['list', (service) => service.list(MEMBER, {})],
    ['exportCsv', (service) => service.exportCsv(MEMBER, {})],
    ['get', (service) => service.get(MEMBER, { id: '2' })],
    ['create', (service) => service.create(MEMBER, BODY)],
    ['update', (service) => service.update(MEMBER, { id: '2' }, BODY)],
    ['makeBase', (service) => service.makeBase(MEMBER, { id: '2' }, {})],
    ['remove', (service) => service.remove(MEMBER, { id: '2' })],
  ];

  it.each(calls)(
    '%s refuses a non-administrator with ERP-AUTH-0005 before any read or counter',
    async (_name, call) => {
      const { service, repo, counter, events, logger } = build();
      const error = await refusal(call(service));
      expect(error.code).toBe('ERP-AUTH-0005');
      expect(error.message).toBe('currencies are managed by administrators only');
      expect(repo.calls).toEqual([]);
      expect(counter.asked).toEqual([]);
      expect(events.drain()).toEqual([]);
      expect(logger.lines).toEqual([]);
    },
  );
});

describe('CurrenciesService: the code lock on update (D-42 widened)', () => {
  it('reads the usage and the counters only when the code changes', async () => {
    const same = build();
    await same.service.update(ADMIN, { id: '4' }, { ...BODY, name: 'aed' });
    expect(same.repo.calls).toEqual([
      'findById',
      'update',
      'usageByCurrency',
      'findBase',
      'usageByCurrency',
    ]);
    expect(same.counter.asked).toEqual([4]);

    const changed = build();
    await changed.service.update(ADMIN, { id: '4' }, BODY);
    expect(changed.repo.calls.slice(0, 3)).toEqual(['findById', 'usageByCurrency', 'update']);
  });

  it('a refused code change writes nothing, publishes nothing and logs nothing', async () => {
    const { service, repo, events, logger, counter } = build();
    counter.answers.set(4, 1);
    const error = await refusal(service.update(ADMIN, { id: '4' }, BODY));
    expect(error.code).toBe('ERP-CURRENCIES-0005');
    expect(repo.calls).not.toContain('update');
    expect(events.drain()).toEqual([]);
    expect(logger.lines).toEqual([]);
  });
});

describe('CurrenciesService: make-base (D-39)', () => {
  it('switches the base, publishes one BaseChanged with previousId and logs one line', async () => {
    const { service, repo, events, logger } = build();
    expect(await service.makeBase(ADMIN, { id: '4' }, {})).toEqual({ id: '4', isBase: true });
    expect(
      repo
        .all()
        .filter((row) => row.isBase)
        .map((row) => row.id),
    ).toEqual([4]);
    expect(events.drain().map((event) => [event.name, event.payload])).toEqual([
      [CurrenciesBaseChangedV1.NAME, { id: 4, previousId: 1, at: AT }],
    ]);
    expect(logger.lines).toEqual([
      { message: 'base currency changed', meta: { id: 4, previousId: 1 } },
    ]);
  });

  it('with no base set, previousId is null', async () => {
    const { service, repo, events } = build();
    repo.seed(repo.all().map((row) => ({ ...row, isBase: false })));
    await service.makeBase(ADMIN, { id: '2' }, {});
    expect(events.drain().map((event) => event.payload)).toEqual([
      { id: 2, previousId: null, at: AT },
    ]);
  });

  it('the base itself is a no-op: no write, no event, no log line', async () => {
    const { service, repo, events, logger } = build();
    expect(await service.makeBase(ADMIN, { id: '1' }, {})).toEqual({ id: '1', isBase: true });
    expect(repo.calls).toEqual(['findById']);
    expect(events.drain()).toEqual([]);
    expect(logger.lines).toEqual([]);
  });

  it('a base with a core use refuses with 0004 and changes nothing', async () => {
    const { service, repo, events } = build();
    repo.counts.set(1, {
      usage: { ...NO_CURRENCY_USAGE, subscriptions: 1 },
      lockUsage: NO_CURRENCY_LOCK_USAGE,
    });
    expect((await refusal(service.makeBase(ADMIN, { id: '2' }, {}))).code).toBe(
      'ERP-CURRENCIES-0004',
    );
    expect(repo.calls).not.toContain('setBase');
    expect(events.drain()).toEqual([]);
  });
});

describe('CurrenciesService: the delete (D-40, D-41)', () => {
  it('reads the counters only after the usage and the base checks pass', async () => {
    const used = build();
    used.repo.counts.set(2, {
      usage: { ...NO_CURRENCY_USAGE, invoices: 1 },
      lockUsage: NO_CURRENCY_LOCK_USAGE,
    });
    expect((await refusal(used.service.remove(ADMIN, { id: '2' }))).code).toBe(
      'ERP-CURRENCIES-0001',
    );
    expect(used.counter.asked).toEqual([]);

    const baseRow = build();
    expect((await refusal(baseRow.service.remove(ADMIN, { id: '1' }))).code).toBe(
      'ERP-CURRENCIES-0002',
    );
    expect(baseRow.counter.asked).toEqual([]);
  });

  it('deletes an unused currency: one Deleted event and one log line, after the write', async () => {
    const { service, repo, events, logger } = build();
    await service.remove(ADMIN, { id: '4' });
    expect(repo.all().map((row) => row.id)).toEqual([1, 2, 3]);
    expect(events.drain().map((event) => [event.name, event.payload])).toEqual([
      [CurrenciesDeletedV1.NAME, { id: 4, at: AT }],
    ]);
    expect(logger.lines).toEqual([{ message: 'currency deleted', meta: { id: 4 } }]);
  });

  it('a registered use refuses with 0003, nothing deleted, nothing published', async () => {
    const { service, repo, counter, events } = build();
    counter.answers.set(4, 3);
    expect((await refusal(service.remove(ADMIN, { id: '4' }))).code).toBe('ERP-CURRENCIES-0003');
    expect(repo.all()).toHaveLength(4);
    expect(events.drain()).toEqual([]);
  });

  it('a missing id is 404 before any count', async () => {
    const { service, repo } = build();
    expect((await refusal(service.remove(ADMIN, { id: '99' }))).code).toBe('ERP-CORE-0004');
    expect(repo.calls).toEqual(['findById']);
  });
});
