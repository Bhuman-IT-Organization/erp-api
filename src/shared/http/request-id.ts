/**
 * The `x-request-id` boundary (threat T-2-01/T-2-03).
 *
 * A Fastify `onRequest` hook — registered in `main.ts` immediately after `NestFactory.create`
 * and BEFORE `registerFastifyPlugins`, so the CSRF hook's 403 and every later guard, handler and
 * filter run inside the scope. It takes a valid incoming id or mints a UUID, sets the response
 * header, then opens the `AsyncLocalStorage` scope with `requestContext.run(ctx, done)` — the
 * pattern `@fastify/request-context` uses: `done` runs inside the store, so the rest of the
 * request's async chain inherits it. An id that fails the grammar is replaced, never echoed.
 * The id travels in the response header only, never in a body.
 *
 * Every in-process test app that wants `x-request-id` on its responses registers this at the
 * same point (`create-auth-test-app.ts`, `create-branding-test-app.ts`).
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  REQUEST_ID_HEADER,
  isValidRequestId,
  newRequestId,
  requestContext,
} from '../logger/request-context.js';

export function registerRequestId(app: NestFastifyApplication): void {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (req, reply, done) => {
    const incoming: unknown = req.headers[REQUEST_ID_HEADER];
    const requestId = isValidRequestId(incoming) ? incoming : newRequestId();
    void reply.header(REQUEST_ID_HEADER, requestId);
    requestContext.run({ requestId }, done);
  });
}
