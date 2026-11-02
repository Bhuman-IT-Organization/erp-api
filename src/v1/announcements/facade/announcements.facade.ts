/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out `Announcement`, never the wire DTO, and
 * replacing it with an HTTP or queue adapter is what makes extraction to a service atomic.
 *
 * Read only: no method writes, and none asserts the administrator flag, because a module-to-module
 * read has no actor. A later portal or dashboard wave reads it: `listAll` for the announcements a
 * signed-in member or contact sees, `findByIds` for the names other records point at.
 */
import { Injectable } from '@nestjs/common';
import type { Announcement } from '../model/announcements.model.js';
import {
  AnnouncementsService,
  type AnnouncementsDescription,
} from '../service/announcements.service.js';

/** What other modules may call: the module's description and three read-only lookups. */
@Injectable()
export class AnnouncementsFacade {
  constructor(private readonly service: AnnouncementsService) {}

  describe(): AnnouncementsDescription {
    return this.service.describe();
  }

  /** One announcement, or `null` when the id is missing. */
  findById(id: number): Promise<Announcement | null> {
    return this.service.findById(id);
  }

  /**
   * Every announcement, the date descending then the id (the order Perfex's portal reads);
   * refused loudly above `ANNOUNCEMENTS_FACADE_MAX_ROWS`, never truncated.
   */
  listAll(): Promise<readonly Announcement[]> {
    return this.service.listAll();
  }

  /** The announcements with these ids, in the order given, each once; an absent id is skipped. */
  findByIds(ids: readonly number[]): Promise<readonly Announcement[]> {
    return this.service.findByIds(ids);
  }
}
