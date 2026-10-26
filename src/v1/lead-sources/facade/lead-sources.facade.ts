/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out `LeadSource { id, name }`, never the wire
 * DTO and never `created_by`, and replacing it with an HTTP or queue adapter is what makes
 * extraction to a service atomic.
 *
 * Read only: no method writes, and none asserts the administrator flag, because a module-to-module
 * read has no actor. Other modules can use `listAll` for a lead-source picker and `findByIds` to
 * resolve the names referenced by existing records.
 */
import { Injectable } from '@nestjs/common';
import type { LeadSource } from '../model/lead-sources.model.js';
import {
  LeadSourcesService,
  type LeadSourcesDescription,
} from '../service/lead-sources.service.js';

/** What other modules may call: the module's description and three read-only lookups. */
@Injectable()
export class LeadSourcesFacade {
  constructor(private readonly service: LeadSourcesService) {}

  describe(): LeadSourcesDescription {
    return this.service.describe();
  }

  /** One lead source, or `null` when the id is missing. */
  findById(id: number): Promise<LeadSource | null> {
    return this.service.findById(id);
  }

  /**
   * Every lead source, the name ascending, then the id (the order Perfex's pickers read); refused
   * loudly above the facade's maximum, never truncated.
   */
  listAll(): Promise<readonly LeadSource[]> {
    return this.service.listAll();
  }

  /** The lead sources with these ids, in the order given, each once; an absent id is skipped. */
  findByIds(ids: readonly number[]): Promise<readonly LeadSource[]> {
    return this.service.findByIds(ids);
  }
}
