import { describe, expect, it, vi } from 'vitest';

import { LeadStatusesFacade } from '../facade/lead-statuses.facade.js';

import type { LeadStatus } from '../model/lead-statuses.model.js';

import type { LeadStatusesService } from '../service/lead-statuses.service.js';

const first: LeadStatus = {
  id: 1,
  name: 'Customer',
  statusorder: 1,
  color: '#28B8DA',
  isdefault: 1,
};

const second: LeadStatus = {
  id: 2,
  name: 'New',
  statusorder: 2,
  color: '#28B8DA',
  isdefault: 0,
};

function build() {
  const service = {
    describe: vi.fn(() => ({
      module: 'lead-statuses' as const,
      version: 1 as const,
    })),

    findById: vi.fn((id: number) => Promise.resolve(id === 1 ? first : null)),

    listAll: vi.fn(() => Promise.resolve([first, second])),

    findByIds: vi.fn((ids: readonly number[]) =>
      Promise.resolve([first, second].filter((row) => ids.includes(row.id))),
    ),
  };

  const facade = new LeadStatusesFacade(service as unknown as LeadStatusesService);

  return { facade, service };
}

describe('LeadStatusesFacade', () => {
  it('returns module information', () => {
    const { facade, service } = build();

    expect(facade.describe()).toEqual({
      module: 'lead-statuses',
      version: 1,
    });

    expect(service.describe).toHaveBeenCalledTimes(1);
  });

  it('finds a lead status by ID', async () => {
    const { facade, service } = build();

    await expect(facade.findById(1)).resolves.toEqual(first);

    expect(service.findById).toHaveBeenCalledWith(1);
  });

  it('returns null when the status does not exist', async () => {
    const { facade } = build();

    await expect(facade.findById(999)).resolves.toBeNull();
  });

  it('lists all lead statuses', async () => {
    const { facade, service } = build();

    await expect(facade.listAll()).resolves.toEqual([first, second]);

    expect(service.listAll).toHaveBeenCalledTimes(1);
  });

  it('finds multiple statuses by their IDs', async () => {
    const { facade, service } = build();

    await expect(facade.findByIds([1, 2])).resolves.toEqual([first, second]);

    expect(service.findByIds).toHaveBeenCalledWith([1, 2]);
  });

  it('forwards an empty ID list', async () => {
    const { facade, service } = build();

    await expect(facade.findByIds([])).resolves.toEqual([]);

    expect(service.findByIds).toHaveBeenCalledWith([]);
  });
});
