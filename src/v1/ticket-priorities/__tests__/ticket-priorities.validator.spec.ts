import { describe, expect, it } from 'vitest';
import {
  createTicketPrioritiesBodySchema,
  updateTicketPrioritiesBodySchema,
  ticketPrioritiesParamsSchema,
  ticketPrioritiesListResponseSchema,
} from '../dto/ticket-priorities.dto.js';

describe('ticketPrioritiesParamsSchema', () => {
  it('coerces a numeric string to a number', () => {
    expect(ticketPrioritiesParamsSchema.parse({ id: '5' })).toEqual({ id: 5 });
  });

  it.each(['abc', '0', '-1', '1.5', ''])('rejects id=%s', (id) => {
    expect(ticketPrioritiesParamsSchema.safeParse({ id }).success).toBe(false);
  });
});

describe('createTicketPrioritiesBodySchema', () => {
  it('accepts a valid name and trims it', () => {
    expect(createTicketPrioritiesBodySchema.parse({ name: '  High  ' })).toEqual({ name: 'High' });
  });

  it('rejects an empty name', () => {
    expect(createTicketPrioritiesBodySchema.safeParse({ name: '' }).success).toBe(false);
    expect(createTicketPrioritiesBodySchema.safeParse({ name: '   ' }).success).toBe(false);
  });

  it('accepts 50 characters and rejects 51', () => {
    expect(createTicketPrioritiesBodySchema.safeParse({ name: 'a'.repeat(50) }).success).toBe(true);
    expect(createTicketPrioritiesBodySchema.safeParse({ name: 'a'.repeat(51) }).success).toBe(
      false,
    );
  });

  it('rejects a missing or non-string name', () => {
    expect(createTicketPrioritiesBodySchema.safeParse({}).success).toBe(false);
    expect(createTicketPrioritiesBodySchema.safeParse({ name: 5 }).success).toBe(false);
  });
});
it('rejects a numeric id', () => {
  expect(
    ticketPrioritiesListResponseSchema.safeParse({
      data: [{ id: 1, name: 'Low' }],
      meta: {
        nextCursor: null,
        prevCursor: null,
        total: 1,
        rangeStart: 1,
        exportLimit: 1000,
        printLimit: 500,
      },
    }).success,
  ).toBe(false);
});

describe('updateTicketPrioritiesBodySchema', () => {
  it('still enforces the length limit', () => {
    expect(updateTicketPrioritiesBodySchema.safeParse({ name: 'a'.repeat(51) }).success).toBe(
      false,
    );
  });
});

describe('ticketPrioritiesListResponseSchema', () => {
  it('accepts the keyset envelope', () => {
    const result = ticketPrioritiesListResponseSchema.safeParse({
      data: [{ id: '1', name: 'Low' }],
      meta: {
        nextCursor: null,
        prevCursor: null,
        total: 1,
        rangeStart: 1,
        exportLimit: 1000,
        printLimit: 500,
      },
    });
    expect(result.success).toBe(true);
  });
});
