/**
 * Domain events this module publishes (ADR-0029). None: the module only reads `tbldepartments`
 * (Perfex's table; Perfex's `admin/departments` screen is its only writer), so no change happens
 * here to announce. The README's "Events published" section says None (the module-shape spec keeps
 * the two in step).
 */
export const DEPARTMENTS_PUBLISHED_EVENTS = [] as const;
