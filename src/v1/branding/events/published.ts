/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes, ids not entities,
 * versioned; published through the `DOMAIN_EVENT_PUBLISHER` port, delivered in-process today and
 * through the transactional outbox once the first
 * cross-module subscriber or job exists. None in wave 0: branding only reads legacy-owned rows and
 * has nothing to announce.
 */
export const BRANDING_PUBLISHED_EVENTS = [] as const;
