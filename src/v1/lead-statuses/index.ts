/**
 * Public surface of the Lead Statuses module.
 * Other modules import only the facade and public types.
 */
export { LeadStatusesFacade } from './facade/lead-statuses.facade.js';

export type { LeadStatus, LeadStatusId } from './model/lead-statuses.model.ts';
