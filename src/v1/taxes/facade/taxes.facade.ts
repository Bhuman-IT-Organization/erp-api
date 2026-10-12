/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out `Tax { id, name, rate }`, never the wire
 * DTO, and replacing it with an HTTP or queue adapter is what makes extraction to a service atomic.
 *
 * Read only: no method writes, and none asserts the administrator flag, because a module-to-module
 * read has no actor: `listAll` for a picker's options, `findByIds` for a row's `tax` and `tax2`.
 */
import { Injectable } from '@nestjs/common';
import type { Tax } from '../model/taxes.model.js';
import { TaxesService, type TaxesDescription } from '../service/taxes.service.js';

/** What other modules may call: the module's description and three read-only lookups. */
@Injectable()
export class TaxesFacade {
  constructor(private readonly service: TaxesService) {}

  describe(): TaxesDescription {
    return this.service.describe();
  }

  /** One tax, or `null` when the id is missing. */
  findById(id: number): Promise<Tax | null> {
    return this.service.findById(id);
  }

  /** Every tax, the rate ascending, then the id; refused loudly above `TAXES_FACADE_MAX_ROWS`. */
  listAll(): Promise<readonly Tax[]> {
    return this.service.listAll();
  }

  /** The taxes with these ids, in the order given, each once; an absent id is skipped. */
  findByIds(ids: readonly number[]): Promise<readonly Tax[]> {
    return this.service.findByIds(ids);
  }
}
