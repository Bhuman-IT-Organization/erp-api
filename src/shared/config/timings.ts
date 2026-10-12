/**
 * The one home of duration and threshold constants (ADR-0031 §1; approved plan "config-driven
 * timers"). Add a group per concern; never scatter magic numbers. Env holds deployment-varying
 * values only; TTLs and timeouts are code.
 *
 * `fastify.keepAliveTimeoutMs` must stay above Nginx's upstream `keepalive_timeout`
 * (erp-infra `nginx/local/default.conf`) — change both together.
 */
export const TIMINGS = Object.freeze({
  auth: Object.freeze({
    accessTokenTtlMs: 15 * 60_000,
    refreshTokenTtlMs: 30 * 24 * 60 * 60_000,
    lockoutThreshold: 5, // failures before the first lock
    lockoutBaseMs: 60_000, // first lock: 1 min; doubles per further failure
    lockoutMaxMs: 15 * 60_000, // cap
    lockoutWindowMs: 15 * 60_000, // failure counter TTL
    versionCacheMs: 5_000, // guard-side L1 cache of auth:user:{id}:version (diagram step)
    jwksCacheMaxAgeS: 300, // Cache-Control on /.well-known/jwks.json
  }),
  branding: Object.freeze({
    cacheMs: 60_000, // service-side memo of the settings rows; a logo change shows within a minute
    cacheMaxAgeS: 60, // Cache-Control on /api/v1/branding
  }),
  breaker: Object.freeze({
    // ADR-0031 §3 — per external system; opossum option names in comments
    volumeThreshold: 5, // calls in the window before the ratio is judged (volumeThreshold)
    errorThresholdPercentage: 50, // ratio that opens it (errorThresholdPercentage)
    rollingWindowMs: 60_000, // the window (rollingCountTimeout)
    halfOpenAfterMs: 10_000, // resetTimeout; overridable outside production
  }),
  db: Object.freeze({
    // Prisma MySQL URL parameters are in seconds
    connectTimeoutS: 5,
    poolTimeoutS: 10,
    socketTimeoutS: 5, // ADR-0031 §1: db query 5 s
  }),
  redis: Object.freeze({
    connectTimeoutMs: 2_000,
    commandTimeoutMs: 1_000, // ADR-0031 §1: Redis command 1 s
    maxRetriesPerRequest: 1,
  }),
  http: Object.freeze({
    legacy: Object.freeze({ timeoutMs: 15_000, probeCacheMs: 5_000 }), // ADR-0031 §1: legacy HTTP 15 s
    vendor: Object.freeze({ timeoutMs: 10_000 }), // vendor HTTP 10 s
  }),
  health: Object.freeze({
    // review WR-03: the dependency budget is deliberately shorter than the probe budget — a client
    // that gives up on its own (ioredis connect/command timeouts) reports the real failure; the
    // registry's `withTimeout` is the backstop for one that cannot (a stalled MySQL socket).
    probeTimeoutMs: 3_000, // upper bound for one registered probe (was HEALTH_PROBE_TIMEOUT_MS)
    dependencyTimeoutMs: 2_000, // per-attempt socket budget handed to dependency clients (was HEALTH_DEPENDENCY_TIMEOUT_MS)
  }),
  fastify: Object.freeze({
    connectionTimeoutMs: 120_000, // socket inactivity backstop, above every proxy timeout
    keepAliveTimeoutMs: 65_000, // MUST stay above Nginx upstream keepalive_timeout (60 s, plan 03)
    requestTimeoutMs: 30_000, // time to receive a whole request; headersTimeout is capped to it by Node
  }),
  uploads: Object.freeze({
    incompleteExpiryMs: 24 * 60 * 60_000, // an unfinished tus upload expires a day after creation (ADR-0041 §7)
    cleanupEveryMs: 60 * 60_000, // the hourly uploads.cleanup job (plan 04.2-04) removes the expired staging files
  }),
  idempotency: Object.freeze({
    inProgressTtlMs: 2 * 60_000, // a claimed key's in-progress window; longer than the slowest keyed handler, so a crashed run frees it (BE-15)
    replayTtlMs: 24 * 60 * 60_000, // a completed request is replayed for 24 h (BE-15 Layer 1)
  }),
  queue: Object.freeze({
    // BullMQ on Redis db 2 (BE-14); job records hold ids only, and expire (T-4.2-18)
    keepCompletedS: 24 * 60 * 60, // a completed job's record is kept one day
    keepFailedS: 7 * 24 * 60 * 60, // a failed job's record is kept seven days (its DLQ entry stays until replayed)
    closeTimeoutMs: 10_000, // a worker finishing its active jobs on shutdown, then closed by force
  }),
  mail: Object.freeze({
    // ADR-0049: the shared mail sender; SMTP has no AbortSignal, so nodemailer's own stage timeouts are the deadline
    smtp: Object.freeze({
      connectionTimeoutMs: 10_000, // TCP connect to the SMTP server (connectionTimeout)
      greetingTimeoutMs: 10_000, // the server's greeting after connect (greetingTimeout)
      socketTimeoutMs: 30_000, // inactivity on an open SMTP socket (socketTimeout)
      dnsTimeoutMs: 5_000, // resolving SMTP_HOST (dnsTimeout)
    }),
    serverStateTtlMs: 86_400_000, // mail:server:unreachableSince can never stick longer than a day
    sweepEveryMs: 300_000, // mail.sweep cadence
    sweepAfterMs: 300_000, // a row queued this long without a job is re-added
    purgeEveryMs: 86_400_000, // mail.purge cadence
    purgeBatchSize: 1_000, // rows deleted per statement
    logRetentionMonths: 12, // D-09
    testWindowMs: 600_000, // test-send counting window (D-10)
    testMaxPerWindow: 5, // test sends per member in one window (D-10)
    serverReplyMaxChars: 1_000, // the tblmail_sent_emails.server_reply column
  }),
});

export type Timings = typeof TIMINGS;
