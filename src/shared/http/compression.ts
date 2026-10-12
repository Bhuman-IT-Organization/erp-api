/**
 * Response compression (ADR-0031 §6): the api compresses its own JSON and text responses, gzip
 * and brotli, always on. The threshold is `HTTP.compress.thresholdBytes` (256, not the plugin's
 * 1024) because api bodies are small JSON: `/health` stays raw, the JWKS document and `/me`
 * compress. Nginx passes Accept-Encoding through and does not recompress api locations
 * (erp-infra plan 01.3-03), so every body is compressed exactly once.
 */
import fastifyCompress from '@fastify/compress';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { HTTP } from '../config/http.js';

export async function registerCompression(app: NestFastifyApplication): Promise<void> {
  await app.register(fastifyCompress, {
    global: true,
    encodings: [...HTTP.compress.encodings],
    threshold: HTTP.compress.thresholdBytes,
    customTypes: HTTP.compress.mimeTypes,
  });
}
