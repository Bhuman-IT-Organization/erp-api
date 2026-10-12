/**
 * `@erp/contracts` — the shared contract surface of the ERP (ADR-0007, ADR-0033). It builds to
 * `dist/` and is consumed as a normal package; nothing outside this package imports its source.
 */
export * from './permissions.catalogue.js';
export * from './perfex-mapping.js';
export * from './route-gates.js';
export * from './currency-code.js';
