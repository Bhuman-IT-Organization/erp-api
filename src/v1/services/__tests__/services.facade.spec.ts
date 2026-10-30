import { describe, expect, it, vi } from 'vitest';
import { ServicesFacade } from '../facade/services.facade.js';
import type { ServicesService } from '../service/services.service.js';

function build() {
  const service = {
    describe: vi.fn().mockReturnValue({ module: 'services', version: 1 }),
    findById: vi.fn().mockResolvedValue({ id: 1, name: 'A' }),
    listAll: vi.fn().mockResolvedValue([{ id: 1, name: 'A' }]),
    findByIds: vi.fn().mockResolvedValue([{ id: 1, name: 'A' }]),
  };
  return { service, facade: new ServicesFacade(service as unknown as ServicesService) };
}

describe('ServicesFacade', () => {
  it('describes the module', () => {
    expect(build().facade.describe()).toEqual({ module: 'services', version: 1 });
  });

  it('delegates the three read-only lookups to the service', async () => {
    const { facade, service } = build();
    expect(await facade.findById(1)).toEqual({ id: 1, name: 'A' });
    expect(await facade.listAll()).toEqual([{ id: 1, name: 'A' }]);
    expect(await facade.findByIds([1])).toEqual([{ id: 1, name: 'A' }]);
    expect(service.findById).toHaveBeenCalledWith(1);
    expect(service.findByIds).toHaveBeenCalledWith([1]);
  });

  it('exposes no write method', () => {
    const names = Object.getOwnPropertyNames(ServicesFacade.prototype).sort();
    expect(names).toEqual(['constructor', 'describe', 'findById', 'findByIds', 'listAll']);
  });
});
