/**
 * Facade: the only surface other modules import. It must hand every call to the service.
 */
import { describe, expect, it, vi } from 'vitest';
import { CustomerGroupsFacade } from '../facade/customer-groups.facade.js';
import type { CustomerGroupsService } from '../service/customer-groups.service.js';

function build() {
  const service = {
    describe: vi.fn(() => ({ module: 'customer-groups', version: 1 })),
    findById: vi.fn(),
    listAll: vi.fn(),
    findByIds: vi.fn(),
  };
  const facade = new CustomerGroupsFacade(service as unknown as CustomerGroupsService);
  return { facade, service };
}

describe('CustomerGroupsFacade', () => {
  it('describes the module', () => {
    const { facade } = build();
    expect(facade.describe()).toEqual({ module: 'customer-groups', version: 1 });
  });

  it('delegates findById', async () => {
    const { facade, service } = build();
    service.findById.mockResolvedValueOnce({ id: 1, name: 'VIP' });
    await expect(facade.findById(1)).resolves.toEqual({ id: 1, name: 'VIP' });
    expect(service.findById).toHaveBeenCalledWith(1);
  });

  it('delegates listAll', async () => {
    const { facade, service } = build();
    service.listAll.mockResolvedValueOnce([{ id: 1, name: 'VIP' }]);
    await expect(facade.listAll()).resolves.toEqual([{ id: 1, name: 'VIP' }]);
  });

  it('delegates findByIds', async () => {
    const { facade, service } = build();
    service.findByIds.mockResolvedValueOnce([{ id: 2, name: 'Gold' }]);
    await expect(facade.findByIds([2, 5])).resolves.toEqual([{ id: 2, name: 'Gold' }]);
    expect(service.findByIds).toHaveBeenCalledWith([2, 5]);
  });
});
