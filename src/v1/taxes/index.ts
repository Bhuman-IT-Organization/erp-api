/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { TaxesFacade } from './facade/taxes.facade.js';
export type { Tax, TaxId } from './model/taxes.model.js';
