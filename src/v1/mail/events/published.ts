/**
 * Domain events this module publishes (ADR-0029). None: a send is a job on `mail.send`, not an
 * event (ADR-0049 decision 4).
 */
export const MAIL_PUBLISHED_EVENTS = [] as const;
