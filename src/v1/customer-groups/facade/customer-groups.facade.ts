/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out `CustomerGroup { id, name }`, never the
 * wire DTO, and replacing it with an HTTP or queue adapter is what makes extraction to a service
 * atomic.
 *
 * Read only: no method writes, and none asserts the administrator flag, because a module-to-module
 * read has no actor. The customers migration reads it: `listAll` for a group picker, `findByIds`
 * for the names a customer's group ids point at.
 */
import { Injectable } from '@nestjs/common';
import type { CustomerGroup } from '../model/customer-groups.model.js';
import {
  CustomerGroupsService,
  type CustomerGroupsDescription,
} from '../service/customer-groups.service.js';

/** What other modules may call: the module's description and three read-only lookups. */
@Injectable()
export class CustomerGroupsFacade {
  constructor(private readonly service: CustomerGroupsService) {}

  describe(): CustomerGroupsDescription {
    return this.service.describe();
  }

  /** One customer group, or `null` when the id is missing. */
  findById(id: number): Promise<CustomerGroup | null> {
    return this.service.findById(id);
  }

  /**
   * Every customer group, the name ascending, then the id (the order Perfex's pickers read);
   * refused loudly above `CUSTOMER_GROUPS_FACADE_MAX_ROWS`, never truncated.
   */
  listAll(): Promise<readonly CustomerGroup[]> {
    return this.service.listAll();
  }

  /** The customer groups with these ids, in the order given, each once; an absent id is skipped. */
  findByIds(ids: readonly number[]): Promise<readonly CustomerGroup[]> {
    return this.service.findByIds(ids);
  }
}
