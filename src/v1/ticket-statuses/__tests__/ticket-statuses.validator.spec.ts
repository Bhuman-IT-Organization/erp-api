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

  it('accepts the default list contract and rejects unknown top-level keys', () => {
    expect(validator.parseListQuery({})).toMatchObject({
      search: null,
      sortField: 'id',
      order: 'desc',
      cursor: null,
      limit: 50,
    });
    expect(refused(() => validator.parseListQuery({ foo: 'bar' })).code).toBe(
      'ERP-VALIDATION-0001',
    );
  });

  it('accepts export search, sort and format parameters while stripping export-only keys', () => {
    expect(validator.parseExportQuery({ q: 'Open', sort: '-name', format: 'csv' })).toMatchObject({
      q: 'Open',
      sort: '-name',
      format: 'csv',
    });
    expect(validator.parseExportList({ q: 'Open', sort: '-name', format: 'csv' })).toMatchObject({
      search: 'Open',
      sortField: 'name',
      order: 'desc',
      cursor: null,
      limit: 500,
    });
  });

  it('validates route ids and trims names', () => {
    expect(validator.parseParams({ id: String(TICKET_STATUS_ID_MAX) })).toEqual({
      id: TICKET_STATUS_ID_MAX,
    });
    for (const id of ['0', '-1', '1.5', '2147483648', 'not-an-id']) {
      const error = refused(() => validator.parseParams({ id }));
      expect(error.code).toBe('ERP-VALIDATION-0001');
    }

    const name = 'n'.repeat(TICKET_STATUS_NAME_MAX);
    expect(validator.parseCreateBody({ name: ` ${name} ` })).toEqual({ name });
  });

  it('accepts the real Perfex color/order conventions and rejects invalid values', () => {
    expect(
      validator.parseCreateBody({
        name: 'New',
        statuscolor: 'ABC',
        statusorder: ' 03 ',
      }),
    ).toEqual({
      name: 'New',
      statuscolor: 'ABC',
      statusorder: 3,
    });
    expect(validator.parseCreateBody({ name: 'New', statuscolor: '', statusorder: null })).toEqual({
      name: 'New',
      statuscolor: '',
      statusorder: null,
    });
    expect(
      refused(() => validator.parseCreateBody({ name: 'Open', statuscolor: 'abcdefg1' })).code,
    ).toBe('ERP-VALIDATION-0001');
    expect(refused(() => validator.parseCreateBody({ name: 'Open', statusorder: 1.5 })).code).toBe(
      'ERP-VALIDATION-0001',
    );
    for (const statusorder of [-2_147_483_649, 2_147_483_648]) {
      expect(refused(() => validator.parseCreateBody({ name: 'Open', statusorder })).code).toBe(
        'ERP-VALIDATION-0001',
      );
    }
    expect(
      validator.parseCreateBody({ name: 'Open', statusorder: -2_147_483_648 }).statusorder,
    ).toBe(-2_147_483_648);
    expect(
      validator.parseCreateBody({ name: 'Open', statusorder: 2_147_483_647 }).statusorder,
    ).toBe(2_147_483_647);
  });

  it('refuses empty edits and mass-assignment keys', () => {
    expect(refused(() => validator.parseUpdateBody({})).code).toBe('ERP-VALIDATION-0001');
    expect(refused(() => validator.parseUpdateBody({ statuscolor: 'abc', extra: true })).code).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(
      refused(() => validator.parseCreateBody({ name: 'Open', ticketstatusid: 42 })).code,
    ).toBe('ERP-VALIDATION-0001');
  });
});
