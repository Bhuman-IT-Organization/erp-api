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
    create: vi.fn<(args: { data: { item_order: number } }) => Promise<ReturnType<typeof dbRow>>>(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  };

  const repository = new TodoRepository({ client: { tbltodos } } as never);

  return { repository, tbltodos };
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
        offset: 40,
      });

      expect(tbltodos.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { staffid: 5, finished: false },
          orderBy: [{ item_order: 'asc' }, { todoid: 'asc' }],
          skip: 40,
          take: 20,
        }),
      );
      expect(tbltodos.count).toHaveBeenCalledWith({
        where: { staffid: 5, finished: false },
      });
      expect(page.total).toBe(9);
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

    it('reads the finished panel by date finished, newest first', async () => {
      const { repository, tbltodos } = build();
      tbltodos.findMany.mockResolvedValue([dbRow({ finished: true, datefinished: DATED })]);
      tbltodos.count.mockResolvedValue(1);

      const page = await repository.list(5, {
        status: 'finished',
        limit: 20,
        offset: 0,
      });

      expect(tbltodos.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { staffid: 5, finished: true },
          orderBy: [{ datefinished: 'desc' }, { todoid: 'desc' }],
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
        offset: 0,
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
    it("inserts an unfinished to do at the end of the caller's own order", async () => {
      const { repository, tbltodos } = build();
      tbltodos.aggregate.mockResolvedValue({ _max: { item_order: 4 } });
      tbltodos.create.mockResolvedValue(dbRow({ todoid: 11, item_order: 5 }));

      const row = await repository.create({
        staffId: 5,
        description: 'Call Ali',
        dateAdded: DATED,
      });

      expect(tbltodos.aggregate).toHaveBeenCalledWith({
        where: { staffid: 5 },
        _max: { item_order: true },
      });
      expect(tbltodos.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            description: 'Call Ali',
            staffid: 5,
            dateadded: DATED,
            finished: false,
            datefinished: null,
            item_order: 5,
          },
        }),
      );
      expect(row.id).toBe(11);
    });

    it('starts the order at 1 when the caller has no to do yet', async () => {
      const { repository, tbltodos } = build();
      tbltodos.aggregate.mockResolvedValue({ _max: { item_order: null } });
      tbltodos.create.mockResolvedValue(dbRow());

      await repository.create({
        staffId: 5,
        description: 'x',
        dateAdded: DATED,
      });

      const createCall = tbltodos.create.mock.calls[0]?.[0] as
        { data: { item_order: number } } | undefined;

      expect(createCall?.data.item_order).toBe(1);
    });
  });

  describe('updateDescription', () => {
    it("changes the description of the caller's own row only, and answers it", async () => {
      const { repository, tbltodos } = build();
      tbltodos.updateMany.mockResolvedValue({ count: 1 });
      tbltodos.findFirst.mockResolvedValue(dbRow({ description: 'New' }));

      const row = await repository.updateDescription(5, 1, 'New');

      expect(tbltodos.updateMany).toHaveBeenCalledWith({
        where: { todoid: 1, staffid: 5 },
        data: { description: 'New' },
      });
      expect(row?.description).toBe('New');
    });

    it('is null, and reads nothing back, when no row matched', async () => {
      const { repository, tbltodos } = build();
      tbltodos.updateMany.mockResolvedValue({ count: 0 });

      expect(await repository.updateDescription(5, 1, 'New')).toBeNull();
      expect(tbltodos.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('setFinished', () => {
    it('finishes with the date and reopens with NULL', async () => {
      const { repository, tbltodos } = build();
      tbltodos.updateMany.mockResolvedValue({ count: 1 });
      tbltodos.findFirst.mockResolvedValue(dbRow({ finished: true, datefinished: DATED }));

      await repository.setFinished(5, 1, true, DATED);

      expect(tbltodos.updateMany).toHaveBeenLastCalledWith({
        where: { todoid: 1, staffid: 5 },
        data: { finished: true, datefinished: DATED },
      });

      await repository.setFinished(5, 1, false, null);

      expect(tbltodos.updateMany).toHaveBeenLastCalledWith({
        where: { todoid: 1, staffid: 5 },
        data: { finished: false, datefinished: null },
      });
    });

    it('is null when no row matched', async () => {
      const { repository, tbltodos } = build();
      tbltodos.updateMany.mockResolvedValue({ count: 0 });

      expect(await repository.setFinished(5, 1, true, DATED)).toBeNull();
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
