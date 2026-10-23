# Predefined Replies

## Purpose

Move the Setup > Support > Predefined Replies screen from Perfex to the Node API and Next.js frontend. The new screen will be available at `/setup/predefined-replies`. The old Perfex screen must no longer be able to change predefined replies.

## Owned tables

- `tbltickets_predefined_replies` — claimed by Node for this feature.

The table contains the predefined reply ID, name and HTML message.

## Facade surface

The backend provides the API used by the Predefined Replies frontend to list, create, view, update and delete predefined replies.

## Endpoints

Planned routes under `/api/v1`:

| Method | Path                      | Purpose                   |
| ------ | ------------------------- | ------------------------- |
| GET    | `/predefined-replies`     | List predefined replies   |
| GET    | `/predefined-replies/:id` | Get one predefined reply  |
| POST   | `/predefined-replies`     | Create a predefined reply |
| PATCH  | `/predefined-replies/:id` | Update a predefined reply |
| DELETE | `/predefined-replies/:id` | Delete a predefined reply |

These are planned endpoints. Implementation and final request and response details are pending review.

## Events published

None planned at this stage. Confirm with the lead whether this feature needs to publish domain events before implementation.

## Events subscribed

None planned at this stage. Confirm with the lead whether this feature needs to subscribe to existing events.

## Jobs

None planned at this stage.

## Resilience

- **Breaker:** To be confirmed against existing project patterns and the final implementation.
- **Retry policy:** To be confirmed. Avoid retrying create operations in a way that could create duplicate replies.
- **Pool budget:** Use the existing shared database connection pool. Confirm the expected query pattern during implementation.

## Layers

The implementation should follow the existing backend module structure and project coding rules. The module will be registered in `src/v1/v1.module.ts` after the planning review is approved.

The planned layers include the controller, service, repository, model, DTOs, events, facade and their required tests. These will be implemented after documentation review and lead approval.

## Legacy parity

- Replace the Perfex Setup > Support > Predefined Replies management screen with `/setup/predefined-replies`.
- Preserve the reply ID, name (maximum 191 characters), and rich-text HTML message.
- Only administrators may access the management screen and save changes.
- Deletion must work without reference checks.
- The ticket-level “Save as predefined reply” action remains on Perfex and must continue to work.
- The legacy Perfex source code must not be modified.
- Sanitisation must be applied before saving and before displaying HTML, using the approach approved by the lead.
- The message should preserve supported formatting, such as bold text, lists and links, subject to the approved sanitisation rules.

## How to run its tests

Planned module test command:

```bash
corepack yarn test src/v1/predefined-replies
```

The module structure and tests must be implemented after the documentation review is approved.

Planned test coverage includes:

- Admin access and permission checks.
- Listing, creating, viewing, updating and deleting replies.
- Validation of the reply name and required fields.
- HTML sanitisation, including ensuring unsafe `<script>` content is not saved.
- Confirmation that deletion does not require reference checks.
