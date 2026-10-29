# Predefined Replies

## Purpose

Move the Setup > Support > Predefined Replies screen from Perfex to the Node API and Next.js frontend. The new screen will be available at `/setup/predefined-replies`. The old Perfex management screen must no longer be able to change predefined replies.

## Owned tables

- `tbltickets_predefined_replies` — owned by Node for this feature.

The table contains the predefined reply ID, name and HTML message. Reply names are limited to 191 characters.

## Facade surface

The module exports `PredefinedRepliesFacade` for module-to-module reads:

- `findById(id)` — find a reply by ID.
- `listAll()` — retrieve all replies ordered by name, then ID.
- `findByIds(ids)` — retrieve replies for the supplied IDs, preserving the requested order and skipping missing IDs.

These facade methods do not require an actor and return the stored records, including the HTML message. The HTTP management routes remain administrator-only.

## Endpoints

Routes are under `/api/v1`.

| Method | Path                         | Purpose                                                                                            |
| ------ | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| GET    | `/predefined-replies`        | List replies using pagination, search and sorting. List rows contain only the ID and name.         |
| GET    | `/predefined-replies/export` | Export matching replies as CSV, Excel, PDF or print output.                                        |
| GET    | `/predefined-replies/:id`    | Retrieve one reply, with its message converted to plain text and a `hasOtherFormatting` indicator. |
| POST   | `/predefined-replies`        | Create a reply.                                                                                    |
| PATCH  | `/predefined-replies/:id`    | Update a reply. If `message` is omitted, the stored message is preserved.                          |
| DELETE | `/predefined-replies/:id`    | Delete a reply and return HTTP `204 No Content`.                                                   |

All management routes require an authenticated user and administrator authorization. The service checks administrator access before parsing request input.

### List behaviour

- Search matches the reply name and, when the query contains only digits, an exact reply ID. It does not search message content.
- The default sort is name ascending.
- List rows expose only `id` and `name`.
- List metadata includes the configured export and print row limits.

### Export behaviour

The export endpoint supports CSV, Excel, PDF and print output. It uses the list filters to select matching records and applies the shared export and print row limits.

## Message handling

Messages are stored as HTML in `tbltickets_predefined_replies`.

When a message is saved through the Node API, plain-text input is escaped for `&`, `<`, `>`, double quotes and apostrophes. Blank lines separate paragraphs, and line breaks within paragraphs are represented by `<br>`.

When a reply is retrieved through the HTTP API, the stored HTML is converted to plain text. The response includes `hasOtherFormatting` to indicate whether legacy formatting such as bold text, lists or links was detected.

This conversion does not preserve rich-text formatting when the message is edited and saved as plain text. The frontend must render the returned message as text rather than injecting the stored HTML directly.

## Events published

Events are published after successful writes through `PredefinedRepliesTransport`. Each event payload contains the reply ID only.

| Event                               | Description                                   |
| ----------------------------------- | --------------------------------------------- |
| `predefined-replies.record.created` | Published when a predefined reply is created. |
| `predefined-replies.record.updated` | Published when a predefined reply is updated. |
| `predefined-replies.record.deleted` | Published when a predefined reply is deleted. |

Each successful write also produces a logger entry containing the reply ID.

## Events subscribed

None.

## Jobs

None.

## Resilience

- **Breaker:** Follow the existing shared project patterns where applicable.
- **Retry policy:** Avoid retries that could duplicate create operations.
- **Pool budget:** Use the existing shared database connection pool.

## Layers

The module follows the backend module structure and project conventions.

| Layer                                  | Responsibility                                                |
| -------------------------------------- | ------------------------------------------------------------- |
| Controller                             | HTTP endpoints and request handling                           |
| Service                                | Predefined-reply business logic                               |
| Repository                             | Database access                                               |
| Model                                  | Domain types and schemas                                      |
| DTO                                    | Request and response validation                               |
| Events                                 | Published domain events                                       |
| Transport                              | Domain-event publishing                                       |
| Facade                                 | Module-to-module reads                                        |
| `service/predefined-replies.export.ts` | Export formatting for CSV, XLSX, PDF and print                |
| `service/reply-html.ts`                | HTML escaping, plain-text conversion and formatting detection |

The facade is exported by `PredefinedRepliesModule` for module-to-module reads.

## Legacy parity

- Replace the Perfex Setup > Support > Predefined Replies management screen with `/setup/predefined-replies`.
- Preserve the reply ID, name and stored HTML message.
- Limit reply names to 191 characters.
- Restrict management operations to administrators.
- Allow deletion without reference checks.
- Keep the ticket-level “Save as predefined reply” action on Perfex.
- Do not modify the legacy Perfex source code.
- Escape plain-text messages before storing them as HTML through the Node API.
- Convert stored HTML to plain text for API reads and indicate when legacy formatting was detected.

## How to run its tests

Run the module tests with:

```bash
corepack yarn test src/v1/predefined-replies
```

Run the TypeScript check with:

```bash
yarn typecheck
```

Tests should cover:

- Administrator access and route gates, including rejection of non-administrators before invalid request input is parsed.
- Listing, creating, retrieving, updating and deleting replies.
- Name validation and optional message behaviour.
- HTML escaping, paragraph and line-break conversion, and detection of legacy formatting.
- Search by name and exact numeric ID, without matching message content.
- Export formats, limits and validation.
- HTTP `204 No Content` for deletion.
- Published create, update and delete events with ID-only payloads.
- Logging for successful writes.
- Facade reads, including stored HTML and missing IDs.
