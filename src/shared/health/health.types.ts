import { z } from 'zod';

/** Outcome of one probe. Never carries a message: the body must not leak internals (threat T-1.2-06). */
export const healthCheckResultSchema = z.enum(['ok', 'error']);
export type HealthCheckResult = z.infer<typeof healthCheckResultSchema>;

/** A named probe registered with HealthService (db, redis). `breakers` is reserved. */
export interface HealthCheck {
  readonly name: string;
  run(): Promise<HealthCheckResult>;
}

/** Circuit state per external system — the state word only, no counts or messages (T-1.3-65). */
export const breakerStatesSchema = z.record(z.string(), z.enum(['closed', 'open', 'half-open']));
export type BreakerStates = z.infer<typeof breakerStatesSchema>;

/**
 * Body of GET /health and GET /api/v1/health (200, or 503 with the same shape). `status` is
 * computed from the probes only: an open breaker is the upstream's outage, not ours, so it never
 * degrades the api (ADR-0031 §3). `checks.<probe>` is a probe result; `checks.breakers` the
 * breaker states. The zod schema is the one declaration — the type and the OpenAPI document
 * (`@ApiZod` on the controller, BE-23) both derive from it.
 */
export const healthReportSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.record(z.string(), z.union([healthCheckResultSchema, breakerStatesSchema])),
});
export type HealthReport = z.infer<typeof healthReportSchema>;
