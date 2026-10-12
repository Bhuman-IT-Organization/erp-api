/**
 * Domain events this module subscribes to (ADR-0029). Handlers live in `events/handlers/` and are
 * the only way another module's change reaches this one. None: currencies listen to nothing; other
 * modules' uses reach it through the registered counters (D-41 inverted), not through events.
 */
export const CURRENCIES_SUBSCRIBED_EVENTS = [] as const;
