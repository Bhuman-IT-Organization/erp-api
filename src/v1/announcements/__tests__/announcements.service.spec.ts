import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  AnnouncementsCreatedV1,
  AnnouncementsDeletedV1,
  AnnouncementsUpdatedV1,
} from '../events/published.js';
import { AnnouncementsService } from '../service/announcements.service.js';
import { AnnouncementsTransformer } from '../service/announcements.transformer.js';
import { AnnouncementsTransport } from '../service/announcements.transport.js';
import { AnnouncementsValidator } from '../service/announcements.validator.js';
import { asRepository, seededStore } from './fakes.js';

const NOW = new Date('2026-11-02T10:00:00.000Z');
const ADMIN = { isAdmin: true, staffId: 1 } as unknown as AuthenticatedUser;
const STAFF = { isAdmin: false, staffId: 2 } as unknown as AuthenticatedUser;
const BODY = {
  name: 'Fuel prices',
  message: 'Updated',
  showtousers: true,
  showtostaff: false,
  showname: true,
};

function build() {
  const repo = seededStore();
  const publish = vi.fn().mockResolvedValue(undefined);
  const log = vi.fn();
  const namesOf = vi.fn().mockResolvedValue(new Map([[1, 'Admin Staff']]));
  const service = new AnnouncementsService(
    new AnnouncementsValidator(),
    asRepository(repo),
    new AnnouncementsTransformer(),
    new AnnouncementsTransport({ publish }, { namesOf } as never),
    { log } as unknown as LoggerService,
  );
  service.now = () => NOW;
  return { service, repo, publish, log, namesOf };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('AnnouncementsService: administrators only', () => {
  it.each([
    ['list', (s: AnnouncementsService) => s.list(STAFF, {})],
    ['exportCsv', (s: AnnouncementsService) => s.exportCsv(STAFF, {})],
    ['get', (s: AnnouncementsService) => s.get(STAFF, { id: '1' })],
    ['create', (s: AnnouncementsService) => s.create(STAFF, BODY)],
    ['update', (s: AnnouncementsService) => s.update(STAFF, { id: '1' }, BODY)],
    ['remove', (s: AnnouncementsService) => s.remove(STAFF, { id: '1' })],
  ])('%s answers ERP-AUTH-0005 to a non-administrator and changes nothing', async (_name, call) => {
    const { service, repo, publish, log } = build();
    expect(await codeOf(call(service))).toBe('ERP-AUTH-0005');
    expect(publish).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(await repo.findById(1)).not.toBeNull();
  });
});

describe('AnnouncementsService: reads', () => {
  it('lists the date descending by default, with the pager meta', async () => {
    const { service } = build();
    const page = await service.list(ADMIN, {});
    expect(page.data.map((row) => row.id)).toEqual(['3', '2', '1']);
    expect(page.meta).toMatchObject({
      total: 3,
      rangeStart: 1,
      nextCursor: null,
      prevCursor: null,
    });
    expect(page.meta.exportLimit).toBeGreaterThan(0);
    expect(page.meta.printLimit).toBeGreaterThan(0);
  });

  it('sorts by name and searches the name case-insensitively', async () => {
    const { service } = build();
    expect((await service.list(ADMIN, { sort: 'name' })).data.map((row) => row.id)).toEqual([
      '1',
      '3',
      '2',
    ]);
    expect((await service.list(ADMIN, { q: 'HO' })).data.map((row) => row.id)).toEqual(['3', '2']);
    expect((await service.list(ADMIN, { q: '2' })).data.map((row) => row.id)).toEqual(['2']);
  });

  it('pages with the cursor the previous page answered', async () => {
    const { service } = build();
    const first = await service.list(ADMIN, { limit: '2' });
    expect(first.data.map((row) => row.id)).toEqual(['3', '2']);
    expect(first.meta.nextCursor).not.toBeNull();
    const second = await service.list(ADMIN, { limit: '2', cursor: first.meta.nextCursor });
    expect(second.data.map((row) => row.id)).toEqual(['1']);
    expect(second.meta.nextCursor).toBeNull();
    expect(second.meta.prevCursor).not.toBeNull();
  });

  it('get answers the record, or ERP-CORE-0004, or a 400 for a bad id', async () => {
    const { service } = build();
    expect(await service.get(ADMIN, { id: '1' })).toEqual({
      id: '1',
      name: 'Head Office',
      message: 'Open on Sunday',
      dateadded: '2026-01-05T09:00:00.000Z',
      showtousers: 1,
      showtostaff: 1,
      showname: 0,
    });
    expect(await codeOf(service.get(ADMIN, { id: '404' }))).toBe('ERP-CORE-0004');
    expect(await codeOf(service.get(ADMIN, { id: 'abc' }))).toBe('ERP-VALIDATION-0001');
  });
});

describe('AnnouncementsService: create', () => {
  it('stores the fields dated now, saves the actor full name, publishes after the write and logs one line', async () => {
    const { service, repo, publish, log, namesOf } = build();
    const created = await service.create(ADMIN, BODY);
    expect(created).toEqual({
      id: '4',
      name: 'Fuel prices',
      message: 'Updated',
      dateadded: NOW.toISOString(),
      showtousers: 1,
      showtostaff: 0,
      showname: 1,
    });
    expect(await repo.findById(4)).not.toBeNull();
    expect(namesOf).toHaveBeenCalledWith([1]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toBeInstanceOf(AnnouncementsCreatedV1);
    expect(log).toHaveBeenCalledWith('announcement created', { id: 4 });
  });

  it('stores a missing message as empty and trims blank messages to empty', async () => {
    const { service } = build();
    const withoutMessage = Object.fromEntries(
      Object.entries(BODY).filter(([key]) => key !== 'message'),
    );
    expect((await service.create(ADMIN, withoutMessage)).message).toBe('');
    expect((await service.create(ADMIN, { ...BODY, message: '' })).message).toBe('');
    expect((await service.create(ADMIN, { ...BODY, message: '   ' })).message).toBe('');
  });

  it('accepts a name another announcement holds (Perfex has no uniqueness check)', async () => {
    const { service } = build();
    expect((await service.create(ADMIN, { ...BODY, name: 'Head Office' })).name).toBe(
      'Head Office',
    );
  });

  it('an invalid body is a 400 and neither writes, publishes nor logs', async () => {
    const { service, repo, publish, log } = build();
    expect(await codeOf(service.create(ADMIN, { name: 'x' }))).toBe('ERP-VALIDATION-0001');
    expect(await repo.findById(4)).toBeNull();
    expect(publish).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});

describe('AnnouncementsService: update', () => {
  it('saves the five fields, keeps the date, publishes one event and logs one line', async () => {
    const { service, publish, log } = build();
    const updated = await service.update(ADMIN, { id: '2' }, BODY);
    expect(updated).toEqual({
      id: '2',
      name: 'Fuel prices',
      message: 'Updated',
      dateadded: '2026-01-20T09:00:00.000Z',
      showtousers: 1,
      showtostaff: 0,
      showname: 1,
    });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toBeInstanceOf(AnnouncementsUpdatedV1);
    expect(log).toHaveBeenCalledWith('announcement updated', { id: 2 });
  });

  it('an emptied message is stored as an empty string', async () => {
    const { service } = build();
    expect((await service.update(ADMIN, { id: '1' }, { ...BODY, message: '' })).message).toBe('');
  });

  it('a missing id is ERP-CORE-0004 and neither publishes nor logs', async () => {
    const { service, publish, log } = build();
    expect(await codeOf(service.update(ADMIN, { id: '404' }, BODY))).toBe('ERP-CORE-0004');
    expect(publish).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('an invalid body or id is a 400', async () => {
    const { service } = build();
    expect(await codeOf(service.update(ADMIN, { id: '1' }, {}))).toBe('ERP-VALIDATION-0001');
    expect(await codeOf(service.update(ADMIN, { id: '0' }, BODY))).toBe('ERP-VALIDATION-0001');
  });
});

describe('AnnouncementsService: remove', () => {
  it('deletes the row, publishes one event and logs one line', async () => {
    const { service, repo, publish, log } = build();
    await expect(service.remove(ADMIN, { id: '2' })).resolves.toBeUndefined();
    expect(await repo.findById(2)).toBeNull();
    expect(await repo.findById(1)).not.toBeNull();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toBeInstanceOf(AnnouncementsDeletedV1);
    expect(log).toHaveBeenCalledWith('announcement deleted', { id: 2 });
  });

  it('a missing id is ERP-CORE-0004 and neither publishes nor logs', async () => {
    const { service, publish, log } = build();
    expect(await codeOf(service.remove(ADMIN, { id: '404' }))).toBe('ERP-CORE-0004');
    expect(publish).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
