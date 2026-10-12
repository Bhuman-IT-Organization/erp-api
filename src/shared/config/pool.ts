/**
 * Connection-pool budget per replica (ADR-0031 §4). Sized explicitly, never Prisma's
 * `cpus × 2 + 1` default, which changes with the host and is never checked against MySQL.
 *
 * erp-infra's README "Pool budget" section sums replicas × api + workers × worker + legacy's own
 * connections against MySQL `max_connections` − headroom, per environment. `withPoolParams`
 * (`shared/db/database-url.ts`) applies this only when the rendered `DATABASE_URL` carries no
 * `connection_limit` — the environment's budget wins, this is the floor.
 */
export const POOL = Object.freeze({
  db: Object.freeze({ api: 10, worker: 5 }), // per replica
  smtp: Object.freeze({ maxConnections: 2, maxMessages: 100 }), // ADR-0049: nodemailer pool per worker replica; small shared-hosting relays refuse more
});

export type Pool = typeof POOL;
