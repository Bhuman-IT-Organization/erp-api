/**
 * Domain events this module publishes (ADR-0029). None yet: Customer Groups publishes nothing, and
 * no module subscribes to a change of a group. When one needs to, add past-tense typed classes
 * extending `DomainEvent` here and list them in the README's "Events published" table.
 */
export const CUSTOMER_GROUPS_PUBLISHED_EVENTS = [] as const;
