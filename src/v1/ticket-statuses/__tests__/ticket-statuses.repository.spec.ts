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
  ticket_count: 0,
};

function build() {
  const client = {
    tbltickets_status: {
      findMany: vi.fn().mockResolvedValue([ROW]),
      findFirst: vi.fn().mockResolvedValue(ROW),
      create: vi.fn().mockResolvedValue(ROW),
      update: vi.fn().mockResolvedValue(ROW),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    tbltickets: {
      count: vi.fn().mockResolvedValue(0),
      groupBy: vi.fn().mockResolvedValue([{ status: 3, _count: { _all: 5 } }]),
    },
  };

  const repository = new TicketStatusesRepository({
    client,
  } as unknown as ClientHolder);

  return { repository, client };
}

describe('TicketStatusesRepository', () => {
  it('lists statuses in Perfex statusorder and id order', async () => {
    const { repository, client } = build();

    await expect(repository.list()).resolves.toEqual([{ ...ROW, ticket_count: 5 }]);

    expect(client.tbltickets_status.findMany).toHaveBeenCalledWith({
      orderBy: [{ statusorder: 'asc' }, { ticketstatusid: 'asc' }],
      select: {
        ticketstatusid: true,
        name: true,
        isdefault: true,
        statuscolor: true,
        statusorder: true,
      },
    });

    expect(client.tbltickets.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      _count: { _all: true },
    });
  });

  it('keeps every Prisma operation inside the repository and maps P2025 to null', async () => {
    const { repository, client } = build();

    await expect(repository.findById(3)).resolves.toEqual(ROW);

    expect(client.tbltickets_status.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ticketstatusid: 3 } }),
    );

    await expect(
      repository.create({
        name: 'New',
        statuscolor: null,
        statusorder: null,
      }),
    ).resolves.toEqual(ROW);

    expect(client.tbltickets_status.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'New',
          statuscolor: null,
          statusorder: null,
        },
      }),
    );

    client.tbltickets_status.update.mockRejectedValueOnce({
      code: 'P2025',
    });

    await expect(repository.update(404, { name: 'Missing' })).resolves.toBeNull();

    await expect(repository.hasTicketReferences(3)).resolves.toBe(false);

    expect(client.tbltickets.count).toHaveBeenCalledWith({
      where: { status: 3 },
    });

    await expect(repository.remove(3)).resolves.toBe(true);
  });

  it('propagates database failures and reports whether a ticket references the status', async () => {
    const { repository, client } = build();
    const failure = new Error('database unavailable');

    client.tbltickets.count.mockRejectedValueOnce(failure).mockResolvedValueOnce(1);

    await expect(repository.hasTicketReferences(3)).rejects.toBe(failure);
    await expect(repository.hasTicketReferences(3)).resolves.toBe(true);

    client.tbltickets_status.deleteMany.mockRejectedValueOnce(failure);

    await expect(repository.remove(3)).rejects.toBe(failure);
  });
});
