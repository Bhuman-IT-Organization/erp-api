import { describe, expect, it, vi } from 'vitest';
import type { EstimateRequestStatusesService } from '../service/estimate-request-statuses.service.js';
import { EstimateRequestStatusesFacade } from '../facade/estimate-request-statuses.facade.js';

describe('EstimateRequestStatusesFacade', () => {
  it('delegates read-only status lookup methods', async () => {
    const row = {
      id: 2,
      name: 'Ready',
      color: null,
      statusorder: null,
      flag: null,
      total_request: 0,
    };
    const findById = vi.fn().mockResolvedValue(row);
    const listAll = vi.fn().mockResolvedValue([row]);
    const service = { findById, listAll } as unknown as EstimateRequestStatusesService;
    const facade = new EstimateRequestStatusesFacade(service);
    await expect(facade.findById(2)).resolves.toEqual(row);
    await expect(facade.listAll()).resolves.toEqual([row]);
    expect(findById).toHaveBeenCalledWith(2);
    expect(listAll).toHaveBeenCalledOnce();
  });
});
