/** Global route prefix. Nginx routes `/api/v1/*` to this service (erp-docs 03-architecture/05-strangler-fig-migration.md). */
export const API_PREFIX = 'api/v1' as const;
/** Health path, served both at `/health` (container healthcheck) and `/api/v1/health` (through Nginx). */
export const HEALTH_PATH = 'health' as const;
/**
 * Every path the health controller answers on. Nest excludes a route from the global prefix per
 * path, so the prefixed variant is spelled out here and both are excluded in main.ts; that is
 * the only way one controller serves `/health` and `/api/v1/health`.
 */
export const HEALTH_ROUTES = [HEALTH_PATH, `${API_PREFIX}/${HEALTH_PATH}`] as const;
/** The JWKS document the legacy container fetches to verify access tokens (ADR-0005). */
export const WELL_KNOWN_JWKS_PATH = '.well-known/jwks.json' as const;
/**
 * Routes served outside `api/v1`: the health pair and the JWKS document the legacy container
 * fetches at `/.well-known/jwks.json` (Nginx routes that exact path to api, plan 01.3-03).
 */
export const UNPREFIXED_ROUTES = [...HEALTH_ROUTES, WELL_KNOWN_JWKS_PATH] as const;
