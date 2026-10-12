/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out the model, never the wire DTO, and
 * replacing it with an HTTP or queue adapter is what makes extraction to a service atomic.
 */
import { Injectable } from '@nestjs/common';
import type { ExpenseCategory } from '../model/expense-categories.model.js';
import {
  ExpenseCategoriesService,
  type ExpenseCategoriesDescription,
} from '../service/expense-categories.service.js';

/** What other modules may call: the module's description and one model by id. */
@Injectable()
export class ExpenseCategoriesFacade {
  constructor(private readonly service: ExpenseCategoriesService) {}

  describe(): ExpenseCategoriesDescription {
    return this.service.describe();
  }

  /** One category in its stored form, or `null` when the id is missing. */
  findById(id: number): Promise<ExpenseCategory | null> {
    return this.service.findById(id);
  }
}
