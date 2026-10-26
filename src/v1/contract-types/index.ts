/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { ContractTypesFacade } from './facade/contract-types.facade.js';
export type { ContractType, ContractTypeId } from './model/contract-types.model.js';
