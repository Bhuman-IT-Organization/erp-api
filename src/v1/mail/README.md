# mail

## Purpose

The shared mail sender (ADR-0049): the email templates Node's modules send, their per-locale wording, the sent-email log and the endpoints of the Setup > Email Templates, Sent emails and Email status screens. Every send is a job on `mail.send`; a mail failure never fails the action that triggered it. Other modules call `MailFacade` (BE-03), never this module's repository.

Started as a copy of erp-docs `05-templates/backend-module` and reshaped to this skeleton by plan 04.3-04.

## Owned tables

Created by `prisma/sql/0004-mail.sql` (ADR-0036), owned `node` (v1/mail) in `prisma/ownership-node.json` (ADR-0035). No other module writes them.

- `tblmail_templates`: one row per template key (the module it belongs to, Active, the formatting notice, who saved it last).
- `tblmail_template_versions`: one subject and plain-text message per template and locale; deleted with its template (the one foreign key, Node to Node).
- `tblmail_sent_emails`: the sent-email log, one row per send (recipient, locale, status, attempts, reason, the server reply for administrators); never the subject, the body or a merge value (D-05); purged after 12 months (D-09).

Read only: `tblemailtemplates` (Perfex's templates, read once per key to seed, D-03). Perfex's `tblmail_queue` is not ours and is never read.

## Facade surface

`MailFacade`:

- `register(definition)`: registers one `MailTemplateDefinition` (key, module, audience, merge fields with their sample keys, fallback keys, resolver); call from the sending module's `onModuleInit` so the worker has it too (Pitfall 12). A duplicate or malformed definition, or a sample or fallback key `MAIL_MESSAGES` lacks, throws at boot.
- `ensureSeeded(key)`: copies Perfex's current wording for a registered key once (each language mapped to a supported locale, HTML to plain text with the formatting flag, Perfex's Active of the English row, the fallback keys when Perfex has no English row); call before the key's first send. A second call or a second process changes nothing.
- `send({ template, sourceRef, dedupeKey? }): Promise<SendOutcome>`: queues one email; NEVER throws. It answers `queued` with the log row's id; `duplicate` with the earlier row's id when the `dedupeKey` was used before; `not_configured` with the id of a row logged as failed when SMTP is unset; `skipped` with `not_registered`, `template_off`, `record_gone` or `no_recipient` (no row, as Perfex skips a disabled template silently); `not_enqueued` when anything threw (logged with the key only; a row already written is re-added by `mail.sweep`). The log row is written before the job `mail-<id>` is added; the template is seeded on its first send. **Call it from your transport AFTER your transaction has committed, never inside it** (RESEARCH Pitfall 8), and pass a `dedupeKey` (`<module>.<event>:<id>:<date>`) when a repeatable job can fire the trigger twice. Nothing to catch.

A definition may name `legacySlug` (plan 04.6-13), Perfex's slug when it does not fit the key grammar (for example `staff-forgot-password` for the key `staff_forgot_password`): `^[a-z][a-z0-9_-]*$`, at most 100 characters, unique among the registered definitions (a malformed or repeated one throws at boot). It is read only to seed: `ensureSeeded` reads Perfex's rows by `legacySlug ?? key`; every other use of the template goes by its key.

A sending slice adds its fallback and sample keys to `MAIL_MESSAGES` in both locales. `index.ts` exports the types `MailTemplateDefinition`, `MergeFieldDefinition`, `ResolvedMail`, `MailAttachment`, `MailAudience`, `MailMessageKey`, `SendRequest` and `SendOutcome`.

## Attachments

ADR-0052 (plan 04.7-05). Any registered template's resolver may answer `attachments` beside `to` and `values`: at most `MAIL_ATTACHMENTS_MAX` (5) `MailAttachment`s, each `{ storageKey, fileName, contentType }`. The key is one the owning module stored itself in Node storage (`STORAGE_KEY`), never a path, a URL or a value from a request; the file name is 1 to 255 characters without a slash, a backslash or a control character; the content type matches `^[a-z]+/[a-z0-9.+-]+$`. They are resolved at send time like the recipient, so a retry or a resend sends what the record says now.

