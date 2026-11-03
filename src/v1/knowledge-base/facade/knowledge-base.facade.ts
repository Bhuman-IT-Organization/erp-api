/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out `KnowledgeBase { id, name }`, never the wire
 * DTO and never `created_by`, and replacing it with an HTTP or queue adapter is what makes
 * extraction to a service atomic.
 *
 * Read only: no method writes, and none asserts the administrator flag, because a module-to-module
 * read has no actor. The purchase, expenses and fixed_equipment migrations read it: `listAll` for a
 * knowledge base picker, `findByIds` for the names a document's ids point at.
 */
import { Injectable } from '@nestjs/common';
import type { KnowledgeBase } from '../model/knowledge-base.model.js';
import {
  KnowledgeBaseService,
  type KnowledgeBaseDescription,
} from '../service/knowledge-base.service.js';

/** What other modules may call: the module's description and three read-only lookups. */
@Injectable()
export class KnowledgeBaseFacade {
  constructor(private readonly service: KnowledgeBaseService) {}

  describe(): KnowledgeBaseDescription {
    return this.service.describe();
  }

  /** One knowledge base, or `null` when the id is missing. */
  findById(id: number): Promise<KnowledgeBase | null> {
    return this.service.findById(id);
  }

  /**
   * Every knowledge base, the name ascending, then the id (the order Perfex's pickers read); refused
   * loudly above `KNOWLEDGE_BASE_FACADE_MAX_ROWS`, never truncated.
   */
  listAll(): Promise<readonly KnowledgeBase[]> {
    return this.service.listAll();
  }

  /** The knowledge base with these ids, in the order given, each once; an absent id is skipped. */
  findByIds(ids: readonly number[]): Promise<readonly KnowledgeBase[]> {
    return this.service.findByIds(ids);
  }
}
