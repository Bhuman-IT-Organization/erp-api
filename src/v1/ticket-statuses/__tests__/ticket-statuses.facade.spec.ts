import { describe, expect, it, vi } from 'vitest';
import type { TicketStatusesService } from '../service/ticket-statuses.service.js';
import { TicketStatusesFacade } from '../facade/ticket-statuses.facade.js';

describe('TicketStatusesFacade', () => {
  it('delegates only the read-only model lookups', async () => {
    const row = {
      ticketstatusid: 5,
      name: 'Waiting',
      isdefault: 0,
      statuscolor: null,
      statusorder: null,
    };
    const findById = vi.fn().mockResolvedValue(row);
    const listAll = vi.fn().mockResolvedValue([row]);
    const service = {
      findById,
      listAll,
    } as unknown as TicketStatusesService;
    const facade = new TicketStatusesFacade(service);

    await expect(facade.findById(5)).resolves.toEqual(row);
    await expect(facade.listAll()).resolves.toEqual([row]);
    expect(findById).toHaveBeenCalledWith(5);
    expect(listAll).toHaveBeenCalledOnce();
  });
});
