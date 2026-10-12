/**
 * Domain events this module publishes (ADR-0029). None: the module only reads `tblcustomfields` and
 * `tblcustomfieldsvalues`, which are Perfex's (Perfex's Setup > Custom Fields page is the only
 * writer), so it has no change to announce.
 */
export const CUSTOM_FIELDS_PUBLISHED_EVENTS = [] as const;
