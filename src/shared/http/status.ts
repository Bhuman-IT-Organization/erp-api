/**
 * Named HTTP status codes for the places a controller or the OpenAPI helper must spell one
 * (`@HttpCode`, `@ApiZod({ responses })`): `@typescript-eslint/no-magic-numbers` (scope 12)
 * rejects the literal. Error statuses are never chosen here — they come from `ERROR_CODES`.
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
} as const;

const FIRST_SUCCESS = 200;
const FIRST_REDIRECT = 300;

/** `true` for a 2xx status. */
export function isSuccessStatus(status: number): boolean {
  return status >= FIRST_SUCCESS && status < FIRST_REDIRECT;
}
