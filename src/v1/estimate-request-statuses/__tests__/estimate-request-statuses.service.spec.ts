import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { LoggerService } from '../../../shared/logger/logger.service.js';
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
    list: vi.fn(),
    count: vi.fn(),
    findById: vi.fn().mockResolvedValue(ROW),
    create: vi.fn().mockResolvedValue(ROW),
    update: vi.fn().mockResolvedValue(ROW),
    deleteReferenceCount: vi.fn().mockResolvedValue(0),
    remove: vi.fn().mockResolvedValue(true),
    listAll: vi.fn().mockResolvedValue([ROW]),
  };
  const repository = {
    ...methods,
    ...overrides,
  } as unknown as EstimateRequestStatusesRepository;
  const transport = { publish: vi.fn().mockResolvedValue(undefined) };
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

  it('returns the reference error before checking a flagged status', async () => {
    const flagged = { ...ROW, flag: 'default' };
    const findById = vi.fn().mockResolvedValue(flagged);
    const deleteReferenceCount = vi.fn().mockResolvedValue(2);
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
      deleteReferenceCount: vi.fn().mockResolvedValue(0),
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
  });

  it('deletes an unreferenced, unflagged row', async () => {
    const { service, methods, transport } = build();
    await expect(service.remove(ADMIN, { id: '3' })).resolves.toBeUndefined();
    expect(methods.remove).toHaveBeenCalledWith(3);
    expect(transport.publish).toHaveBeenCalledOnce();
  });
});
