import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { TICKET_STATUS_ID_MAX, TICKET_STATUS_NAME_MAX } from '../dto/ticket-statuses.dto.js';
import { TicketStatusesValidator } from '../service/ticket-statuses.validator.js';

function refused(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('TicketStatusesValidator', () => {
  const validator = new TicketStatusesValidator();

  it('accepts an empty list query and rejects unexpected query keys', () => {
    expect(() => {
      validator.parseListQuery({});
    }).not.toThrow();
    expect(
      refused(() => {
        validator.parseListQuery({ limit: '10' });
      }).code,
    ).toBe('ERP-VALIDATION-0001');
  });

  it('validates export search, sort and format parameters without changing the list query', () => {
    expect(validator.parseExportQuery({ q: 'Open', sort: '-name', format: 'csv' })).toEqual({
      q: 'Open',
      sort: '-name',
      format: 'csv',
    });
    expect(
      refused(() => {
        validator.parseExportQuery({ sort: 'statusorder' });
      }).code,
    ).toBe('ERP-VALIDATION-0001');
    expect(
      refused(() => {
        validator.parseListQuery({ q: 'Open' });
      }).code,
    ).toBe('ERP-VALIDATION-0001');
  });

  it('validates positive signed-int route ids', () => {
    expect(validator.parseParams({ id: String(TICKET_STATUS_ID_MAX) })).toEqual({
      id: TICKET_STATUS_ID_MAX,
    });
    for (const id of ['0', '-1', '1.5', '2147483648', 'not-an-id']) {
      const error = refused(() => validator.parseParams({ id }));
      expect(error.code).toBe('ERP-VALIDATION-0001');
      expect(error.extras?.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['id'] })]),
      );
    }
  });

  it('trims names and accepts the maximum-length name plus Perfex color/order values', () => {
    const name = 'n'.repeat(TICKET_STATUS_NAME_MAX);
    expect(
      validator.parseCreateBody({
        name: ` ${name} `,
        statuscolor: '#aB12fF',
        statusorder: -4,
      }),
    ).toEqual({ name, statuscolor: '#aB12fF', statusorder: -4 });
    expect(validator.parseCreateBody({ name: 'New', statuscolor: '', statusorder: null })).toEqual({
      name: 'New',
      statuscolor: '',
      statusorder: null,
    });
  });

  it.each([
    ['empty name', { name: '   ' }],
    ['long name', { name: 'n'.repeat(TICKET_STATUS_NAME_MAX + 1) }],
    ['invalid color', { name: 'Open', statuscolor: 'red' }],
    ['short hex color', { name: 'Open', statuscolor: '#123' }],
    ['fractional order', { name: 'Open', statusorder: 1.5 }],
    ['id mass assignment', { name: 'Open', ticketstatusid: 42 }],
    ['default flag mass assignment', { name: 'Open', isdefault: 1 }],
  ])('rejects %s', (_label, body) => {
    expect(refused(() => validator.parseCreateBody(body)).code).toBe('ERP-VALIDATION-0001');
  });

  it('allows partial edits but refuses an empty body and unknown keys', () => {
    expect(validator.parseUpdateBody({ statusorder: 3 })).toEqual({ statusorder: 3 });
    expect(refused(() => validator.parseUpdateBody({})).code).toBe('ERP-VALIDATION-0001');
    expect(
      refused(() => validator.parseUpdateBody({ statuscolor: '#123456', extra: true })).code,
    ).toBe('ERP-VALIDATION-0001');
  });
});
