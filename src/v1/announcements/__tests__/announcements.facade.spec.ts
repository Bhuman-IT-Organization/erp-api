import { describe, expect, it, vi } from 'vitest';
import { AnnouncementsFacade } from '../facade/announcements.facade.js';
import { ANNOUNCEMENTS_FACADE_MAX_ROWS } from '../model/announcements.model.js';
import { AnnouncementsService } from '../service/announcements.service.js';
import { AnnouncementsTransformer } from '../service/announcements.transformer.js';
import { AnnouncementsTransport } from '../service/announcements.transport.js';
import { AnnouncementsValidator } from '../service/announcements.validator.js';
import { asRepository, seededStore, SEED_ANNOUNCEMENTS } from './fakes.js';

function build() {
  const repo = seededStore();
  const service = new AnnouncementsService(
    new AnnouncementsValidator(),
    asRepository(repo),
    new AnnouncementsTransformer(),
    new AnnouncementsTransport({ publish: vi.fn() }, {
      namesOf: vi.fn().mockResolvedValue(new Map()),
    } as never),
    { log: vi.fn() } as never,
  );
  const facade = new AnnouncementsFacade(service);
  return { facade, repo };
}

describe('AnnouncementsFacade', () => {
  it('describes the module', () => {
    expect(build().facade.describe()).toEqual({ module: 'announcements', version: 1 });
  });

  it('findById answers the entity with the date still a Date, or null', async () => {
    const { facade } = build();
    const found = await facade.findById(1);
    expect(found).toEqual(SEED_ANNOUNCEMENTS[0]);
    expect(found?.dateadded).toBeInstanceOf(Date);
    expect(await facade.findById(99)).toBeNull();
  });

  it('listAll answers every announcement, the date descending', async () => {
    const rows = await build().facade.listAll();
    expect(rows.map((row) => row.id)).toEqual([3, 2, 1]);
  });

  it('listAll refuses more than the maximum rows, never truncating', async () => {
    const { facade, repo } = build();
    repo.seed(
      Array.from({ length: ANNOUNCEMENTS_FACADE_MAX_ROWS }, (_, i) => ({
        id: 100 + i,
        name: `Bulk ${String(i)}`,
        message: '',
        dateadded: new Date(Date.UTC(2026, 2, 1)),
        showtousers: 0,
        showtostaff: 0,
        showname: 0,
      })),
    );
    await expect(facade.listAll()).rejects.toMatchObject({ code: 'ERP-INTERNAL-0001' });
  });

  it('findByIds answers in the order given, each once, skipping absent ids', async () => {
    const rows = await build().facade.findByIds([3, 1, 3, 99]);
    expect(rows.map((row) => row.id)).toEqual([3, 1]);
  });
});
