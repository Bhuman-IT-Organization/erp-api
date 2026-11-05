import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketPrioritiesFacade } from '../facade/ticket-priorities.facade.js';

const service = { listAll: vi.fn(), findById: vi.fn() };
let facade: TicketPrioritiesFacade;

beforeEach(() => {
  vi.resetAllMocks();
  facade = new TicketPrioritiesFacade(service as never);
});

describe('TicketPrioritiesFacade', () => {
  it('returns the model { id, name } from the service', async () => {
    service.listAll.mockResolvedValue([{ id: 1, name: 'Low' }]);
    expect(await facade.findAll()).toEqual([{ id: 1, name: 'Low' }]);
  });

  it('finds one priority by id', async () => {
    service.findById.mockResolvedValue({ id: 2, name: 'High' });
    expect(await facade.findById(2)).toEqual({ id: 2, name: 'High' });
    expect(service.findById).toHaveBeenCalledWith(2);
  });

  it('returns null when it does not exist', async () => {
    service.findById.mockResolvedValue(null);
    expect(await facade.findById(99)).toBeNull();
  });
});
