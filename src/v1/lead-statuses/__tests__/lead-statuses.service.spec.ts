import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { LoggerService } from '../../../shared/logger/logger.service.js';

import {
  LeadStatusesCreatedV1,
  LeadStatusesDeletedV1,
  LeadStatusesUpdatedV1,
} from '../events/published.js';

import type { LeadStatusRow, LeadStatusUsage } from '../model/lead-statuses.model.js';

import {
  LeadStatusesRepository,
  type CreateLeadStatusData,
  type UpdateLeadStatusData,
} from '../repository/lead-statuses.repository.js';

import { LeadStatusesService } from '../service/lead-statuses.service.js';
import { LeadStatusesTransformer } from '../service/lead-statuses.transformer.js';
import { LeadStatusesTransport } from '../service/lead-statuses.transport.js';
import { LeadStatusesValidator } from '../service/lead-statuses.validator.js';

const TEST_NOW = new Date('2026-10-22T10:00:00.000Z');

function actor(isAdmin: boolean): AuthenticatedUser {
  return {
    staffId: isAdmin ? 5 : 2,
    sessionId: 'test-session',
    jti: 'test-jti',
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: 4_102_444_800,
  };
}

const ADMIN = actor(true);
const MEMBER = actor(false);

const ZERO_USAGE: LeadStatusUsage = {
  leads: 0,
  emailIntegration: 0,
};

function seededRows(): Map<number, LeadStatusRow> {
  return new Map([
    [
      1,
      {
        id: 1,
        name: 'Customer',
        statusorder: 1,
        color: '#28B8DA',
        isdefault: 1,
      },
    ],
    [
      2,
      {
        id: 2,
        name: 'New',
        statusorder: 2,
        color: '#28B8DA',
        isdefault: 0,
      },
    ],
    [
      3,
      {
        id: 3,
        name: 'Contacted',
        statusorder: 3,
        color: '#28B8DA',
        isdefault: 0,
      },
    ],
    [
      4,
      {
        id: 4,
        name: 'Pending',
        statusorder: 4,
        color: '#28B8DA',
        isdefault: 0,
      },
    ],
  ]);
}

function build() {
  const rows = seededRows();
  const usage = new Map<number, LeadStatusUsage>();

  const repository = {
    list: vi.fn(() => {
      const items = [...rows.values()];

      return Promise.resolve({
        items,
        nextCursor: null,
        prevCursor: null,
        total: items.length,
        rangeStart: items.length > 0 ? 1 : 0,
      });
    }),

    count: vi.fn(() => Promise.resolve(rows.size)),

    findById: vi.fn((id: number) => Promise.resolve(rows.get(id) ?? null)),

    findByIds: vi.fn((ids: readonly number[]) =>
      Promise.resolve(
        ids.flatMap((id) => {
          const row = rows.get(id);
          return row === undefined ? [] : [row];
        }),
      ),
    ),

    listAll: vi.fn(() =>
      Promise.resolve(
        [...rows.values()].sort(
          (a, b) => (a.statusorder ?? 0) - (b.statusorder ?? 0) || a.id - b.id,
        ),
      ),
    ),

    create: vi.fn((input: CreateLeadStatusData) => {
      const id = Math.max(0, ...rows.keys()) + 1;

      const row: LeadStatusRow = {
        id,
        name: input.name,
        color: input.color ?? '#28B8DA',
        statusorder: input.statusorder ?? null,
        isdefault: 0,
      };

      rows.set(id, row);
      return Promise.resolve(row);
    }),

    update: vi.fn((id: number, patch: UpdateLeadStatusData) => {
      const existing = rows.get(id);

      if (existing === undefined) {
        return Promise.resolve(null);
      }

      const updated: LeadStatusRow = {
        ...existing,
        ...patch,
      };

      rows.set(id, updated);
      return Promise.resolve(updated);
    }),

    remove: vi.fn((id: number) => Promise.resolve(rows.delete(id))),

    usageByStatuses: vi.fn((ids: readonly number[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, usage.get(id) ?? { ...ZERO_USAGE }]))),
    ),

    usageByStatus: vi.fn((id: number) => Promise.resolve(usage.get(id) ?? { ...ZERO_USAGE })),
  };

  const transport = {
    publish: vi.fn<(event: unknown) => Promise<void>>().mockResolvedValue(undefined),

    configuredDefaultStatus: vi.fn<() => Promise<string | null>>().mockResolvedValue('2'),
  };

  const logger = {
    log: vi.fn(),
  };

  const service = new LeadStatusesService(
    new LeadStatusesValidator(),
    repository as unknown as LeadStatusesRepository,
    new LeadStatusesTransformer(),
    transport as unknown as LeadStatusesTransport,
    logger as unknown as LoggerService,
  );

  service.now = () => TEST_NOW;

  return {
    service,
    repository,
    transport,
    logger,
    rows,
    usage,
  };
}

