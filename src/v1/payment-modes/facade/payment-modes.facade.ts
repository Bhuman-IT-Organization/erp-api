/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out `PaymentMode { id, name, active,
 * invoicesOnly, expensesOnly, selectedByDefault, showOnPdf }`, never the wire DTO or the
 * description, and replacing it with an HTTP or queue adapter is what makes extraction to a service
 * atomic.
 *
 * Read only: no method writes, and none asserts the administrator flag, because a module-to-module
 * read has no actor. The invoices and payments, expenses and purchase migrations read it: `listAll`
 * for a payment mode picker (the caller filters `active`, `invoicesOnly` and `expensesOnly` and
 * merges its own online gateways, as Perfex's `Payment_modes_model::get()` does; D-32: gateways are
 * not merged here), `findByIds` for the names a document's ids point at.
 */
import { Injectable } from '@nestjs/common';
import type { PaymentMode } from '../model/payment-modes.model.js';
import {
  PaymentModesService,
  type PaymentModesDescription,
} from '../service/payment-modes.service.js';

/** What other modules may call: the module's description and three read-only lookups. */
@Injectable()
export class PaymentModesFacade {
  constructor(private readonly service: PaymentModesService) {}

  describe(): PaymentModesDescription {
    return this.service.describe();
  }

  /** One payment mode, or `null` when the id is missing. */
  findById(id: number): Promise<PaymentMode | null> {
    return this.service.findById(id);
  }

  /**
   * Every payment mode, the name ascending, then the id; refused loudly above
   * `PAYMENT_MODES_FACADE_MAX_ROWS`, never truncated.
   */
  listAll(): Promise<readonly PaymentMode[]> {
    return this.service.listAll();
  }

  /** The payment modes with these ids, in the order given, each once; an absent id is skipped. */
  findByIds(ids: readonly number[]): Promise<readonly PaymentMode[]> {
    return this.service.findByIds(ids);
  }
}
