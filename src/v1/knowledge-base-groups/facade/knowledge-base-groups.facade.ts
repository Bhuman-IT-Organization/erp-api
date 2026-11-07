import { Injectable } from '@nestjs/common';
import type { KnowledgeBaseGroup } from '../model/knowledge-base-groups.model.js';
import {
  KnowledgeBaseGroupsService,
  type KnowledgeBaseGroupsDescription,
} from '../service/knowledge-base-groups.service.js';

/** What other modules may call: the module's description and read-only lookups. */
@Injectable()
export class KnowledgeBaseGroupsFacade {
  constructor(private readonly service: KnowledgeBaseGroupsService) {}

  /** Module description and version. */
  describe(): KnowledgeBaseGroupsDescription {
    return this.service.describe();
  }

  /** One knowledge base group, or `null` when the id is missing. */
  findById(id: number): Promise<KnowledgeBaseGroup | null> {
    return this.service.findById(id);
  }

  /** All knowledge base groups bounded by facade max rows. */
  listAll(): Promise<readonly KnowledgeBaseGroup[]> {
    return this.service.listAll();
  }

  /** Knowledge base groups matching the given ids. */
  findByIds(ids: readonly number[]): Promise<readonly KnowledgeBaseGroup[]> {
    return this.service.findByIds(ids);
  }
}
