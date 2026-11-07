import { describe, it, expect, vi } from 'vitest';
import { AnnouncementsTransport } from '../service/announcements.transport.js';

describe('AnnouncementsTransport', () => {
  it('instantiates correctly with all dependencies', () => {
    const transport = new AnnouncementsTransport(
      { publish: vi.fn() },
      { namesOf: vi.fn().mockResolvedValue(new Map()) } as never,
      { get: vi.fn().mockResolvedValue('UTC') } as never,
    );
    expect(transport).toBeDefined();
  });
});
