import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import { CSV_BOM } from '../../../shared/http/csv.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  EstimateRequestStatusCreatedV1,
  EstimateRequestStatusDeletedV1,
  EstimateRequestStatusUpdatedV1,
  type EstimateRequestStatusesEventPayload,
} from '../events/published.js';
import type { EstimateRequestStatusRow } from '../model/estimate-request-statuses.model.js';
import type { EstimateRequestStatusesRepository } from '../repository/estimate-request-statuses.repository.js';
import { EstimateRequestStatusesService } from '../service/estimate-request-statuses.service.js';
import { EstimateRequestStatusesTransformer } from '../service/estimate-request-statuses.transformer.js';
import { EstimateRequestStatusesTransport } from '../service/estimate-request-statuses.transport.js';
import { EstimateRequestStatusesValidator } from '../service/estimate-request-statuses.validator.js';

const ADMIN: AuthenticatedUser = {
  staffId: 1,
  sessionId: 'admin',
  jti: 'admin-jti',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: 4_102_444_800,
};
const MEMBER: AuthenticatedUser = { ...ADMIN, staffId: 2, isAdmin: false };
const ROW: EstimateRequestStatusRow = {
  id: 3,
  name: 'Ready',
  color: null,
  statusorder: null,
  flag: null,
  total_request: 0,
};

