/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out the model, never the wire DTO, and
 * replacing it with an HTTP or queue adapter is what makes extraction to a service atomic.
 */
import { Injectable } from '@nestjs/common';
import type { ExampleItem } from '../model/example-item.model.js';
import {
  ExampleItemService,
  type ExampleItemDescription,
} from '../service/example-item.service.js';

/** What other modules may call: the module's description and one model by id. */
@Injectable()
export class ExampleItemFacade {
  constructor(private readonly service: ExampleItemService) {}

  describe(): ExampleItemDescription {
    return this.service.describe();
  }

  /** One record, whoever owns it (a module reads another's rows under scope `all`), or `null`. */
  findById(id: number): Promise<ExampleItem | null> {
    return this.service.findById(id);
  }
}
