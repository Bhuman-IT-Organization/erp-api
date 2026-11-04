import { describe, expect, it, vi } from 'vitest';
import { EstimateRequestStatusesRepository } from '../repository/estimate-request-statuses.repository.js';

describe('EstimateRequestStatusesRepository', () => {
  it('discovers and counts both status reference columns using information_schema', async () => {
    const $queryRaw = vi
      .fn()
      .mockResolvedValueOnce([
        { t: 'tblestimate_requests', c: 'status' },
        { t: 'tblestimate_request_forms', c: 'status' },
      ])
      .mockResolvedValueOnce([{ n: 1n }])
      .mockResolvedValueOnce([{ n: 2n }]);
    const prisma = {
      client: { $queryRaw },
    } as unknown as ConstructorParameters<typeof EstimateRequestStatusesRepository>[0];
    const repository = new EstimateRequestStatusesRepository(prisma);

    await expect(repository.deleteReferenceCount(12)).resolves.toBe(3);
    expect($queryRaw).toHaveBeenCalledTimes(3);
    expect(String($queryRaw.mock.calls[0]?.[0])).toContain('information_schema.COLUMNS');
  });

  it('skips columns not present in the current schema', async () => {
    const $queryRaw = vi.fn().mockResolvedValueOnce([]);
    const prisma = {
      client: { $queryRaw },
    } as unknown as ConstructorParameters<typeof EstimateRequestStatusesRepository>[0];
    const repository = new EstimateRequestStatusesRepository(prisma);
    await expect(repository.deleteReferenceCount(12)).resolves.toBe(0);
    expect($queryRaw).toHaveBeenCalledTimes(1);
  });
});