function build(overrides: Partial<EstimateRequestStatusesRepository> = {}) {
  const methods = {
    list: vi.fn().mockResolvedValue({
      items: [ROW],
      nextCursor: null,
      prevCursor: null,
      total: 1,
      rangeStart: 1,
    }),
    count: vi.fn().mockResolvedValue(2),
    findById: vi.fn().mockResolvedValue(ROW),
    create: vi.fn().mockResolvedValue(ROW),
    update: vi.fn().mockResolvedValue(ROW),
    deleteReferenceCount: vi.fn().mockResolvedValue({ requestCount: 0, formCount: 0 }),
    remove: vi.fn().mockResolvedValue(true),
    listAll: vi.fn().mockResolvedValue([ROW]),
  };
  const repository = {
    ...methods,
    ...overrides,
  } as unknown as EstimateRequestStatusesRepository;
  const transport = {
    publish: vi
      .fn<(event: DomainEvent<string, EstimateRequestStatusesEventPayload>) => Promise<void>>()
      .mockResolvedValue(undefined),
  };
  const logger = { log: vi.fn() } as unknown as LoggerService;
  const service = new EstimateRequestStatusesService(
    new EstimateRequestStatusesValidator(),
    repository,
    new EstimateRequestStatusesTransformer(),
    transport as unknown as EstimateRequestStatusesTransport,
    logger,
  );
  service.now = () => new Date('2026-10-24T10:30:00.000Z');
  return { service, repository, methods, transport, logger };
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('EstimateRequestStatusesService', () => {
  it('requires an administrator before validation or repository access', async () => {
    const { service, methods } = build();
    const error = await failure(service.list(MEMBER, { invalid: true }));
    expect(error.code).toBe('ERP-AUTH-0005');
    expect(methods.list).not.toHaveBeenCalled();
  });

  it('stores the blank-color default and nullable order on create', async () => {
    const { service, methods, transport } = build();
    await service.create(ADMIN, { name: 'Ready', color: '', statusorder: '' });
    expect(methods.create).toHaveBeenCalledWith({
      name: 'Ready',
      color: '#757575',
      statusorder: null,
    });
    expect(transport.publish).toHaveBeenCalledOnce();
  });

  it('uses the existing row count plus one when statusorder is omitted', async () => {
    const { service, methods } = build();
    await service.create(ADMIN, { name: 'Ready' });
    expect(methods.count).toHaveBeenCalledWith({
      search: null,
      sortField: 'name',
      order: 'asc',
      cursor: null,
      limit: 1,
    });
    expect(methods.create).toHaveBeenCalledWith({
      name: 'Ready',
      color: null,
      statusorder: 3,
    });
  });

  it('publishes the create event class and { id, at } payload', async () => {
    const { service, transport } = build();
    await service.create(ADMIN, { name: 'Ready', statusorder: 3 });
    const event = transport.publish.mock.calls[0]?.[0];
    expect(event).toBeInstanceOf(EstimateRequestStatusCreatedV1);
    expect(event?.payload).toEqual({ id: 3, at: '2026-10-24T10:30:00.000Z' });
  });

  it('updates, returns 404 for a missing row, and publishes the update event', async () => {
    const { service, methods, transport } = build();
    await expect(service.update(ADMIN, { id: '3' }, { name: 'Available' })).resolves.toMatchObject({
      id: '3',
      name: 'Ready',
    });
    expect(methods.update).toHaveBeenCalledWith(3, { name: 'Available' });
    const event = transport.publish.mock.calls[0]?.[0];
    expect(event).toBeInstanceOf(EstimateRequestStatusUpdatedV1);
    expect(event?.payload).toEqual({ id: 3, at: '2026-10-24T10:30:00.000Z' });
    const missing = build({ update: vi.fn().mockResolvedValue(null) });
    const error = await failure(missing.service.update(ADMIN, { id: '4' }, { name: 'Missing' }));
    expect(error.code).toBe('ERP-CORE-0004');
  });

  it('gets and lists stored statuses through the transformer', async () => {
    const { service, methods } = build();
    await expect(service.get(ADMIN, { id: '3' })).resolves.toMatchObject({
      id: '3',
      name: 'Ready',
    });
    await expect(service.list(ADMIN, { sort: 'name' })).resolves.toMatchObject({
      data: [{ id: '3', name: 'Ready' }],
      meta: { total: 1 },
    });
    expect(methods.list).toHaveBeenCalledWith({
      search: null,
      sortField: 'name',
      order: 'asc',
      cursor: null,
      limit: 50,
    });
  });

  it('exports rows as CSV', async () => {
    const { service } = build();
    const file = await service.exportCsv(ADMIN, {});
    expect(file.body).toContain(`${CSV_BOM}id,name,total_request\r\n3,Ready,0`);
  });

  it('returns the reference error before checking a flagged status', async () => {
    const flagged = { ...ROW, flag: 'default' };
    const findById = vi.fn().mockResolvedValue(flagged);
    const deleteReferenceCount = vi.fn().mockResolvedValue({ requestCount: 2, formCount: 0 });
    const remove = vi.fn();
    const { service } = build({ findById, deleteReferenceCount, remove });
    const error = await failure(service.remove(ADMIN, { id: '3' }));
    expect(error.code).toBe('ERP-ESTIMATEREQUESTSTATUSES-0001');
    expect(deleteReferenceCount).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
  });

  it('refuses flagged rows after a clear reference check', async () => {
    const remove = vi.fn();
    const { service } = build({
      findById: vi.fn().mockResolvedValue({ ...ROW, flag: 'default' }),
      deleteReferenceCount: vi.fn().mockResolvedValue({ requestCount: 0, formCount: 0 }),
      remove,
    });
    const error = await failure(service.remove(ADMIN, { id: '3' }));
    expect(error.code).toBe('ERP-ESTIMATEREQUESTSTATUSES-0002');
    expect(remove).not.toHaveBeenCalled();
  });

  it('fails closed with the in-use code when reference discovery fails', async () => {
    const { service } = build({
      deleteReferenceCount: vi.fn().mockRejectedValue(new Error('information_schema unavailable')),
    });
    const error = await failure(service.remove(ADMIN, { id: '3' }));
    expect(error.code).toBe('ERP-ESTIMATEREQUESTSTATUSES-0001');
    expect(error.message).toBe('its use could not be counted');
  });

  it('distinguishes a failed count from a positive reference count', async () => {
    const { service } = build({
      deleteReferenceCount: vi.fn().mockResolvedValue({ requestCount: 1, formCount: 0 }),
    });
    const error = await failure(service.remove(ADMIN, { id: '3' }));
    expect(error.code).toBe('ERP-ESTIMATEREQUESTSTATUSES-0001');
    expect(error.message).toBe('estimate request status is still referenced');
  });

  it('refuses a status used by an estimate request form', async () => {
    const { service, methods } = build({
      deleteReferenceCount: vi.fn().mockResolvedValue({ requestCount: 0, formCount: 1 }),
    });
    const error = await failure(service.remove(ADMIN, { id: '3' }));
    expect(error.code).toBe('ERP-ESTIMATEREQUESTSTATUSES-0003');
    expect(error.message).toBe('estimate request status is used by an estimate request form');
    expect(methods.remove).not.toHaveBeenCalled();
  });

  it('deletes an unreferenced, unflagged row', async () => {
    const { service, methods, transport } = build();
    await expect(service.remove(ADMIN, { id: '3' })).resolves.toBeUndefined();
    expect(methods.remove).toHaveBeenCalledWith(3);
    const event = transport.publish.mock.calls[0]?.[0];
    expect(event).toBeInstanceOf(EstimateRequestStatusDeletedV1);
    expect(event?.payload).toEqual({ id: 3, at: '2026-10-24T10:30:00.000Z' });
  });
});
