# knowledge-base-groups

## Purpose

The Knowledge Base Groups module: list, read, create, update, delete and export of knowledge base groups.
The screens live under `/setup/knowledge-base-groups` in erp-web, the api under `api/v1/knowledge-base-groups`.

## Owned tables

- `tblknowledge_base_groups`: claimed for `node` in the ownership register. Written by `v1/knowledge-base-groups`. Perfex still writes it through `knowledge_base/group`, `update_groups_order` and `change_group_color`.
- `tblknowledge_base`: stays `perfex-core` (read-only in Node). Only counted with `articlegroup` for the article count total and the delete refusal (refused with 409 while the group has articles).

## Facade surface

- `describe(): { module: 'knowledge-base-groups'; version: 1 }`
- `findById(id: number): Promise<KnowledgeBaseGroup | null>`
- `listAll(): Promise<readonly KnowledgeBaseGroup[]>`
- `findByIds(ids: readonly number[]): Promise<readonly KnowledgeBaseGroup[]>`

`KnowledgeBaseGroup` is `{ id: number; name: string }`.

## Endpoints

Under `api/v1/knowledge-base-groups` (`KNOWLEDGE_BASE_GROUPS_ROUTES` in `knowledge-base-groups.routes.ts`).
Gated on `knowledgeBase.articles.view`, `.create`, `.edit`, and `.delete`:

| Method   | Path     | Permission                      | Success                                                                                      | Errors                                                                                                   |
| -------- | -------- | ------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET`    | ``       | `knowledgeBase.articles.view`   | 200 `{ data, meta: { nextCursor, prevCursor, total, rangeStart, exportLimit, printLimit } }` | `ERP-VALIDATION-0001`, `ERP-AUTH-0004`, `ERP-AUTH-0005`                                                  |
| `GET`    | `export` | `knowledgeBase.articles.view`   | 200 by `?format=`: `csv`, `xlsx`, `pdf` or `print`                                           | `ERP-VALIDATION-0001`, `ERP-AUTH-0004`, `ERP-AUTH-0005`                                                  |
| `POST`   | ``       | `knowledgeBase.articles.create` | 201 created group                                                                            | `ERP-VALIDATION-0001`, `ERP-AUTH-0004`, `ERP-AUTH-0005`                                                  |
| `GET`    | `:id`    | `knowledgeBase.articles.view`   | 200 group detail                                                                             | `ERP-CORE-0004`, `ERP-VALIDATION-0001`, `ERP-AUTH-0004`, `ERP-AUTH-0005`                                 |
| `PATCH`  | `:id`    | `knowledgeBase.articles.edit`   | 200 updated group                                                                            | `ERP-CORE-0004`, `ERP-VALIDATION-0001`, `ERP-AUTH-0004`, `ERP-AUTH-0005`                                 |
| `DELETE` | `:id`    | `knowledgeBase.articles.delete` | 204 no body                                                                                  | `ERP-CORE-0004`, `ERP-KNOWLEDGEBASEGROUPS-0001`, `ERP-VALIDATION-0001`, `ERP-AUTH-0004`, `ERP-AUTH-0005` |

## Events published

| Event                                  | When                      | Payload                                      |
| -------------------------------------- | ------------------------- | -------------------------------------------- |
| `knowledge-base-groups.record.created` | after `POST` stores group | `{ id, at }`, `KnowledgeBaseGroupsCreatedV1` |
| `knowledge-base-groups.record.updated` | after `PATCH` saves group | `{ id, at }`, `KnowledgeBaseGroupsUpdatedV1` |
| `knowledge-base-groups.record.deleted` | after `DELETE` removes it | `{ id, at }`, `KnowledgeBaseGroupsDeletedV1` |

## Events subscribed

None. Listed in `events/subscribed.ts` (`KNOWLEDGE_BASE_GROUPS_SUBSCRIBED_EVENTS`).

## Jobs

None.

## Resilience

- **Breaker:** None; the module makes no outbound HTTP calls.
- **Retry policy:** None; database failures are surfaced.
- **Pool budget:** Uses the shared Prisma connection pool.

## Layers

| Layer         | Responsibility                                                      |
| ------------- | ------------------------------------------------------------------- |
| `controller/` | Guarded HTTP routes and API contracts.                              |
| `dto/`        | Strict request and response schemas.                                |
| `events/`     | Published domain events; no subscribers.                            |
| `facade/`     | Read-only module boundary.                                          |
| `model/`      | Stored group, write types, and list request/page types.             |
| `repository/` | Prisma reads, writes, counts, and keyset pagination.                |
| `service/`    | Validation orchestration, delete rules, transformation, and export. |

## Differences from Perfex

- **The popup became `/new` and `/:id` pages**: migrated to modern `ListPageTemplate` and `SchemaForm` architecture for full accessibility, deep linking, and mobile responsiveness.
- **Perfex's `knowledge_base/group`, `update_groups_order` and `change_group_color` stay open**: maintained for coexistence while legacy Perfex admin flows remain active.

## How to run its tests

```bash
corepack yarn test src/v1/knowledge-base-groups
corepack yarn test:int src/v1/knowledge-base-groups
```
