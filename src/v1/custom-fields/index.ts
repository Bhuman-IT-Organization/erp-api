/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { CustomFieldsFacade } from './facade/custom-fields.facade.js';
export type {
  CustomFieldDefinition,
  CustomFieldEntity,
  CustomFieldType,
  CustomFieldValue,
} from './model/custom-fields.model.js';
