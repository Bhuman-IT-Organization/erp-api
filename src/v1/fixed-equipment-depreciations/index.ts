/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { FixedEquipmentDepreciationsFacade } from './facade/fixed-equipment-depreciations.facade.js';
export type {
  FixedEquipmentDepreciation,
  FixedEquipmentDepreciationsDescription,
} from './model/fixed-equipment-depreciations.model.js';