describe('LeadStatusesService: administrator authorization', () => {
  const actions: readonly [string, (service: LeadStatusesService) => Promise<unknown>][] = [
    ['list', (service) => service.list(MEMBER, {})],
    ['get', (service) => service.get(MEMBER, { id: '1' })],
    ['create', (service) => service.create(MEMBER, { name: 'Test' })],
    ['update', (service) => service.update(MEMBER, { id: '1' }, { name: 'Test' })],
    ['remove', (service) => service.remove(MEMBER, { id: '1' })],
    ['export', (service) => service.exportCsv(MEMBER, {})],
  ];

  it.each(actions)('%s refuses non-admin users before database access', async (_name, action) => {
    const { service, repository, transport, logger } = build();

    await expect(action(service)).rejects.toMatchObject({
      code: 'ERP-AUTH-0005',
    });

    expect(repository.findById).not.toHaveBeenCalled();
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.remove).not.toHaveBeenCalled();

    expect(transport.configuredDefaultStatus).not.toHaveBeenCalled();

    expect(transport.publish).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });
});

describe('LeadStatusesService: read operations', () => {
  it('describes the module', () => {
    const { service } = build();

    expect(service.describe()).toEqual({
      module: 'lead-statuses',
      version: 1,
    });
  });

  it('lists lead statuses with usage and configured default', async () => {
    const { service, usage } = build();

    usage.set(3, {
      leads: 2,
      emailIntegration: 0,
    });

    const result = await service.list(ADMIN, {});

    expect(result.data.map((row) => row.id)).toEqual(['1', '2', '3', '4']);

    expect(result.data[1]?.isConfiguredDefault).toBe(true);

    expect(result.data[2]?.usage).toEqual({
      leads: 2,
      emailIntegration: 0,
    });
  });

  it('returns one status by ID', async () => {
    const { service } = build();

    const result = await service.get(ADMIN, { id: '4' });

    expect(result).toMatchObject({
      id: '4',
      name: 'Pending',
      isConfiguredDefault: false,
    });
  });

  it('returns 404 for a missing status', async () => {
    const { service } = build();

    await expect(service.get(ADMIN, { id: '999' })).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
  });

  it('supports read-only facade methods', async () => {
    const { service } = build();

    expect((await service.findById(4))?.name).toBe('Pending');
    expect(await service.findById(999)).toBeNull();

    expect((await service.listAll()).map((row) => row.id)).toEqual([1, 2, 3, 4]);

    expect((await service.findByIds([4, 2, 4, 999])).map((row) => row.id)).toEqual([4, 2]);

    expect(await service.findByIds([])).toEqual([]);
  });
});

describe('LeadStatusesService: create', () => {
  it('creates a status with the next order number', async () => {
    const { service, repository, transport, logger } = build();

    const result = await service.create(ADMIN, {
      name: 'Follow-up',
      color: '#123456',
    });

    expect(result).toMatchObject({
      id: '5',
      name: 'Follow-up',
      statusorder: 5,
      color: '#123456',
      isdefault: 0,
    });

    expect(repository.create).toHaveBeenCalledWith({
      name: 'Follow-up',
      color: '#123456',
      statusorder: 5,
    });

    expect(transport.publish).toHaveBeenCalledTimes(1);

    const event = transport.publish.mock.calls[0]?.[0];
    expect(event).toBeInstanceOf(LeadStatusesCreatedV1);

    expect(logger.log).toHaveBeenCalledWith('lead status created', { id: 5 });
  });

  it('rejects an empty name without creating a row', async () => {
    const { service, repository, transport } = build();

    await expect(service.create(ADMIN, { name: '' })).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });

    expect(repository.create).not.toHaveBeenCalled();
    expect(transport.publish).not.toHaveBeenCalled();
  });
});

