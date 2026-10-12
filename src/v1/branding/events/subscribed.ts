/**
 * Domain events this module subscribes to (ADR-0029). The handler lives in `events/handlers/` and is
 * the only way another module's change reaches this one.
 *
 * Two, both from `v1/currencies` (W2A-05): the base currency moved (`baseChanged`, D-39) or a
 * currency was edited (`updated`, Currencies planning answer 6: the base's symbol, separators or
 * placement may have changed). Either way branding's memo of `formats.currency` is stale, so the
 * handler drops it and the next read asks `CurrenciesFacade.baseCurrency()` again.
 *
 * **The names are string constants here and not imported from `v1/currencies`**: an event name is
 * a wire contract, not a type (BE-03), and `src/v1/**\/events/*.ts` is the one scope that admits the
 * three-segment dotted grammar (the auth module's `events/subscribed.ts` form).
 */
export const CURRENCIES_EVENTS = {
  /** Another currency became the base: `formats.currency` is another currency now. */
  baseChanged: 'currencies.record.baseChanged',
  /** A currency was edited; when it is the base, its symbol, separators or placement changed. */
  updated: 'currencies.record.updated',
} as const;

export const BRANDING_SUBSCRIBED_EVENTS = [
  CURRENCIES_EVENTS.baseChanged,
  CURRENCIES_EVENTS.updated,
] as const;
