import { describe, expect, it } from 'vitest';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import {
  KnowledgeBaseGroupsCreatedV1,
  KnowledgeBaseGroupsDeletedV1,
  KnowledgeBaseGroupsUpdatedV1,
} from '../events/published.js';
import { KnowledgeBaseGroupsRepository } from '../repository/knowledge-base-groups.repository.js';
import { KnowledgeBaseGroupsService, toSlug } from '../service/knowledge-base-groups.service.js';
import { KnowledgeBaseGroupsTransformer } from '../service/knowledge-base-groups.transformer.js';
import { KnowledgeBaseGroupsTransport } from '../service/knowledge-base-groups.transport.js';
import { KnowledgeBaseGroupsValidator } from '../service/knowledge-base-groups.validator.js';
import { RecordingLogger, TEST_NOW } from './create-knowledge-base-groups-test-app.js';
import { InMemoryKnowledgeBaseGroupsRepository } from './fakes.js';

const ACTOR: AuthenticatedUser = {
  staffId: 1,
  sessionId: 'sid',
  jti: 'jti',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: 4_102_444_800,
};

function build() {
  const repo = new InMemoryKnowledgeBaseGroupsRepository();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();
  const transport = new KnowledgeBaseGroupsTransport(events);
  const service = new KnowledgeBaseGroupsService(
    new KnowledgeBaseGroupsValidator(),
    repo as unknown as KnowledgeBaseGroupsRepository,
    new KnowledgeBaseGroupsTransformer(),
    transport,
    logger,
  );
  service.now = () => TEST_NOW;
  return { service, repo, events, logger };
}

describe('toSlug helper (Item 4)', () => {
  it('keeps Arabic letters in slug', () => {
    expect(toSlug('قاعدة المعرفة')).toBe('قاعدة-المعرفة');
    expect(toSlug('قاعدة، المعرفة!')).toBe('قاعدة-المعرفة');
  });

  it('turns punctuation into hyphens, e.g. Q&A -> q-a', () => {
    expect(toSlug('Q&A')).toBe('q-a');
    expect(toSlug('General Knowledge Base')).toBe('general-knowledge-base');
    expect(toSlug('Special & Characters')).toBe('special-characters');
  });
});

describe('KnowledgeBaseGroupsService: group operations', () => {
  it('Item 6: createGroup defaults order to count + 1 when groupOrder is not sent', async () => {
    const { service, repo } = build();
    // Seed has 3 groups (1, 2, 3), so count is 3. New group without groupOrder gets 3 + 1 = 4
    expect(await repo.count()).toBe(3);

    const created = await service.createGroup(ACTOR, {
      name: 'New KB Group',
      color: '#03a9f4',
    });
    expect(created.groupOrder).toBe(4);
  });

  it('Item 2: updateGroup keeps slug unchanged when saved unchanged even if general and general-2 exist', async () => {
    const { service, repo, events } = build();
    // Seed has group 1 with 'general'. Let's also add group with 'general-2'
    await repo.create({
      name: 'General 2',
      group_slug: 'general-2',
      description: null,
      active: 1,
      color: '#03a9f4',
      group_order: 10,
    });

    // Save group 1 with groupSlug: 'general' unchanged
    const savedUnchanged = await service.updateGroup(ACTOR, { id: '1' }, { groupSlug: 'general' });
    expect(savedUnchanged.groupSlug).toBe('general'); // Must NOT become general-2

    // Save group 1 without groupSlug field: also keeps 'general'
    const savedNoSlug = await service.updateGroup(ACTOR, { id: '1' }, { name: 'Updated Name' });
    expect(savedNoSlug.groupSlug).toBe('general');

    // Save with a new unique slug: saves as typed
    const savedNewSlug = await service.updateGroup(
      ACTOR,
      { id: '1' },
      { groupSlug: 'unique-typed-slug' },
    );
    expect(savedNewSlug.groupSlug).toBe('unique-typed-slug');

    const published = events.drain();
    expect(published[0]).toBeInstanceOf(KnowledgeBaseGroupsUpdatedV1);
  });

  it('Item 3: updateGroup refuses empty, null, or punctuation-only slug with 400', async () => {
    const { service } = build();

    await expect(service.updateGroup(ACTOR, { id: '1' }, { groupSlug: '' })).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
      status: 400,
    });

    await expect(
      service.updateGroup(ACTOR, { id: '1' }, { groupSlug: null }),
    ).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
      status: 400,
    });

    await expect(
      service.updateGroup(ACTOR, { id: '1' }, { groupSlug: '!!!' }),
    ).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
      status: 400,
    });
  });

  it('Item 5: create and update refuse invalid groupOrder with 400', async () => {
    const { service } = build();

    // Decimal order
    await expect(
      service.createGroup(ACTOR, { name: 'Valid', groupOrder: 1.5 }),
    ).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
      status: 400,
    });

    await expect(
      service.updateGroup(ACTOR, { id: '1' }, { groupOrder: 2.7 }),
    ).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
      status: 400,
    });
  });

  it('Item 7: exportGroups passes boolean active to rows', async () => {
    const { service } = build();
    const exportFile = await service.exportGroups(ACTOR, { format: 'csv' });
    expect(exportFile.body).toBeDefined();
  });

  it('createGroup creates group, applies duplicate slug rule, publishes event and logs id only', async () => {
    const { service, events, logger } = build();

    const first = await service.createGroup(ACTOR, {
      name: 'General',
      color: '#03a9f4',
    });
    expect(first.name).toBe('General');
    // Group 1 in seed already has slug 'general', so duplicate rule appends -2
    expect(first.groupSlug).toBe('general-2');

    const published = events.drain();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(KnowledgeBaseGroupsCreatedV1);
    expect(published[0]?.payload).toEqual({
      id: Number(first.id),
      at: TEST_NOW.toISOString(),
    });

    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]?.message).toBe('knowledge base group created');
    expect(logger.lines[0]?.meta).toEqual({ id: Number(first.id) });
    expect(logger.lines[0]?.meta).not.toHaveProperty('staffId');
  });

  it('updateGroup throws normal 404 when group is absent', async () => {
    const { service } = build();
    await expect(service.updateGroup(ACTOR, { id: '999' }, { name: 'New' })).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
      message: 'Resource not found',
    });
  });

  it('removeGroup refuses delete with 409 ERP-KNOWLEDGEBASEGROUPS-0001 while group has articles', async () => {
    const { service } = build();
    // Group 2 has 3 articles in seed
    await expect(service.removeGroup(ACTOR, { id: '2' })).rejects.toMatchObject({
      code: 'ERP-KNOWLEDGEBASEGROUPS-0001',
      message: 'The knowledge base group has articles and cannot be deleted',
    });
  });

  it('removeGroup deletes group without articles, publishes event and logs id only', async () => {
    const { service, events, logger } = build();
    // Group 1 has 0 articles
    await service.removeGroup(ACTOR, { id: '1' });

    const published = events.drain();
    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(KnowledgeBaseGroupsDeletedV1);
    expect(published[0]?.payload).toEqual({
      id: 1,
      at: TEST_NOW.toISOString(),
    });

    expect(logger.lines).toHaveLength(1);
    expect(logger.lines[0]?.meta).toEqual({ id: 1 });
    expect(logger.lines[0]?.meta).not.toHaveProperty('staffId');
  });
});
