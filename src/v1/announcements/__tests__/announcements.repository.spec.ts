import { describe, expect, it, vi } from 'vitest';
import {
  ANNOUNCEMENTS_FACADE_MAX_ROWS,
  type AnnouncementsListRequest,
} from '../model/announcements.model.js';
import { AnnouncementsRepository } from '../repository/announcements.repository.js';

const JAN = new Date('2026-01-05T09:00:00.000Z');
const FEB = new Date('2026-02-10T14:30:00.000Z');

function raw(id: number, dateadded: Date = JAN) {
  return {
    announcementid: id,
    userid: 'Test Staff',
    name: `Announcement ${String(id)}`,
    message: null,
    dateadded,
    showtousers: 1,
    showtostaff: 0,
    showname: 1,
  };
}

function stub(over: Record<string, ReturnType<typeof vi.fn>> = {}) {
  const delegate = {
    findMany: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    ...over,
  };
  const repository = new AnnouncementsRepository({
    client: { tblannouncements: delegate },
  } as never);
  return { repository, delegate };
}

function request(over: Partial<AnnouncementsListRequest> = {}): AnnouncementsListRequest {
  return { search: null, sortField: 'dateadded', order: 'desc', cursor: null, limit: 25, ...over };
}

describe('AnnouncementsRepository: findById, create, update, remove', () => {
  it('findById reads one row by announcementid and maps it to the model', async () => {
    const { repository, delegate } = stub({ findFirst: vi.fn().mockResolvedValue(raw(7)) });
    expect(await repository.findById(7)).toEqual({
      id: 7,
      name: 'Announcement 7',
      message: null,
      dateadded: JAN,
      showtousers: 1,
      showtostaff: 0,
      showname: 1,
    });
    expect(delegate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { announcementid: 7 } }),
    );
  });

  it('findById answers null for a missing id, and refuses a row that is not the table shape', async () => {
    expect(await stub().repository.findById(9)).toBeNull();
    const broken = stub({ findFirst: vi.fn().mockResolvedValue({ announcementid: 1 }) });
    await expect(broken.repository.findById(1)).rejects.toThrow();
  });

  it('create stores the fields with the given date and Perfex userid full name', async () => {
    const { repository, delegate } = stub({ create: vi.fn().mockResolvedValue(raw(4, FEB)) });
    const row = await repository.create(
      { name: 'Fuel', message: 'Hi', showtousers: 1, showtostaff: 0, showname: 1 },
      FEB,
      'Ada Lovelace',
    );
    expect(row.id).toBe(4);
    expect(delegate.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Fuel',
          message: 'Hi',
          showtousers: 1,
          showtostaff: 0,
          showname: 1,
          dateadded: FEB,
          userid: 'Ada Lovelace',
        },
      }),
    );
  });

  it('update saves the five fields and never the date', async () => {
    const { repository, delegate } = stub({ update: vi.fn().mockResolvedValue(raw(2)) });
    const row = await repository.update(2, {
      name: 'N',
      message: '',
      showtousers: 0,
      showtostaff: 1,
      showname: 0,
    });
    expect(row?.id).toBe(2);
    expect(delegate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { announcementid: 2 },
        data: { name: 'N', message: '', showtousers: 0, showtostaff: 1, showname: 0 },
      }),
    );
  });

  it('update answers null on Prisma P2025 and rethrows anything else', async () => {
    const patch = { name: 'N', message: '', showtousers: 0, showtostaff: 0, showname: 0 };
    const missing = stub({
      update: vi.fn().mockRejectedValue(Object.assign(new Error('nf'), { code: 'P2025' })),
    });
    expect(await missing.repository.update(404, patch)).toBeNull();
    const down = stub({ update: vi.fn().mockRejectedValue(new Error('lock wait timeout')) });
    await expect(down.repository.update(1, patch)).rejects.toThrow('lock wait timeout');
  });

  it('remove answers true when a row was deleted and false when none was', async () => {
    const hit = stub({ deleteMany: vi.fn().mockResolvedValue({ count: 1 }) });
    expect(await hit.repository.remove(3)).toBe(true);
    expect(hit.delegate.deleteMany).toHaveBeenCalledWith({ where: { announcementid: 3 } });
    expect(await stub().repository.remove(3)).toBe(false);
  });
});

