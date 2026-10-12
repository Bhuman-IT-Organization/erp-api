/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { PaymentModesFacade } from './facade/payment-modes.facade.js';
export type { PaymentMode, PaymentModeId } from './model/payment-modes.model.js';
