import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import {
  LeadSourcesCreatedV1,
  LeadSourcesDeletedV1,
  LeadSourcesUpdatedV1,
} from '../events/published.js';
import { LeadSourcesService } from '../service/lead-sources.service.js';
import { LeadSourcesTransformer } from '../service/lead-sources.transformer.js';
import { LeadSourcesTransport } from '../service/lead-sources.transport.js';
import { LeadSourcesValidator } from '../service/lead-sources.validator.js';
import { RecordingLogger, TEST_NOW } from './create-lead-sources-test-app.js';
import {
  asRepository,
  seededStore,
  ZERO_USAGE,
  type InMemoryLeadSourcesRepository,
} from './fakes.js';

const AT = TEST_NOW.toISOString();
const ADMIN: AuthenticatedUser = {
  staffId: 1,
  sessionId: 'admin-session',
  jti: 'admin-jti',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: 4_102_444_800,
};
const MEMBER: AuthenticatedUser = { ...ADMIN, staffId: 2, isAdmin: false };

function build(
  defaultSource: string | null = null,
  getOption: () => Promise<string | null> = () => Promise.resolve(defaultSource),
) {
  const repo = seededStore();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();
  const service = new LeadSourcesService(
    new LeadSourcesValidator(),
    asRepository(repo),
    new LeadSourcesTransformer(),
    new LeadSourcesTransport(events, { getOption }),
    logger,
  );
  service.now = () => TEST_NOW;
  return { service, repo, events, logger };
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

function spyRepository(repo: InMemoryLeadSourcesRepository) {
  return [
    vi.spyOn(repo, 'list'),
    vi.spyOn(repo, 'count'),
    vi.spyOn(repo, 'findById'),
    vi.spyOn(repo, 'create'),
    vi.spyOn(repo, 'update'),
    vi.spyOn(repo, 'remove'),
    vi.spyOn(repo, 'usageByLeadSource'),
  ];
}

describe('LeadSourcesService: administrator access', () => {
  it.each([
    ['list', (service: LeadSourcesService) => service.list(MEMBER, {})],
    ['get', (service: LeadSourcesService) => service.get(MEMBER, { id: '1' })],
    ['create', (service: LeadSourcesService) => service.create(MEMBER, { name: 'New' })],
    [
      'update',
      (service: LeadSourcesService) => service.update(MEMBER, { id: '1' }, { name: 'New' }),
    ],
    ['remove', (service: LeadSourcesService) => service.remove(MEMBER, { id: '1' })],
    ['exportCsv', (service: LeadSourcesService) => service.exportCsv(MEMBER, {})],
  ])(
    '%s rejects a non-administrator before repository calls or side effects',
    async (_name, call) => {
      const { service, repo, events, logger } = build();
      const spies = spyRepository(repo);
      const error = await refusal(call(service));
      expect(error.code).toBe('ERP-AUTH-0005');
      expect(error.message).toBe('lead sources are managed by administrators only');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      expect(events.count).toBe(0);
      expect(logger.lines).toEqual([]);
    },
  );
});

describe('LeadSourcesService: reads', () => {
  it('lists in name-ascending order with usage for each row', async () => {
    const { service, repo } = build();
    repo.usage.set(1, { ...ZERO_USAGE, leads: 2 });
    const response = await service.list(ADMIN, {});
    expect(response.data.map((row) => [row.id, row.usage.leads])).toEqual([
      ['2', 0],
      ['1', 2],
      ['3', 0],
    ]);
    expect(response.meta.total).toBe(3);
  });

  it('gets one record with its usage and returns not found for a missing id', async () => {
    const { service, repo } = build();
    repo.usage.set(1, { ...ZERO_USAGE, leads: 2 });
    expect(await service.get(ADMIN, { id: '1' })).toEqual({
      id: '1',
      name: 'Website',
      usage: { ...ZERO_USAGE, leads: 2 },
    });
    expect((await refusal(service.get(ADMIN, { id: '404' }))).code).toBe('ERP-CORE-0004');
  });

  it('exports id, name and total lead count', async () => {
    const { service, repo } = build();
    repo.usage.set(3, { leads: 1, emailIntegrations: 1, webToLeadForms: 1 });
    const { body } = await service.exportCsv(ADMIN, {});
    if (typeof body !== 'string') throw new Error('the export answered no CSV text');
    expect(body).toContain('id,name,totalLeads');
    expect(body).toContain('3,Website,1');
  });
});

describe('LeadSourcesService: writes', () => {
  it('creates a trimmed name and publishes one event after the write', async () => {
    const { service, repo, events, logger } = build();
    const create = vi.spyOn(repo, 'create');
    const record = await service.create(ADMIN, { name: '  New source  ' });
    expect(create).toHaveBeenCalledWith({ name: 'New source' });
    expect(record).toEqual({ id: '4', name: 'New source', usage: ZERO_USAGE });
    expect(events.drain()).toMatchObject([
      { name: LeadSourcesCreatedV1.NAME, payload: { id: 4, at: AT } },
    ]);
    expect(logger.lines).toEqual([{ message: 'lead source created', meta: { id: 4 } }]);
  });

  it('updates the name, preserves usage, and publishes one update event', async () => {
    const { service, repo, events, logger } = build();
    repo.usage.set(1, { ...ZERO_USAGE, leads: 1 });
    expect(await service.update(ADMIN, { id: '1' }, { name: 'New name' })).toEqual({
      id: '1',
      name: 'New name',
      usage: { ...ZERO_USAGE, leads: 1 },
    });
    expect(events.drain()).toMatchObject([
      { name: LeadSourcesUpdatedV1.NAME, payload: { id: 1, at: AT } },
    ]);
    expect(logger.lines).toEqual([{ message: 'lead source updated', meta: { id: 1 } }]);
  });

  it('refuses deletion while in use and publishes nothing', async () => {
    const { service, repo, events, logger } = build();
    repo.usage.set(1, { ...ZERO_USAGE, leads: 2 });
    const error = await refusal(service.remove(ADMIN, { id: '1' }));
    expect(error.code).toBe('ERP-LEADSOURCES-0001');
    expect(error.message).toBe('used by 2 lead(s)');
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
    expect(await repo.findById(1)).not.toBeNull();
  });

  it('names the specific reference group in the delete refusal', async () => {
    const { service, repo } = build();
    repo.usage.set(1, { ...ZERO_USAGE, emailIntegrations: 1 });
    const error = await refusal(service.remove(ADMIN, { id: '1' }));
    expect(error.message).toBe('used by 1 email integration(s)');
  });

  it('refuses deletion of the configured default source', async () => {
    const { service, repo, events } = build('1');
    const usage = vi.spyOn(repo, 'usageByLeadSource');
    const error = await refusal(service.remove(ADMIN, { id: '1' }));
    expect(error.code).toBe('ERP-LEADSOURCES-0002');
    expect(error.status).toBe(409);
    expect(usage).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(await repo.findById(1)).not.toBeNull();
  });

  it('returns a 409 and logs when the default source cannot be read', async () => {
    const { service, repo, events, logger } = build(null, () =>
      Promise.reject(new Error('database unavailable')),
    );
    const logError = vi.spyOn(logger, 'error');
    const usage = vi.spyOn(repo, 'usageByLeadSource');
    const error = await refusal(service.remove(ADMIN, { id: '1' }));
    expect(error.code).toBe('ERP-LEADSOURCES-0002');
    expect(error.status).toBe(409);
    expect(error.message).toBe('the default lead source could not be checked');
    expect(logError).toHaveBeenCalledWith(
      'lead source default could not be checked',
      expect.objectContaining({ id: 1 }),
    );
    expect(usage).not.toHaveBeenCalled();
    expect(events.count).toBe(0);
    expect(await repo.findById(1)).not.toBeNull();
  });

  it('returns a 409 and logs when deletion usage cannot be counted', async () => {
    const { service, repo, logger } = build();
    const logError = vi.spyOn(logger, 'error');
    vi.spyOn(repo, 'usageByLeadSource').mockRejectedValue(new Error('database unavailable'));
    const error = await refusal(service.remove(ADMIN, { id: '1' }));
    expect(error.code).toBe('ERP-LEADSOURCES-0001');
    expect(error.status).toBe(409);
    expect(error.message).toBe('its use could not be counted');
    expect(logError).toHaveBeenCalledWith(
      'lead source usage could not be counted',
      expect.objectContaining({ id: 1 }),
    );
  });

  it('deletes an unused record and publishes one deletion event', async () => {
    const { service, events, logger } = build();
    await expect(service.remove(ADMIN, { id: '2' })).resolves.toBeUndefined();
    expect(events.drain()).toMatchObject([
      { name: LeadSourcesDeletedV1.NAME, payload: { id: 2, at: AT } },
    ]);
    expect(logger.lines).toEqual([{ message: 'lead source deleted', meta: { id: 2 } }]);
  });

  it('fails closed when usage does not include the requested id', async () => {
    const { service, repo } = build();
    vi.spyOn(repo, 'usageByLeadSource').mockResolvedValue(new Map());
    const error = await refusal(service.remove(ADMIN, { id: '1' }));
    expect(error.code).toBe('ERP-LEADSOURCES-0001');
    expect(error.message).toBe('its use could not be counted');
  });

  it('does not publish for an invalid body or a missing update', async () => {
    const { service, events, logger } = build();
    expect((await refusal(service.create(ADMIN, {}))).code).toBe('ERP-VALIDATION-0001');
    expect((await refusal(service.update(ADMIN, { id: '404' }, { name: 'New' }))).code).toBe(
      'ERP-CORE-0004',
    );
    expect(events.count).toBe(0);
    expect(logger.lines).toEqual([]);
  });
});
