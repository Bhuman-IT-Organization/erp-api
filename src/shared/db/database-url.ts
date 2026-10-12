/**
 * Prisma connection-URL pool parameters (ADR-0031 §4). The pool is explicit, never Prisma's
 * `cpus × 2 + 1` default: `withPoolParams` appends `connection_limit`, `pool_timeout`,
 * `connect_timeout` and `socket_timeout` ONLY when the rendered URL lacks them — the environment's
 * budget (erp-infra) wins, `POOL`/`TIMINGS` fill the gap. Prisma's MySQL URL takes the three
 * timeouts in SECONDS. Pure functions: the URL holds the password, so nothing here logs it.
 */

export interface DbTimings {
  readonly connectTimeoutS: number;
  readonly poolTimeoutS: number;
  readonly socketTimeoutS: number;
}

export function withPoolParams(url: string, connectionLimit: number, timings: DbTimings): string {
  const parsed = new URL(url);
  const params = parsed.searchParams;
  const defaults: readonly (readonly [string, number])[] = [
    ['connection_limit', connectionLimit],
    ['pool_timeout', timings.poolTimeoutS],
    ['connect_timeout', timings.connectTimeoutS],
    ['socket_timeout', timings.socketTimeoutS],
  ];
  for (const [name, value] of defaults) {
    if (!params.has(name)) params.set(name, String(value));
  }
  return parsed.toString();
}

function intParam(url: URL, name: string): number | null {
  const raw = url.searchParams.get(name);
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

/** The pool values a URL carries, for the one `prisma pool` boot line (never the URL itself). */
export function describePool(url: string): {
  connectionLimit: number | null;
  poolTimeoutS: number | null;
} {
  const parsed = new URL(url);
  return {
    connectionLimit: intParam(parsed, 'connection_limit'),
    poolTimeoutS: intParam(parsed, 'pool_timeout'),
  };
}
