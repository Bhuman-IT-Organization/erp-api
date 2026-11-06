import { describe, expect, it, vi } from 'vitest';
import { TodoRepository } from '../repository/todo.repository.js';

const DATED = new Date(Date.UTC(2026, 9, 3, 0, 30, 15));

const dbRow = (overrides: Record<string, unknown> = {}) => ({
  todoid: 1,
  description: 'Call Ali',
  staffid: 5,
  dateadded: DATED,
  finished: false,
  datefinished: null,
  item_order: 1,
  ...overrides,
});

function build() {
  const tbltodos = {
    findMany: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
    aggregate: vi.fn(),
    create:
      vi.fn<(args: { data: { item_order: number | null } }) => Promise<ReturnType<typeof dbRow>>>(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  };

  const transaction = vi.fn(async (run: (tx: { tbltodos: typeof tbltodos }) => Promise<unknown>) =>
    run({ tbltodos }),
  );

  const repository = new TodoRepository({
    client: { tbltodos, $transaction: transaction },
  } as never);

  return { repository, tbltodos, transaction };
}

describe('TodoRepository (over a stub client)', () => {
  describe('list', () => {
    it("reads the caller's unfinished panel by item_order, with the page and the total", async () => {
      const { repository, tbltodos } = build();
      tbltodos.findMany.mockResolvedValue([dbRow({ todoid: 3 })]);
      tbltodos.count.mockResolvedValue(9);

      const page = await repository.list(5, {
        status: 'unfinished',
        limit: 20,
        cursor: null,
      });

      expect(tbltodos.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { staffid: 5, finished: false },
          orderBy: [{ item_order: 'asc' }, { todoid: 'asc' }],
          take: 21,
        }),
      );

      expect(tbltodos.count).toHaveBeenCalledWith({
        where: { staffid: 5, finished: false },
      });

      expect(page.total).toBe(9);
      expect(page.hasMore).toBe(false);
      expect(page.items).toEqual([
        {
          id: 3,
          description: 'Call Ali',
          staffId: 5,
          dateAdded: DATED,
          finished: false,
          dateFinished: null,
          itemOrder: 1,
        },
      ]);
    });

    it('uses the cursor to fetch rows after a null item order', async () => {
      const { repository, tbltodos } = build();
      tbltodos.findMany.mockResolvedValue([dbRow({ todoid: 8, item_order: 2 })]);
      tbltodos.count.mockResolvedValue(5);

      await repository.list(5, {
        status: 'unfinished',
        limit: 10,
        cursor: { itemOrder: null, todoid: 3 },
      });

      expect(tbltodos.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            staffid: 5,
            finished: false,
            OR: [
              { item_order: { not: null } },
              {
                item_order: null,
                todoid: { gt: 3 },
              },
            ],
          },
          orderBy: [{ item_order: 'asc' }, { todoid: 'asc' }],
          take: 11,
        }),
      );
    });

    it('uses the cursor to fetch rows after a non-null item order', async () => {
      const { repository, tbltodos } = build();
      tbltodos.findMany.mockResolvedValue([dbRow({ todoid: 8, item_order: 5 })]);
      tbltodos.count.mockResolvedValue(5);

      await repository.list(5, {
        status: 'unfinished',
        limit: 10,
        cursor: { itemOrder: 4, todoid: 3 },
      });

      expect(tbltodos.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            staffid: 5,
            finished: false,
            OR: [
              { item_order: { gt: 4 } },
              {
                item_order: 4,
                todoid: { gt: 3 },
              },
            ],
          },
          orderBy: [{ item_order: 'asc' }, { todoid: 'asc' }],
          take: 11,
        }),
      );
    });

    it('fetches one extra row to detect another page and returns only the requested limit', async () => {
      const { repository, tbltodos } = build();

      tbltodos.findMany.mockResolvedValue(
        Array.from({ length: 4 }, (_, index) => dbRow({ todoid: index + 1, item_order: index })),
      );
      tbltodos.count.mockResolvedValue(10);

      const page = await repository.list(5, {
        status: 'unfinished',
        limit: 3,
        cursor: null,
      });

      expect(tbltodos.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 4 }));
      expect(page.items).toHaveLength(3);
      expect(page.hasMore).toBe(true);
      expect(page.total).toBe(10);
    });

    it('reads the finished panel by item order, ascending', async () => {
      const { repository, tbltodos } = build();
      tbltodos.findMany.mockResolvedValue([dbRow({ finished: true, datefinished: DATED })]);
      tbltodos.count.mockResolvedValue(1);

      const page = await repository.list(5, {
        status: 'finished',
        limit: 20,
        cursor: null,
      });

      expect(tbltodos.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { staffid: 5, finished: true },
          orderBy: [{ item_order: 'asc' }, { todoid: 'asc' }],
          take: 21,
        }),
      );

      expect(page.items[0]).toMatchObject({
        finished: true,
        dateFinished: DATED,
      });
    });

    it('reads a boolean finished column the same as a tinyint', async () => {
      const { repository, tbltodos } = build();
      tbltodos.findMany.mockResolvedValue([dbRow({ finished: true })]);
      tbltodos.count.mockResolvedValue(1);

      const page = await repository.list(5, {
        status: 'finished',
        limit: 20,
        cursor: null,
      });

      expect(page.items[0]?.finished).toBe(true);
    });
  });

  describe('findById', () => {
    it("filters by the caller's staff id, so another member's to do is null", async () => {
      const { repository, tbltodos } = build();
      tbltodos.findFirst.mockResolvedValue(null);

      expect(await repository.findById(5, 9)).toBeNull();

      expect(tbltodos.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { todoid: 9, staffid: 5 },
        }),
      );
    });

    it('answers the row in its stored form', async () => {
      const { repository, tbltodos } = build();
      tbltodos.findFirst.mockResolvedValue(dbRow({ todoid: 9 }));

      expect(await repository.findById(5, 9)).toMatchObject({
        id: 9,
        staffId: 5,
      });
    });
  });

  describe('create', () => {
    it('inserts an unfinished to do with an empty order', async () => {
      const { repository, tbltodos } = build();
      tbltodos.create.mockResolvedValue(dbRow({ todoid: 11, item_order: null }));

      const row = await repository.create({
        staffId: 5,
        description: 'Call Ali',
        dateAdded: DATED,
      });

      expect(tbltodos.aggregate).not.toHaveBeenCalled();

      expect(tbltodos.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            description: 'Call Ali',
            staffid: 5,
            dateadded: DATED,
            finished: false,
            datefinished: null,
            item_order: null,
          },
        }),
      );

      expect(row.id).toBe(11);
    });

    it('starts with an empty order when the caller has no to do yet', async () => {
      const { repository, tbltodos } = build();
      tbltodos.create.mockResolvedValue(dbRow({ item_order: null }));

      await repository.create({
        staffId: 5,
        description: 'x',
        dateAdded: DATED,
      });

      const createCall = tbltodos.create.mock.calls[0]?.[0] as
        { data: { item_order: number | null } } | undefined;

      expect(createCall?.data.item_order).toBeNull();
    });
  });

  describe('updateDescription', () => {
    it("updates the caller's own row and returns it", async () => {
      const { repository, tbltodos } = build();
      tbltodos.update.mockResolvedValue(dbRow({ description: 'New' }));

      const row = await repository.updateDescription(5, 1, 'New');

      expect(tbltodos.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { todoid: 1, staffid: 5 },
          data: { description: 'New' },
        }),
      );

      expect(row?.description).toBe('New');
      expect(tbltodos.update).toHaveBeenCalledOnce();
      expect(tbltodos.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when Prisma reports P2025', async () => {
      const { repository, tbltodos } = build();
      tbltodos.update.mockRejectedValue(
        Object.assign(new Error('Record not found'), { code: 'P2025' }),
      );

      expect(await repository.updateDescription(5, 1, 'New')).toBeNull();
      expect(tbltodos.update).toHaveBeenCalledOnce();
      expect(tbltodos.findFirst).not.toHaveBeenCalled();
    });

    it('rethrows errors other than P2025', async () => {
      const { repository, tbltodos } = build();
      const error = new Error('Database error');
      tbltodos.update.mockRejectedValue(error);

      await expect(repository.updateDescription(5, 1, 'New')).rejects.toBe(error);
    });
  });

  describe('setFinished', () => {
    it('finishes or reopens with the supplied date', async () => {
      const { repository, tbltodos } = build();

      tbltodos.update
        .mockResolvedValueOnce(dbRow({ finished: true, datefinished: DATED }))
        .mockResolvedValueOnce(dbRow({ finished: false, datefinished: DATED }));

      await repository.setFinished(5, 1, true, DATED);

      expect(tbltodos.update).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: { todoid: 1, staffid: 5 },
          data: { finished: true, datefinished: DATED },
        }),
      );

      await repository.setFinished(5, 1, false, DATED);

      expect(tbltodos.update).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: { todoid: 1, staffid: 5 },
          data: { finished: false, datefinished: DATED },
        }),
      );

      expect(tbltodos.update).toHaveBeenCalledTimes(2);
      expect(tbltodos.findFirst).not.toHaveBeenCalled();
    });

    it('returns null when Prisma reports P2025', async () => {
      const { repository, tbltodos } = build();
      tbltodos.update.mockRejectedValue(
        Object.assign(new Error('Record not found'), { code: 'P2025' }),
      );

      expect(await repository.setFinished(5, 1, true, DATED)).toBeNull();
    });

    it('rethrows errors other than P2025', async () => {
      const { repository, tbltodos } = build();
      const error = new Error('Database error');
      tbltodos.update.mockRejectedValue(error);

      await expect(repository.setFinished(5, 1, true, DATED)).rejects.toBe(error);
    });
  });

  describe('reorder', () => {
    it('updates the requested order and finished state in one transaction', async () => {
      const { repository, tbltodos, transaction } = build();
      tbltodos.findMany.mockResolvedValue([{ todoid: 8 }, { todoid: 3 }]);
      tbltodos.updateMany.mockResolvedValue({ count: 1 });

      const result = await repository.reorder(5, true, [8, 3]);

      expect(result).toBe(true);
      expect(transaction).toHaveBeenCalledOnce();

      expect(tbltodos.findMany).toHaveBeenCalledWith({
        where: {
          staffid: 5,
          finished: true,
          todoid: { in: [8, 3] },
        },
        select: { todoid: true },
      });

      expect(tbltodos.updateMany).toHaveBeenNthCalledWith(1, {
        where: { todoid: 8, staffid: 5 },
        data: { item_order: 0, finished: true },
      });

      expect(tbltodos.updateMany).toHaveBeenNthCalledWith(2, {
        where: { todoid: 3, staffid: 5 },
        data: { item_order: 1, finished: true },
      });
    });

    it('does not update anything when an id is missing or belongs to another member', async () => {
      const { repository, tbltodos, transaction } = build();
      tbltodos.findMany.mockResolvedValue([{ todoid: 8 }]);

      const result = await repository.reorder(5, false, [8, 3]);

      expect(result).toBe(false);
      expect(transaction).toHaveBeenCalledOnce();
      expect(tbltodos.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('remove and countUnfinished', () => {
    it("deletes the caller's own row only; false when nothing was deleted", async () => {
      const { repository, tbltodos } = build();

      tbltodos.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

      expect(await repository.remove(5, 1)).toBe(true);
      expect(await repository.remove(5, 1)).toBe(false);

      expect(tbltodos.deleteMany).toHaveBeenCalledWith({
        where: { todoid: 1, staffid: 5 },
      });
    });

    it("counts the caller's own unfinished to do's", async () => {
      const { repository, tbltodos } = build();
      tbltodos.count.mockResolvedValue(3);

      expect(await repository.countUnfinished(5)).toBe(3);

      expect(tbltodos.count).toHaveBeenCalledWith({
        where: { staffid: 5, finished: false },
      });
    });
  });
});
