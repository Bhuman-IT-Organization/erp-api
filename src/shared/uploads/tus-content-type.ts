/**
 * A tus `PATCH` carries its chunk as `application/offset+octet-stream`, which Fastify refuses (415)
 * without a parser. This parser accepts it and reads nothing: `UploadsService` streams the raw
 * request into tus. So Fastify's `bodyLimit` never applies to a chunk; tus's `maxSize`
 * (`UPLOAD_MAX_BYTES`) and the purpose's rules do, and `TIMINGS.fastify.requestTimeoutMs` bounds
 * each chunk (2 MiB from erp-web, ADR-0041 §3). Registered in `main.ts` after
 * `registerFastifyPlugins`, before the app listens.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';

/** The tus chunk media type (tus 1.0.0 core). */
export const TUS_CONTENT_TYPE = 'application/offset+octet-stream';

/** Lets a tus chunk reach the controller with its body unread. */
export function registerTusContentType(app: NestFastifyApplication): void {
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser(TUS_CONTENT_TYPE, (_request, _payload, done) => {
      done(null);
    });
}