`mail.send` checks the list (`attachmentsProblem`), `stat`s every key, caps the total size at `UPLOAD_MAX_BYTES`, then reads the bytes from `STORAGE` and hands them to `EMAIL_PROVIDER` as `EmailAttachment`s (the SMTP adapter maps them to nodemailer's `attachments` and never reads storage or a path). A key that is gone fails the row as `record_gone` (the job completes); more than five, a bad key, name or type, a total over the cap or a storage error fails it as `unknown` and dead-letters the job. Previews and test sends never carry attachments. The sent-email row gains no column, and the `mail sent` log line carries only the count (`attachments`), never a key or a name. The sender never deletes a stored file: the owning module keeps or purges its own.

## Endpoints

Under `/api/v1/mail` (plan 04.3-07). Every handler carries `JwtAuthGuard, PermissionGuard` (401 `ERP-AUTH-0004`). "view" and "edit" are `settings.emailTemplates.view` and `.edit`, Perfex's `email_templates` pair (D-09); "admin" declares no code and the service asserts the administrator flag first (403 `ERP-AUTH-0005`). A missing row is 404 `ERP-CORE-0004`. `@erp/contracts`' `ROUTE_GATES` declares the five screens; `__tests__/route-gates.spec.ts` compares the handlers with it.

| Method, path                  | Gate  | Answer                  | Notes                                                                                                                                                                                                        |
| ----------------------------- | ----- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET templates`               | view  | 200 list                | keyset; `q`, `sort` (`module` default, `key`), `filter[module][in]`, `filter[translation][eq]=complete\|missing`, `filter[active][eq]=1\|0`                                                                  |
| `GET templates/:id`           | view  | 200 template            | `etag` in the body and the `ETag` header (ADR-0040: Active and the versions); `sendTest` is the caller's own address                                                                                         |
| `PATCH templates/:id`         | edit  | 200 template            | `If-Match` required (428 `ERP-CORE-0014`), stale 412 `ERP-CORE-0013`; wording issues in `ERP-VALIDATION-0001` with their `rule`; a key no module defines 409 `ERP-MAIL-0004`                                 |
| `PUT templates/:id/active`    | edit  | 200 list row            | the list's immediate switch                                                                                                                                                                                  |
| `POST templates/active`       | edit  | 200 `{ changed }`       | Enable All or Disable All of one module                                                                                                                                                                      |
| `POST templates/:id/preview`  | view  | 200 `{ subject, html }` | an unsaved draft with the sample values                                                                                                                                                                      |
| `POST templates/:id/test`     | edit  | 202 `{ id }`            | `Idempotency-Key`; to the caller's own address only; 409 `ERP-MAIL-0002` not configured; 429 `ERP-MAIL-0007` with `Retry-After` after `TIMINGS.mail.testMaxPerWindow` per window                             |
| `GET tests/:id`               | edit  | 200 test state          | the caller's own test only, any other row 404                                                                                                                                                                |
| `GET sent-emails`             | admin | 200 list                | keyset newest first; `q` a recipient prefix, `filter[template][in]` (keys and `status-test`), `filter[status][in]`, `filter[queuedAt][gte\|lte]` (ISO date-time with an offset)                              |
| `GET sent-emails/:id`         | admin | 200 entry               | plus the server reply and `resentFromId`, `resentFromExists`                                                                                                                                                 |
| `POST sent-emails/:id/resend` | admin | 202 `{ id }`            | `Idempotency-Key`; a new row linked by `resentFromId`, the original untouched; 409 `ERP-MAIL-0008` a test, `0006` still waiting, `0002` not configured, `0004` template off or undefined, `0005` record gone |
| `GET status`                  | admin | 200 status              | configured, sender, host, port, encryption, the server state, the last send; never a credential                                                                                                              |
| `POST status/test`            | admin | 202 `{ id }`            | `Idempotency-Key`; the fixed test wording to the caller's own address; rate-limited with the template tests                                                                                                  |

## Events published

None. A send is a job on `mail.send`, not an event (`events/published.ts`).

## Events subscribed

None. The sending modules call `MailFacade` (`events/subscribed.ts`).

## Jobs

On `src/shared/queue/` (BE-14, 04.2-04); the processors register in both processes, the worker runs them.

| Queue        | Processor                      | Cadence                                                                                          | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mail.send`  | `jobs/mail-send.processor.ts`  | per email, job id `mail-<id>`, data `{ sentEmailId }` (a test send adds its sample-only `draft`) | Renders at send time (current wording, the record's current values), sends through `EMAIL_PROVIDER`, concurrency `POOL.smtp.maxConnections`. `retryPolicy` `RETRY_POLICIES.mailSend` (8 attempts, 30 s doubling to 30 min): a transient refusal marks the row `retrying` with `next_try_at` and throws `RetryLaterError`; a permanent one or the last attempt marks it `failed` and throws `NonRetryableJobError` (`mail.send.dlq`). Template off, record gone, not configured: `failed` without sending. Attachments (ADR-0052) are checked, sized and read from `STORAGE` before the send (see "Attachments"). While the `email` breaker is open the job is deferred (`DeferJobError`, the configured breaker's half-open delay) with no attempt spent, and `mail:server:unreachableSince` is set |
| `mail.sweep` | `jobs/mail-sweep.processor.ts` | every `TIMINGS.mail.sweepEveryMs` (5 min)                                                        | Re-adds `mail-<id>` for non-test rows still `queued` after `TIMINGS.mail.sweepAfterMs` (5 min); the job id makes it a no-op for a live job. Ceiling: a job in the failed set is re-added only after `TIMINGS.queue.keepFailedS`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `mail.purge` | `jobs/mail-purge.processor.ts` | every `TIMINGS.mail.purgeEveryMs` (daily)                                                        | Deletes log rows queued more than 12 calendar months ago (D-09), `TIMINGS.mail.purgeBatchSize` per statement until a batch is short                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## Resilience

- **Breaker:** email, inside the SMTP adapter (ADR-0049)
- **Retry policy:** RETRY_POLICIES.mailSend on the mail.send queue (the processor's `retryPolicy`); no withRetry (the queue is the only retry layer); an open breaker defers the job (`DeferJobError`) without spending an attempt
- **Pool budget:** POOL.smtp per worker replica; the database pool of the process

## Layers

| File                                   | Responsibility                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `mail.module.ts`                       | Wires the layers; exports the facade only; not `@Global()` (BE-20)                                                                                                                                                 |
| `mail.routes.ts`                       | `MAIL_ROUTES` (the thirteen paths), `MAIL_PERMISSIONS` (`templates`: `settings.emailTemplates.view` and `.edit`)                                                                                                   |
| `controller/mail.controller.ts`        | The thirteen handlers of § Endpoints: guards, codes, `@IfMatch()`, `@Idempotent()`, `@ApiZod`; no logic, no `try`                                                                                                  |
| `service/mail.service.ts`              | `ensureSeeded` and `preview` (04.3-05); `enqueue`, the send behind `MailFacade.send` (04.3-06); the screens' use cases, `assertAdministrator` first for the admin ones (04.3-07)                                   |
| `service/mail.transformer.ts`          | `MailTransformer`: every answer of the screens re-parsed by its schema; `shownOf`, the ADR-0040 shown columns of a template                                                                                        |
| `service/mail.renderer.ts`             | Pure: the `{token}` substitution, HTML escaping, `safeUrl`, `cleanSubject`, `renderMail` for preview and send; a helper the service and the processor call, not a layer                                            |
| `service/mail.layout.ts`               | Pure: the branded email page (`layoutHtml`, `MAIL_COLOURS`, `RTL_LOCALES`, `escapeHtml`); a helper of the renderer, not a layer                                                                                    |
| `service/mail.messages.ts`             | `MAIL_MESSAGES` (`en`, `ar`) and `messageOf`: the api's user-visible mail strings as constants (JSON under `src` is not emitted, PATTERNS M2); data, not a layer                                                   |
| `service/mail-template.registry.ts`    | `MailTemplateRegistry` and the definition types: the templates sending modules register from `onModuleInit` (Pitfall 12); a provider beside the layers, not a layer                                                |
| `service/html-to-text.ts`              | Pure, seeding only: Perfex's template HTML to plain text and the formatting-dropped flag; a helper of `ensureSeeded`, not a layer                                                                                  |
| `service/mail.transport.ts`            | The outbound seam: `brand()` from `BrandingFacade`, `contactOf` from `IdentityFacade`, `send` to `EMAIL_PROVIDER`, `messageIdOf`, `deferMs`, `smtpSettings` (never a credential)                                   |
| `service/mail.validator.ts`            | The wording rules of a save (`versions`) and of a preview or test draft (`draft`): one `ERP-VALIDATION-0001` listing every issue with its `rule`; `isRecipient`; the two list queries, `:id` and the strict bodies |
| `repository/mail.repository.ts`        | The three tables: keyset lists with filters, the row-locked template save, Active per template and per module, the idempotent log insert, the status moves, the batched purge; reads `tblemailtemplates`           |
| `repository/mail-state.store.ts`       | `MAIL_STATE_STORE`, `MailStateStore`, `mailKeys`: the server-unreachable timestamp and the per-member test counter on Redis db 0                                                                                   |
| `repository/redis-mail-state.store.ts` | `RedisMailStateStore` over `RedisService.client` (db 0)                                                                                                                                                            |
| `model/mail.model.ts`                  | Templates, versions, the sent-email row, the Perfex template row, the statuses and failure reasons, `SendRequest` and `SendOutcome`                                                                                |
| `dto/mail.dto.ts`                      | Every request and response schema of the mail wire; strict bodies, so no address rides along                                                                                                                       |
| `events/published.ts`, `subscribed.ts` | None / none                                                                                                                                                                                                        |
| `facade/mail.facade.ts`                | The ONLY surface other modules may import; `send` never throws                                                                                                                                                     |
| `jobs/mail-send.job.ts`                | `MAIL_SEND_QUEUE`, `MAIL_SWEEP_QUEUE`, `MAIL_PURGE_QUEUE`, the job schema (`{ sentEmailId, draft? }`), `mailJobId`, `enqueueMailSend`                                                                              |
| `jobs/mail-send.processor.ts`          | `MailSendProcessor`: render, send, retry, fail or defer (see Jobs)                                                                                                                                                 |
| `jobs/mail-sweep.processor.ts`         | `MailSweepProcessor`: re-adds rows queued without a job                                                                                                                                                            |
| `jobs/mail-purge.processor.ts`         | `MailPurgeProcessor`: the 12-month purge in batches                                                                                                                                                                |
| `index.ts`                             | `MailModule`, `MailFacade`, the model types and the registration types                                                                                                                                             |
| `__tests__/`                           | One spec per layer; `fakes.ts` (the email port fake, the repository stand-in, the queue fake, the identity stub, `InMemoryMailStateStore`), `create-mail-test-app.ts`                                              |

`RTL_LOCALES` in `service/mail.layout.ts` is the twin of erp-web's `RTL_LOCALES` (the api cannot import it): a new right-to-left locale is added to both.

## How to run its tests

- `corepack yarn test src/v1/mail`: the unit and e2e specs (no database, no Redis).
- `corepack yarn test:int src/v1/mail`: the repository against the local MySQL, the state store against the local Redis, the send on the wire against the local Mailpit (retry, permanent failure, deferral, sweep; queues on Redis db 3) and the worker registering the three queues (the local stack up).
