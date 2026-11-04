import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  ESTIMATE_REQUEST_STATUS_COLOR_MAX,
  ESTIMATE_REQUEST_STATUS_NAME_MAX,
} from '../dto/estimate-request-statuses.dto.js';
import { ESTIMATE_REQUEST_STATUS_ID_MAX } from '../model/estimate-request-statuses.model.js';
import { EstimateRequestStatusesValidator } from '../service/estimate-request-statuses.validator.js';

function rejected(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('EstimateRequestStatusesValidator', () => {
  const validator = new EstimateRequestStatusesValidator();

  it('uses the name-ascending default and parses explicit list sorts', () => {
    expect(validator.parseListQuery({})).toMatchObject({
      search: null,
      sortField: 'name',
      order: 'asc',
      cursor: null,
      limit: 50,
    });
    expect(validator.parseListQuery({ sort: '-id', q: 'New' })).toMatchObject({
      search: 'New',
      sortField: 'id',
      order: 'desc',
    });
  });

  it('validates ids, strict bodies, and never accepts flag as a writable field', () => {
    expect(validator.parseParams({ id: String(ESTIMATE_REQUEST_STATUS_ID_MAX) }).id).toBe(
      ESTIMATE_REQUEST_STATUS_ID_MAX,
    );
    expect(rejected(() => validator.parseParams({ id: '0' })).code).toBe('ERP-VALIDATION-0001');
    expect(
      rejected(() => validator.parseCreateBody({ name: 'Ready', flag: 'built-in' })).code,
    ).toBe('ERP-VALIDATION-0001');
    expect(rejected(() => validator.parseUpdateBody({ flag: 'built-in' })).code).toBe(
      'ERP-VALIDATION-0001',
    );
  });

  it('trims bounded names, accepts empty color and blank order as null, and rejects bad order', () => {
    const name = 'x'.repeat(ESTIMATE_REQUEST_STATUS_NAME_MAX);
    expect(
      validator.parseCreateBody({
        name: ` ${name} `,
        color: '',
        statusorder: ' ',
      }),
    ).toEqual({ name, color: '', statusorder: null });
    expect(rejected(() => validator.parseCreateBody({ name: 'x'.repeat(51) })).code).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(
      rejected(() =>
        validator.parseCreateBody({
          name: 'Ready',
          color: 'x'.repeat(ESTIMATE_REQUEST_STATUS_COLOR_MAX + 1),
        }),
      ).code,
    ).toBe('ERP-VALIDATION-0001');
    expect(
      rejected(() => validator.parseCreateBody({ name: 'Ready', statusorder: '1.5' })).code,
    ).toBe('ERP-VALIDATION-0001');
    expect(rejected(() => validator.parseUpdateBody({})).code).toBe('ERP-VALIDATION-0001');
  });

  it('parses export query options without changing the list sort', () => {
    expect(validator.parseExportList({ q: 'Ready', format: 'csv', sort: 'name' })).toMatchObject({
      search: 'Ready',
      sortField: 'name',
      order: 'asc',
      cursor: null,
      limit: 500,
    });
  });
});
