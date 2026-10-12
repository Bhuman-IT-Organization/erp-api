/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { DepartmentsFacade } from './facade/departments.facade.js';
export type { DepartmentName } from './model/departments.model.js';
export type {
  DepartmentStaffDirectory,
  DepartmentUsageCounter,
} from './service/department-links.registry.js';
