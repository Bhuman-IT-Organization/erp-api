/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { CurrenciesFacade } from './facade/currencies.facade.js';
export type { Currency, CurrencyId } from './model/currencies.model.js';
export type { CurrencyUsageCounter } from './service/currency-usage.registry.js';
