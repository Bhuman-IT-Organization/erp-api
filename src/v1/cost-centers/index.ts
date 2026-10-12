/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { CostCentersFacade } from './facade/cost-centers.facade.js';
export type { CostCenter, CostCenterId } from './model/cost-centers.model.js';
