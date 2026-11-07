import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { GATED_ROUTES, PERMISSIONS, ROUTE_GATES } from '@erp/contracts';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { KnowledgeBaseGroupsController } from '../controller/knowledge-base-groups.controller.js';
import { KNOWLEDGE_BASE_GROUPS_PERMISSIONS } from '../knowledge-base-groups.routes.js';

type HandlerName = Exclude<keyof KnowledgeBaseGroupsController, 'constructor'>;

const SCREEN_READS: Readonly<Record<string, HandlerName | null>> = {
  '/setup/knowledge-base-groups': 'listGroups',
  '/setup/knowledge-base-groups/new': null,
  '/setup/knowledge-base-groups/:id': 'getGroup',
};

const OTHER_HANDLERS: Readonly<Record<string, string>> = {
  exportGroups: '/setup/knowledge-base-groups',
  createGroup: '/setup/knowledge-base-groups/new',
  updateGroup: '/setup/knowledge-base-groups/:id',
  removeGroup: '/setup/knowledge-base-groups/:id',
};

const HANDLERS = KnowledgeBaseGroupsController.prototype as unknown as Record<string, object>;

const metadata = (key: string, handler: string): unknown =>
  Reflect.getMetadata(key, HANDLERS[handler] ?? {});

const handlerNames = (): string[] =>
  Object.getOwnPropertyNames(KnowledgeBaseGroupsController.prototype).filter(
    (name) => name !== 'constructor',
  );

describe('ROUTE_GATES declares the knowledge-base-groups screens gated on view', () => {
  it.each(Object.keys(SCREEN_READS))('%s is gated on knowledgeBase.articles.view', (route) => {
    expect(GATED_ROUTES).toContain(route);
    expect(ROUTE_GATES[route]).toBe(PERMISSIONS.knowledgeBase.articles.view);
  });
});

describe('every knowledge-base-groups handler is classified and permission-gated', () => {
  it('classifies every handler of the controller: a new endpoint fails until it is named here', () => {
    const classified = [
      ...Object.values(SCREEN_READS).filter((name): name is HandlerName => name !== null),
      ...Object.keys(OTHER_HANDLERS),
    ].sort();
    expect(handlerNames().sort()).toEqual(classified);
    const unknown = Object.values(OTHER_HANDLERS).filter((route) => !(route in SCREEN_READS));
    expect(unknown, 'a handler is filed against a screen that is not gated').toEqual([]);
  });

  it.each(handlerNames())('%s carries exactly JwtAuthGuard, PermissionGuard', (handler) => {
    expect(metadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, PermissionGuard]);
  });

  it.each(['listGroups', 'exportGroups', 'getGroup'])(
    '%s declares knowledgeBase.articles.view',
    (handler) => {
      expect(metadata(PERMISSIONS_KEY, handler)).toEqual([KNOWLEDGE_BASE_GROUPS_PERMISSIONS.view]);
      expect(metadata(PERMISSIONS_ANY_KEY, handler)).toBeUndefined();
    },
  );

  it('createGroup declares knowledgeBase.articles.create', () => {
    expect(metadata(PERMISSIONS_KEY, 'createGroup')).toEqual([
      KNOWLEDGE_BASE_GROUPS_PERMISSIONS.create,
    ]);
    expect(metadata(PERMISSIONS_ANY_KEY, 'createGroup')).toBeUndefined();
  });

  it('updateGroup declares knowledgeBase.articles.edit', () => {
    expect(metadata(PERMISSIONS_KEY, 'updateGroup')).toEqual([
      KNOWLEDGE_BASE_GROUPS_PERMISSIONS.edit,
    ]);
    expect(metadata(PERMISSIONS_ANY_KEY, 'updateGroup')).toBeUndefined();
  });

  it('removeGroup declares knowledgeBase.articles.delete', () => {
    expect(metadata(PERMISSIONS_KEY, 'removeGroup')).toEqual([
      KNOWLEDGE_BASE_GROUPS_PERMISSIONS.delete,
    ]);
    expect(metadata(PERMISSIONS_ANY_KEY, 'removeGroup')).toBeUndefined();
  });
});
