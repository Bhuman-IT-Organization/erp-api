/**
 * CustomFieldsService over the in-memory repository: the read use cases (the record with its value
 * count, the list page with the counts, the 404) and the administrator assertion, which comes
 * before anything else in every use case a handler calls. The service has no write: the tables are
 * Perfex's.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CustomFieldsService } from '../service/custom-fields.service.js';
import { CustomFieldsTransformer } from '../service/custom-fields.transformer.js';
import { CustomFieldsValidator } from '../service/custom-fields.validator.js';
import { asRepository, seededStore, type InMemoryCustomFieldsRepository } from './fakes.js';

const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

function user(isAdmin: boolean): AuthenticatedUser {
  return {
    staffId: isAdmin ? 1 : 2,
    sessionId: 's',
    jti: 'j',
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: 4_102_444_800,
  };
}
const ADMIN = user(true);
const MEMBER = user(false);

describe('CustomFieldsService', () => {
  let repo: InMemoryCustomFieldsRepository;
  let service: CustomFieldsService;

  beforeEach(() => {
    repo = seededStore();
    service = new CustomFieldsService(
      new CustomFieldsValidator(),
      asRepository(repo),
      new CustomFieldsTransformer(),
    );
    service.now = () => NOW;
  });

  it('describe answers the module name and version', () => {
    expect(service.describe()).toEqual({ module: 'custom-fields', version: 1 });
  });

  it('get answers the record with its value count; a missing id is ERP-CORE-0004', async () => {
    repo.addValue(2, 10, 'a');
    repo.addValue(2, 11, 'b');
    expect(await service.get(ADMIN, { id: 2 })).toMatchObject({
      id: 2,
      fieldto: 'items',
      valuesCount: 2,
    });
    await expect(service.get(ADMIN, { id: 99 })).rejects.toMatchObject({ code: 'ERP-CORE-0004' });
  });

  it('list answers each row of the page with its value count', async () => {
    repo.addValue(1, 10, 'x');
    const page = await service.list(ADMIN, {});
    expect(page.data.map((row) => [row.id, row.valuesCount])).toEqual([
      [1, 1],
      [2, 0],
      [3, 0],
    ]);
    expect(page.meta.total).toBe(3);
  });

  it.each<readonly [string, (s: CustomFieldsService) => Promise<unknown>]>([
    ['list', (s: CustomFieldsService) => s.list(MEMBER, {})],
    ['get', (s: CustomFieldsService) => s.get(MEMBER, { id: 1 })],
    ['exportCsv', (s: CustomFieldsService) => s.exportCsv(MEMBER, {})],
  ])(
    '%s refuses a non-administrator with ERP-AUTH-0005 before parsing anything',
    async (_name, run) => {
      const error: unknown = await run(service).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('ERP-AUTH-0005');
    },
  );
});
