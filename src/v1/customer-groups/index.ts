/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { CustomerGroupsFacade } from './facade/customer-groups.facade.js';
export type { CustomerGroup, CustomerGroupId } from './model/customer-groups.model.js';