describe('LeadStatusesService: update', () => {
  it('updates a status and publishes an event', async () => {
    const { service, repository, transport } = build();

    const result = await service.update(
      ADMIN,
      { id: '4' },
      {
        name: 'Waiting',
        color: '#445566',
      },
    );

    expect(result.name).toBe('Waiting');

    expect(repository.update).toHaveBeenCalledWith(4, {
      name: 'Waiting',
      color: '#445566',
    });

    const event = transport.publish.mock.calls[0]?.[0];
    expect(event).toBeInstanceOf(LeadStatusesUpdatedV1);
  });

  it('returns 404 if the status does not exist', async () => {
    const { service, transport } = build();

    await expect(service.update(ADMIN, { id: '999' }, { name: 'Unknown' })).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });

    expect(transport.publish).not.toHaveBeenCalled();
  });
});

describe('LeadStatusesService: deletion protections', () => {
  it('protects the built-in Customer status', async () => {
    const { service, repository, transport } = build();

    await expect(service.remove(ADMIN, { id: '1' })).rejects.toMatchObject({
      code: 'ERP-LEADSTATUSES-0002',
    });

    expect(repository.remove).not.toHaveBeenCalled();
    expect(transport.publish).not.toHaveBeenCalled();
  });

  it('protects the configured default status', async () => {
    const { service, repository } = build();

    await expect(service.remove(ADMIN, { id: '2' })).rejects.toMatchObject({
      code: 'ERP-LEADSTATUSES-0003',
    });

    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('refuses deletion when leads reference the status', async () => {
    const { service, repository, usage } = build();

    usage.set(3, {
      leads: 5,
      emailIntegration: 0,
    });

    await expect(service.remove(ADMIN, { id: '3' })).rejects.toMatchObject({
      code: 'ERP-LEADSTATUSES-0001',
    });

    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('refuses deletion when email integration references the status', async () => {
    const { service, repository, usage } = build();

    usage.set(3, {
      leads: 0,
      emailIntegration: 1,
    });

    await expect(service.remove(ADMIN, { id: '3' })).rejects.toMatchObject({
      code: 'ERP-LEADSTATUSES-0001',
    });

    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('deletes an unused status and publishes one event', async () => {
    const { service, repository, transport, logger } = build();

    await service.remove(ADMIN, { id: '4' });

    expect(repository.remove).toHaveBeenCalledWith(4);

    expect(transport.publish).toHaveBeenCalledTimes(1);

    const event = transport.publish.mock.calls[0]?.[0];
    expect(event).toBeInstanceOf(LeadStatusesDeletedV1);

    expect(logger.log).toHaveBeenCalledWith('lead status deleted', { id: 4 });
  });

  it('does not delete when usage checking fails', async () => {
    const { service, repository } = build();

    repository.usageByStatus.mockRejectedValueOnce(new Error('Database unavailable'));

    await expect(service.remove(ADMIN, { id: '4' })).rejects.toThrow('Database unavailable');

    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('returns 404 when the status is missing', async () => {
    const { service, repository } = build();

    await expect(service.remove(ADMIN, { id: '999' })).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });

    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('refuses deletion when the default setting is invalid', async () => {
    const { service, repository, transport } = build();

    transport.configuredDefaultStatus.mockResolvedValueOnce('invalid');

    await expect(service.remove(ADMIN, { id: '4' })).rejects.toMatchObject({
      code: 'ERP-INTERNAL-0001',
    });

    expect(repository.remove).not.toHaveBeenCalled();
  });
});
