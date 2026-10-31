import { describe, expect, it, vi } from 'vitest';
import { FixedEquipmentDepreciationsFacade } from '../facade/fixed-equipment-depreciations.facade.js';
import type { FixedEquipmentDepreciation } from '../model/fixed-equipment-depreciations.model.js';

const ROW: FixedEquipmentDepreciation = {
  id: 1,
  name: 'Depreciation 1',
  term: 12,
  creatorId: 1,
};

function facadeWith(service: { listAll?: unknown; findById?: unknown }) {
  return new FixedEquipmentDepreciationsFacade(service as never);
}

describe('FixedEquipmentDepreciationsFacade', () => {
  it('findAll answers every depreciation the service lists', async () => {
    const listAll = vi.fn().mockResolvedValue([ROW]);
    await expect(facadeWith({ listAll }).findAll()).resolves.toEqual([ROW]);
    expect(listAll).toHaveBeenCalledTimes(1);
  });

  it('finds one depreciation by id, or null', async () => {
    const findById = vi.fn().mockResolvedValueOnce(ROW).mockResolvedValueOnce(null);
    const facade = facadeWith({ findById });
    await expect(facade.findById(1)).resolves.toEqual(ROW);
    await expect(facade.findById(99)).resolves.toBeNull();
    expect(findById).toHaveBeenNthCalledWith(1, 1);
    expect(findById).toHaveBeenNthCalledWith(2, 99);
  });
});
