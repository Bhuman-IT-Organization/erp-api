import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { ADMIN_GATE, GATED_ROUTES, ROUTE_GATES } from '@erp/contracts';
import { describe, expect, it } from 'vitest';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { PredefinedRepliesController } from '../controller/predefined-replies.controller.js';
import { PredefinedRepliesService } from '../service/predefined-replies.service.js';

type Handler = 'list' | 'exportCsv' | 'get' | 'create' | 'update' | 'remove';

const SCREEN_READS: Readonly<Record<string, Handler | null>> = {
  '/setup/predefined-replies': 'list',
  '/setup/predefined-replies/new': null,
  '/setup/predefined-replies/:id': 'get',
};

const OTHER_HANDLERS: Readonly<Record<string, string>> = {
  exportCsv: '/setup/predefined-replies',
  create: '/setup/predefined-replies/new',
  update: '/setup/predefined-replies/:id',
  remove: '/setup/predefined-replies/:id',
};

const HANDLERS = PredefinedRepliesController.prototype as unknown as Record<string, object>;

const metadata = (key: string, handler: Handler): unknown =>
  Reflect.getMetadata(key, HANDLERS[handler] ?? {});

const handlerNames = (): Handler[] =>
  Object.getOwnPropertyNames(PredefinedRepliesController.prototype).filter(
    (name): name is Handler => name !== 'constructor',
  );

function assertsAdministrator(handler: Handler): boolean {
  const method = (PredefinedRepliesService.prototype as unknown as Record<string, unknown>)[
    handler
  ];
  return typeof method === 'function' && String(method).includes('assertAdministrator(');
}

describe('predefined-replies route gates', () => {
  it.each(Object.keys(SCREEN_READS))('%s is declared administrator-only', (route) => {
    expect(GATED_ROUTES).toContain(route);
    expect(ROUTE_GATES[route]).toBe(ADMIN_GATE);
  });

  it('classifies every controller handler', () => {
    expect(handlerNames().sort()).toEqual(
      [
        ...Object.values(SCREEN_READS).filter((name): name is Handler => name !== null),
        ...Object.keys(OTHER_HANDLERS),
      ].sort(),
    );
    expect(Object.values(OTHER_HANDLERS).every((route) => route in SCREEN_READS)).toBe(true);
  });

  it.each(handlerNames())(
    '%s has authentication and permission guards but no permission-code decorator',
    (handler) => {
      expect(metadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, PermissionGuard]);
      expect(metadata(PERMISSIONS_KEY, handler)).toBeUndefined();
      expect(metadata(PERMISSIONS_ANY_KEY, handler)).toBeUndefined();
    },
  );

  it.each(handlerNames())('%s enforces administrator access in the service', (handler) => {
    expect(assertsAdministrator(handler)).toBe(true);
  });
});
