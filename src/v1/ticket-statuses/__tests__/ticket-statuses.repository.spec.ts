import { describe, expect, it, vi } from 'vitest';
import type { TicketStatus } from '../model/ticket-statuses.model.js';
import { TicketStatusesRepository } from '../repository/ticket-statuses.repository.js';

type ClientHolder = ConstructorParameters<typeof TicketStatusesRepository>[0];

const ROW: TicketStatus = {
  ticketstatusid: 3,
  name: 'Open',
  isdefault: 0,
  statuscolor: '#03a9f4',
  statusorder: 1,
  ticket_count: 5,
};

function build() {
  const client = {
    tbltickets_status: {
      findMany: vi.fn().mockResolvedValue([ROW]),
      findFirst: vi.fn().mockResolvedValue(ROW),
      create: vi.fn().mockResolvedValue(ROW),
      update: vi.fn().mockResolvedValue(ROW),
      count: vi.fn().mockResolvedValue(1),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    tbltickets: {
      count: vi.fn().mockResolvedValue(5),
      groupBy: vi.fn().mockResolvedValue([{ status: 3, _count: { _all: 5 } }]),
    },
  };

  const repository = new TicketStatusesRepository({ client } as unknown as ClientHolder);
  return { repository, client };
}

describe('TicketStatusesRepository', () => {
  it('lists pages with ticket counts and the default id-desc ordering', async () => {
    const { repository, client } = build();
    const page = await repository.list({
      search: null,
      sortField: 'id',
      order: 'desc',
      cursor: null,
      limit: 50,
    });
    expect(page.items[0]).toMatchObject({ ticketstatusid: 3, ticket_count: 5 });
    expect(client.tbltickets.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { status: { in: [3] } },
      _count: { _all: true },
    });
    await repository.listAll();
    expect(client.tbltickets.groupBy).toHaveBeenLastCalledWith({
      by: ['status'],
      where: { status: { in: [3] } },
      _count: { _all: true },
    });
    expect(page.total).toBeGreaterThanOrEqual(1);
  });

  it('maps not-found updates to null and counts ticket references', async () => {
    const { repository, client } = build();
    client.tbltickets_status.update.mockRejectedValueOnce({ code: 'P2025' });
    await expect(repository.update(404, { name: 'Missing' })).resolves.toBeNull();
    await expect(repository.hasTicketReferences(3)).resolves.toBe(true);
    expect(client.tbltickets.count).toHaveBeenCalledWith({ where: { status: 3 } });
  });

  it('treats digit-only searches above MySQL INT as names only', async () => {
    const { repository, client } = build();
    await repository.list({
      search: '2147483648',
      sortField: 'id',
      order: 'desc',
      cursor: null,
      limit: 50,
    });
    expect(client.tbltickets_status.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ name: { contains: '2147483648' } }] } }),
    );
  });

  it('deletes only when the row exists and count failures propagate', async () => {
    const { repository, client } = build();
    await expect(repository.remove(3)).resolves.toBe(true);
    client.tbltickets.count.mockRejectedValueOnce(new Error('count failed'));
    await expect(repository.hasTicketReferences(3)).rejects.toThrow('count failed');
  });
});
