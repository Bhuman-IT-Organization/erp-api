/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { LeadSourcesFacade } from './facade/lead-sources.facade.js';
export type { LeadSource, LeadSourceId } from './model/lead-sources.model.js';
