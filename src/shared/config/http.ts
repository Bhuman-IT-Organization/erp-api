/**
 * TIMINGS-adjacent HTTP config (ADR-0031 §6): the api compresses its own responses exactly once.
 * Nginx passes `Accept-Encoding` through and does not recompress api locations (erp-infra
 * `nginx/local/default.conf`, `gzip off` on the `node_api` upstream).
 */
export const HTTP = Object.freeze({
  compress: Object.freeze({
    /** Preference order; @fastify/compress negotiates against Accept-Encoding. */
    encodings: ['br', 'gzip'] as const,
    /**
     * Below this the encoding header outweighs the gain: `/health` (~80 B) stays raw, the JWKS
     * document (~450 B) and `/me` compress. Deliberately under the plugin's 1024 default because
     * api bodies are small JSON.
     */
    thresholdBytes: 256,
    /** `customTypes` for the plugin: JSON, problem+json and every text type. */
    mimeTypes: /^(application\/(json|problem\+json)|text\/.+)$/,
  }),
});

export type Http = typeof HTTP;
