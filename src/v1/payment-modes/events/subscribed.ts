/**
 * Domain events this module subscribes to (ADR-0029). Handlers live in `events/handlers/` and are
 * the only way another module's change reaches this one. None: payment modes listen to nothing.
 */
export const PAYMENT_MODES_SUBSCRIBED_EVENTS = [] as const;
