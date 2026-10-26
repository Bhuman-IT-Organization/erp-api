# Ticket Priorities

## Purpose

Manages support ticket priorities.

## API Routes

- GET /api/v1/ticket-priorities
- POST /api/v1/ticket-priorities
- GET /api/v1/ticket-priorities/:id
- PATCH /api/v1/ticket-priorities/:id
- DELETE /api/v1/ticket-priorities/:id

## Database Tables

- tbltickets_priorities

## Business Rules

- Admins only
- No delete while in use
- Email piping default protection

## Error Codes

- ERP-CORE-0004
- ERP-VALIDATION-0001

## Resilience

- **Breaker**: enabled
- Retry policy active
- Pool bulkhead configured

## Events published

None

## Events subscribed

None

## Security

- ADMIN_GATE required

## Testing

- Unit tests in **tests**/