describe('AnnouncementsRepository: listAll and findByIds', () => {
  it('listAll reads the date descending then the id, at most MAX + 1 rows', async () => {
    const { repository, delegate } = stub({
      findMany: vi.fn().mockResolvedValue([raw(3, FEB), raw(1)]),
    });
    const rows = await repository.listAll();
    expect(rows.map((row) => row.id)).toEqual([3, 1]);
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ dateadded: 'desc' }, { announcementid: 'desc' }],
        take: ANNOUNCEMENTS_FACADE_MAX_ROWS + 1,
      }),
    );
  });

  it('listAll refuses MAX + 1 rows loudly (ERP-INTERNAL-0001), never truncating', async () => {
    const many = Array.from({ length: ANNOUNCEMENTS_FACADE_MAX_ROWS + 1 }, (_, i) => raw(i + 1));
    const { repository } = stub({ findMany: vi.fn().mockResolvedValue(many) });
    await expect(repository.listAll()).rejects.toMatchObject({ code: 'ERP-INTERNAL-0001' });
  });

  it('findByIds is one findMany with announcementid in the ids; no ids, no query', async () => {
    const { repository, delegate } = stub({
      findMany: vi.fn().mockResolvedValue([raw(1), raw(3)]),
    });
    expect((await repository.findByIds([1, 3])).map((row) => row.id)).toEqual([1, 3]);
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { announcementid: { in: [1, 3] } } }),
    );
    const none = stub();
    expect(await none.repository.findByIds([])).toEqual([]);
    expect(none.delegate.findMany).not.toHaveBeenCalled();
  });
});

describe('AnnouncementsRepository: count and the q match', () => {
  it('no search counts every row', async () => {
    const { repository, delegate } = stub();
    await repository.count(request());
    expect(delegate.count).toHaveBeenCalledWith({ where: {} });
  });

  it('q that is no number matches the name only', async () => {
    const { repository, delegate } = stub();
    await repository.count(request({ search: 'abc' }));
    expect(delegate.count).toHaveBeenCalledWith({
      where: { OR: [{ name: { contains: 'abc' } }] },
    });
  });

  it('an all-digit q also matches the id, unless it is beyond INT', async () => {
    const fits = stub();
    await fits.repository.count(request({ search: '2147483647' }));
    expect(fits.delegate.count).toHaveBeenCalledWith({
      where: { OR: [{ name: { contains: '2147483647' } }, { announcementid: 2_147_483_647 }] },
    });
    const beyond = stub();
    await beyond.repository.count(request({ search: '2147483648' }));
    expect(beyond.delegate.count).toHaveBeenCalledWith({
      where: { OR: [{ name: { contains: '2147483648' } }] },
    });
  });
});

describe('AnnouncementsRepository: list', () => {
  it('pages the date descending by default and answers the pager meta', async () => {
    const count = vi.fn().mockResolvedValueOnce(5).mockResolvedValueOnce(0);
    const { repository, delegate } = stub({
      findMany: vi.fn().mockResolvedValue([raw(3, FEB), raw(2)]),
      count,
    });
    const page = await repository.list(request({ limit: 2 }));
    expect(delegate.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ dateadded: 'desc' }, { announcementid: 'desc' }],
      take: 2,
      select: expect.any(Object) as unknown,
    });
    expect(page.items.map((row) => row.id)).toEqual([3, 2]);
    expect(page.total).toBe(5);
    expect(page.rangeStart).toBe(1);
    expect(page.prevCursor).toBeNull();
    expect(typeof page.nextCursor).toBe('string');
  });

  it('an after cursor on dateadded turns the millis back into a Date in the where clause', async () => {
    const { repository, delegate } = stub();
    await repository.list(
      request({
        cursor: { sort: 'dateadded', key: [FEB.getTime(), 9], direction: 'after' },
      } as unknown as Partial<AnnouncementsListRequest>),
    );
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {},
            {
              OR: [{ dateadded: { lt: FEB } }, { dateadded: FEB, announcementid: { lt: 9 } }],
            },
          ],
        },
      }),
    );
  });

  it('a before cursor reads reversed and answers in order', async () => {
    const { repository, delegate } = stub({
      findMany: vi.fn().mockResolvedValue([raw(1), raw(2, FEB)]),
      count: vi.fn().mockResolvedValue(4),
    });
    const page = await repository.list(
      request({
        cursor: { sort: 'dateadded', key: [FEB.getTime(), 9], direction: 'before' },
      } as unknown as Partial<AnnouncementsListRequest>),
    );
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ dateadded: 'asc' }, { announcementid: 'asc' }] }),
    );
    expect(page.items.map((row) => row.id)).toEqual([2, 1]);
  });

  it('an empty page has no cursors and counts once', async () => {
    const { repository, delegate } = stub({ count: vi.fn().mockResolvedValue(0) });
    const page = await repository.list(request());
    expect(page).toEqual({
      items: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    });
    expect(delegate.count).toHaveBeenCalledTimes(1);
  });
});
