/**
 * TaxesService over the real layers and the seeded in-memory fake. Administrators first: on a 403
 * the repository is never called. Each change publishes exactly one event AFTER the write and
 * writes exactly one `log` line with `{ id }` (D-08, F1: `log`, never `info`); a 400, 403, 404 or
 * 409 publishes and logs nothing. Perfex's four refusals in their order: the locked edit (0002) and
 * the in-use delete (0001) fail closed when the usage answer does not name the id, the duplicate
 * name (0003) and the default tax (0004, D-21). The facade reads assert nothing.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CSV_BOM } from '../../../shared/http/csv.js';
import { TaxesCreatedV1, TaxesDeletedV1, TaxesUpdatedV1 } from '../events/published.js';
import { TaxesService } from '../service/taxes.service.js';
import { TaxesTransformer } from '../service/taxes.transformer.js';
import { TaxesTransport } from '../service/taxes.transport.js';
import { TaxesValidator } from '../service/taxes.validator.js';
import { RecordingLogger } from './create-taxes-test-app.js';
import { asRepository, seededStore, ZERO_USAGE, type InMemoryTaxesRepository } from './fakes.js';

const NOW = Date.parse('2026-10-02T08:30:00.000Z');
const AT = new Date(NOW).toISOString();
const EXPIRY_S = 4_102_444_800;

function actor(isAdmin: boolean): AuthenticatedUser {
  return {
    staffId: isAdmin ? 1 : 2,
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

async function build() {
  const repo = await seededStore();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();
  const service = new TaxesService(
    new TaxesValidator(),
    asRepository(repo),
    new TaxesTransformer(),
    new TaxesTransport(events),
    logger,
  );
  service.now = () => NOW;
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
function spyAll(repo: InMemoryTaxesRepository) {
  return [
    vi.spyOn(repo, 'list'),
    vi.spyOn(repo, 'count'),
    vi.spyOn(repo, 'findById'),
    vi.spyOn(repo, 'findOtherByName'),
    vi.spyOn(repo, 'create'),
    vi.spyOn(repo, 'update'),
    vi.spyOn(repo, 'remove'),
    vi.spyOn(repo, 'usageByTax'),
    vi.spyOn(repo, 'defaultTaxSetting'),
  ];
}

describe('TaxesService: administrators only (D-06)', () => {
  const calls: readonly (readonly [string, (service: TaxesService) => Promise<unknown>])[] = [
    ['list', (service) => service.list(MEMBER, {})],
    ['get', (service) => service.get(MEMBER, { id: '1' })],
    ['create', (service) => service.create(MEMBER, { name: 'X', rate: '1' })],
    ['update', (service) => service.update(MEMBER, { id: '1' }, { name: 'X' })],
    ['remove', (service) => service.remove(MEMBER, { id: '1' })],
    ['exportCsv', (service) => service.exportCsv(MEMBER, {})],
  ];

  it.each(calls)(
    '%s refuses a non-administrator with ERP-AUTH-0005 before any repository call, publishing and logging nothing',
    async (_name, call) => {
      const { service, repo, events, logger } = await build();
      const spies = spyAll(repo);
      const error = await refusal(call(service));
      expect(error.code).toBe('ERP-AUTH-0005');
      expect(error.message).toBe('taxes are managed by administrators only');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(events.count).toBe(0);
      expect(logger.lines).toEqual([]);
    },
  );
});

describe('TaxesService: reads', () => {
  it('lists the rate ascending with the usage and the default flag, reading the usage and the setting once', async () => {
    const { service, repo } = await build();
    repo.defaultTax = 'VAT|10.00';
    const usage = vi.spyOn(repo, 'usageByTax');
    const setting = vi.spyOn(repo, 'defaultTaxSetting');
    const page = await service.list(ADMIN, {});
    expect(page.data.map((row) => [row.id, row.rate, row.isDefault])).toEqual([
      ['2', '5.00', false],
      ['1', '10.00', true],
      ['3', '100.00', false],
    ]);
    expect(usage).toHaveBeenCalledTimes(1);
    expect(usage).toHaveBeenCalledWith([2, 1, 3]);
    expect(setting).toHaveBeenCalledTimes(1);
  });

  it('get answers the record with its usage, or ERP-CORE-0004', async () => {
    const { service, repo } = await build();
    repo.usage.set(1, { ...ZERO_USAGE, items: 4 });
    expect((await service.get(ADMIN, { id: '1' })).usage.items).toBe(4);
    expect((await refusal(service.get(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
  });

  it('exports the id, the name and the rate in the list order, never reading the usage', async () => {
    const { service, repo } = await build();
    const usage = vi.spyOn(repo, 'usageByTax');
    const { body } = await service.exportCsv(ADMIN, {});
    if (typeof body !== 'string') throw new Error('the export answered no CSV text');
    expect(body.replace(CSV_BOM, '').split('\r\n').slice(0, 4)).toEqual([
      'id,name,rate',
      '2,Reduced,5.00',
      '1,VAT,10.00',
      '3,Luxury,100.00',
    ]);
    expect(usage).not.toHaveBeenCalled();
  });
});

describe('TaxesService: create', () => {
  it('rounds the rate, then exactly one event after the write and one log line with { id }', async () => {
    const { service, repo, events, logger } = await build();
    const create = vi.spyOn(repo, 'create');
    const created = await service.create(ADMIN, { name: 'Fuel', rate: '-5.555' });
    expect(created.rate).toBe('-5.56');
    expect(create).toHaveBeenCalledWith({ name: 'Fuel', taxrate: '-5.56' });
    const id = Number(created.id);
    const published = events.drain();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(TaxesCreatedV1);
    expect(published[0]?.payload).toEqual({ id, at: AT });
    expect(logger.lines).toEqual([{ message: 'tax created', meta: { id } }]);
  });

  it('a duplicate name (any letter case) is 409 ERP-TAXES-0003 before the write', async () => {
    const { service, repo, events, logger } = await build();
    const create = vi.spyOn(repo, 'create');
    const error = await refusal(service.create(ADMIN, { name: 'LUXURY', rate: '1' }));
    expect(error.code).toBe('ERP-TAXES-0003');
    expect(create).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('a rate the column cannot hold is a 400 on rate, before the name is looked up', async () => {
    const { service, repo, events } = await build();
    const lookup = vi.spyOn(repo, 'findOtherByName');
    const error = await refusal(service.create(ADMIN, { name: 'Huge', rate: '99999999999999' }));
    expect(error.code).toBe('ERP-VALIDATION-0001');
    expect(error.extras?.issues).toEqual([{ path: ['rate'], message: 'the rate is too large' }]);
    expect(lookup).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
  });
});

describe('TaxesService: update', () => {
  it('changes the given fields: exactly one event after the write and one log line with { id }', async () => {
    const { service, events, logger } = await build();
    expect(await service.update(ADMIN, { id: '1' }, { rate: '12.5' })).toMatchObject({
      name: 'VAT',
      rate: '12.50',
    });
    const published = events.drain();
    expect(published.map((event) => event.constructor)).toEqual([TaxesUpdatedV1]);
    expect(published[0]?.payload).toEqual({ id: 1, at: AT });
    expect(logger.lines).toEqual([{ message: 'tax updated', meta: { id: 1 } }]);
  });

  it('a missing id is 404 before the usage is read; a missing row at the write is 404 too', async () => {
    const { service, repo, events } = await build();
    const usage = vi.spyOn(repo, 'usageByTax');
    expect((await refusal(service.update(ADMIN, { id: '404' }, { name: 'X' }))).code).toBe(
      'ERP-CORE-0004',
    );
    expect(usage).not.toHaveBeenCalled();
    vi.spyOn(repo, 'update').mockResolvedValueOnce(null);
    expect((await refusal(service.update(ADMIN, { id: '1' }, { name: 'X' }))).code).toBe(
      'ERP-CORE-0004',
    );
    expect(events.count).toBe(0);
  });

  it('a rate the column cannot hold is a 400 on rate, before the row is read', async () => {
    const { service, repo } = await build();
    const read = vi.spyOn(repo, 'findById');
    const error = await refusal(service.update(ADMIN, { id: '1' }, { rate: '99999999999999' }));
    expect(error.code).toBe('ERP-VALIDATION-0001');
    expect(read).not.toHaveBeenCalled();
  });

  it('a usage answer without the id fails closed: 409 ERP-TAXES-0002, no write', async () => {
    const { service, repo, logger } = await build();
    vi.spyOn(repo, 'usageByTax').mockResolvedValueOnce(new Map());
    const update = vi.spyOn(repo, 'update');
    const error = await refusal(service.update(ADMIN, { id: '1' }, { name: 'X' }));
    expect(error.code).toBe('ERP-TAXES-0002');
    expect(error.message).toBe('its use could not be counted');
    expect(update).not.toHaveBeenCalled();
    expect(logger.lines).toEqual([]);
  });

  it('used by expenses and subscriptions: 409 ERP-TAXES-0002 naming both', async () => {
    const { service, repo } = await build();
    repo.usage.set(1, { ...ZERO_USAGE, expenses: 2, subscriptions: 1 });
    const error = await refusal(service.update(ADMIN, { id: '1' }, { name: 'X' }));
    expect(error.code).toBe('ERP-TAXES-0002');
    expect(error.message).toBe('used by 2 expense(s) and 1 subscription(s)');
  });

  it('the locked check comes before the duplicate check, and that before the default check', async () => {
    const { service, repo } = await build();
    repo.defaultTax = 'VAT|10.00';
    repo.usage.set(1, { ...ZERO_USAGE, expenses: 1 });
    expect((await refusal(service.update(ADMIN, { id: '1' }, { name: 'Reduced' }))).code).toBe(
      'ERP-TAXES-0002',
    );
    repo.usage.clear();
    expect((await refusal(service.update(ADMIN, { id: '1' }, { name: 'Reduced' }))).code).toBe(
      'ERP-TAXES-0003',
    );
    expect((await refusal(service.update(ADMIN, { id: '1' }, { name: 'Sales' }))).code).toBe(
      'ERP-TAXES-0004',
    );
  });

  it('a default tax refuses a name or rate change (D-21) and the detail never quotes the setting', async () => {
    const { service, repo, events } = await build();
    repo.defaultTax = 'a:1:{i:0;s:9:"VAT|10.00";}';
    const rate = await refusal(service.update(ADMIN, { id: '1' }, { rate: '10.01' }));
    expect(rate.code).toBe('ERP-TAXES-0004');
    expect(rate.message).not.toContain('VAT|');
    expect(await service.update(ADMIN, { id: '1' }, { rate: '10.004' })).toMatchObject({
      rate: '10.00',
    });
    expect(events.drain()).toHaveLength(1);
  });

  it('a tax default_tax does not name may change freely', async () => {
    const { service, repo } = await build();
    repo.defaultTax = 'Other|1.00';
    expect(await service.update(ADMIN, { id: '1' }, { name: 'Sales' })).toMatchObject({
      name: 'Sales',
    });
  });
});

describe('TaxesService: remove', () => {
  it('deletes an unused tax: exactly one event after the delete and one log line with { id }', async () => {
    const { service, repo, events, logger } = await build();
    await service.remove(ADMIN, { id: '3' });
    expect(await repo.findById(3)).toBeNull();
    const published = events.drain();
    expect(published.map((event) => event.constructor)).toEqual([TaxesDeletedV1]);
    expect(published[0]?.payload).toEqual({ id: 3, at: AT });
    expect(logger.lines).toEqual([{ message: 'tax deleted', meta: { id: 3 } }]);
  });

  it('a usage answer without the id fails closed: 409 ERP-TAXES-0001, nothing deleted', async () => {
    const { service, repo, events, logger } = await build();
    vi.spyOn(repo, 'usageByTax').mockResolvedValueOnce(new Map());
    const remove = vi.spyOn(repo, 'remove');
    const error = await refusal(service.remove(ADMIN, { id: '3' }));
    expect(error.code).toBe('ERP-TAXES-0001');
    expect(error.message).toBe('its use could not be counted');
    expect(remove).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });

  it('in use: 409 ERP-TAXES-0001 naming the non-zero groups; nothing deleted', async () => {
    const { service, repo, events } = await build();
    repo.usage.set(3, { ...ZERO_USAGE, warehouseLines: 2, salesReturnLines: 1 });
    const error = await refusal(service.remove(ADMIN, { id: '3' }));
    expect(error.code).toBe('ERP-TAXES-0001');
    expect(error.message).toBe('used by 2 warehouse line(s) and 1 sales return line(s)');
    expect(await repo.findById(3)).not.toBeNull();
    expect(events.count).toBe(0);
  });

  it('a missing id is 404, and a row gone between the read and the delete is 404 too', async () => {
    const { service, repo, events, logger } = await build();
    expect((await refusal(service.remove(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
    vi.spyOn(repo, 'remove').mockResolvedValueOnce(false);
    expect((await refusal(service.remove(ADMIN, { id: '3' }))).code).toBe('ERP-CORE-0004');
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });
});

describe('TaxesService: the facade reads assert nothing', () => {
  it('findById, listAll and findByIds answer { id, name, rate } without an actor', async () => {
    const { service } = await build();
    expect(service.describe()).toEqual({ module: 'taxes', version: 1 });
    expect(await service.findById(2)).toEqual({ id: 2, name: 'Reduced', rate: '5.00' });
    expect(await service.findById(404)).toBeNull();
    expect((await service.listAll()).map((tax) => tax.id)).toEqual([2, 1, 3]);
    expect(await service.findByIds([3, 404, 2, 3])).toEqual([
      { id: 3, name: 'Luxury', rate: '100.00' },
      { id: 2, name: 'Reduced', rate: '5.00' },
    ]);
    expect(await service.findByIds([])).toEqual([]);
  });
});
