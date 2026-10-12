# integrations/

Ports and adapters (hexagonal) for every third-party system. Unversioned; vendor adapters live here, never inside a business module. The first port is email (Phase 4.3, ADR-0049); lines marked `[now]` exist, the rest arrives with the integration that needs it.

## Planned tree (approved plan)

```text
src/integrations/
  integrations.module.ts                # [now] @Global(): registers ports -> adapters, exports the port tokens
  ports/                                # interfaces WE own; one per capability, vendor-neutral
    payment-gateway.port.ts             # createCharge, capture, refund, getStatus, verifyWebhook
    sms-provider.port.ts                # send, getDeliveryStatus
    email-provider.port.ts              # [now] EMAIL_PROVIDER: send(message) -> SendResult, configured
    storage-provider.port.ts            # put, get, signedUrl
    tax-service.port.ts, shipping-provider.port.ts, accounting-sync.port.ts (added as needed)
  adapters/
    payment/  midtrans.adapter.ts, xendit.adapter.ts, stripe.adapter.ts, fake-payment.adapter.ts
    sms/      twilio.adapter.ts, vonage.adapter.ts, fake-sms.adapter.ts
    email/    smtp.adapter.ts           # [now] nodemailer, pooled, inside the email breaker
              smtp-classify.ts          # [now] the SMTP failure table (RESEARCH R2)
              fake-email.adapter.ts     # [now] records messages, answers `next`
              ses.adapter.ts
    storage/  s3.adapter.ts, local-disk.adapter.ts
  webhooks/
    webhooks.controller.ts              # /api/v1/webhooks/:provider ; raw body, signature verification, then enqueue
    webhook-event.processor.ts          # BullMQ processor: idempotent by provider event id, dispatches domain event
  shared/
    base.adapter.ts                     # winston logging, timeout, retry with jittered backoff, circuit breaker, metrics
    integration-error.ts                # ExternalServiceError subclasses with vendor code mapping
    integration-log.repository.ts       # every outbound call and inbound webhook persisted
```

## Rules

1. Business modules import only `ports/*` interfaces, injected via DI tokens (for example `PAYMENT_GATEWAY`). They never import an adapter.
2. `adapters/*` may be imported only from `integrations.module.ts` and from tests. The architecture block in `eslint.config.mjs` enforces this.
3. Every port has a `fake-*` adapter, used in tests, local development and the staging "no real money" mode.
4. Vendor SDKs are dependencies of the adapter file only; vendor types never leak past the adapter.

## Resilience

- `email`: the SMTP adapter runs every send inside the `email` breaker; only connection failures, timeouts and reply 421 count on it, a refused recipient or message is a value. No retry wrapper around the send: the `mail.send` queue (`RETRY_POLICIES.mailSend`) is the only retry layer. No abort-signal deadline: SMTP has no AbortSignal, so nodemailer's connection, greeting, socket and DNS timeouts come from `TIMINGS.mail.smtp` (the documented BE-18 divergence, ADR-0049 decision 9). The pool is `POOL.smtp` per worker replica.

## Dependencies

- nodemailer 10.0.13 (MIT-0, approved by name in ADR-0049): the SMTP client of the email adapter; no other file imports it.
