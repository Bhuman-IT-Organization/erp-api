/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out `Currency { id, name, symbol,
 * decimalSeparator, thousandSeparator, placement, isBase }`, never the wire DTO or a count, and
 * replacing it with an HTTP or queue adapter is what makes extraction to a service atomic.
 *
 * Two reads (D-44) and one registration (D-41 inverted). No method writes a currency, and none
 * asserts the administrator flag, because a module-to-module call has no actor. Branding reads
 * `baseCurrency()`; a module that keeps its own rows naming a currency registers its counter
 * through `registerUsage` from its own `onModuleInit`.
 */
import { Injectable } from '@nestjs/common';
import type { Currency } from '../model/currencies.model.js';
import { CurrenciesService, type CurrenciesDescription } from '../service/currencies.service.js';
import type { CurrencyUsageCounter } from '../service/currency-usage.registry.js';

/** What other modules may call: the description, the two reads and the usage registration. */
@Injectable()
export class CurrenciesFacade {
  constructor(private readonly service: CurrenciesService) {}

  describe(): CurrenciesDescription {
    return this.service.describe();
  }

  /**
   * Registers one of the calling module's read-only usage counters (D-41 inverted). Call it from
   * your module's `onModuleInit`, so it is registered before any request. Throws on a malformed
   * counter or a key already registered, so a bad registration fails at boot. The counter answers
   * one non-negative integer for a currency id, never ids or prices, and never writes; a delete is
   * refused (`ERP-CURRENCIES-0003`) and a code change locked (`ERP-CURRENCIES-0005`) while it
   * answers more than 0, and a counter that fails refuses both.
   */
  registerUsage(counter: CurrencyUsageCounter): void {
    this.service.registerUsage(counter);
  }

  /**
   * Every currency, the id ascending; refused loudly (`ERP-INTERNAL-0001`) above
   * `CURRENCIES_FACADE_MAX_ROWS`, never truncated.
   */
  listAll(): Promise<readonly Currency[]> {
    return this.service.listAll();
  }

  /** The base currency: the first `isdefault` row by id, or `null` when none is set. */
  baseCurrency(): Promise<Currency | null> {
    return this.service.baseCurrency();
  }
}
