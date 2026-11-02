/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out `ContractType { id, name }`, never the
 * wire DTO and never `created_by`, and replacing it with an HTTP or queue adapter is what makes
 * extraction to a service atomic.
 *
 * Read only: no method writes, and none asserts the administrator flag, because a module-to-module
 * read has no actor.
 */
import { Injectable } from '@nestjs/common';
import type { ContractType } from '../model/contract-types.model.js';
import {
  ContractTypesService,
  type ContractTypesDescription,
} from '../service/contract-types.service.js';

/** What other modules may call: the module's description and three read-only lookups. */
@Injectable()
export class ContractTypesFacade {
  constructor(private readonly service: ContractTypesService) {}

  describe(): ContractTypesDescription {
    return this.service.describe();
  }

  /** One contract type, or `null` when the id is missing. */
  findById(id: number): Promise<ContractType | null> {
    return this.service.findById(id);
  }

  /**
   * Every contract type, the name ascending, then the id (the order Perfex's pickers read); refused
   * loudly above `CONTRACT_TYPES_FACADE_MAX_ROWS`, never truncated.
   */
  listAll(): Promise<readonly ContractType[]> {
    return this.service.listAll();
  }

  /** The contract types with these ids, in the order given, each once; an absent id is skipped. */
  findByIds(ids: readonly number[]): Promise<readonly ContractType[]> {
    return this.service.findByIds(ids);
  }
}
