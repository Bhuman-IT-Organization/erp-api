import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { ADMIN_GATE, GATED_ROUTES, ROUTE_GATES } from '@erp/contracts';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { LeadSourcesController } from '../controller/lead-sources.controller.js';
import { LeadSourcesService } from '../service/lead-sources.service.js';

type HandlerName = Exclude<keyof LeadSourcesController, 'constructor'>;
const SCREEN_READS: Readonly<Record<string, HandlerName | null>> = {
  '/setup/lead-sources': 'list',
  '/setup/lead-sources/new': null,
  '/setup/lead-sources/:id': 'get',
};
const OTHER_HANDLERS: Readonly<Record<string, string>> = {
  exportCsv: '/setup/lead-sources',
  remove: '/setup/lead-sources',
  create: '/setup/lead-sources/new',
  update: '/setup/lead-sources/:id',
};
const HANDLERS = LeadSourcesController.prototype as unknown as Record<string, object>;
const metadata = (key: string, handler: string): unknown =>
  Reflect.getMetadata(key, HANDLERS[handler] ?? {});
const handlerNames = (): string[] =>
  Object.getOwnPropertyNames(LeadSourcesController.prototype).filter(
    (name) => name !== 'constructor',
  );

function assertsAdministrator(handler: string): boolean {
  const method = (LeadSourcesService.prototype as unknown as Record<string, unknown>)[handler];
  return typeof method === 'function' && String(method).includes('assertAdministrator(');
}

describe('lead-source route gates', () => {
  it.each(Object.keys(SCREEN_READS))('%s is administrator-only', (route) => {
    expect(GATED_ROUTES).toContain(route);
    expect(ROUTE_GATES[route]).toBe(ADMIN_GATE);
  });

  it('classifies every controller handler', () => {
    const classified = [
      ...Object.values(SCREEN_READS).filter((name): name is HandlerName => name !== null),
      ...Object.keys(OTHER_HANDLERS),
    ].sort();
    expect(handlerNames().sort()).toEqual(classified);
    expect(Object.values(OTHER_HANDLERS).filter((route) => !(route in SCREEN_READS))).toEqual([]);
  });

  it.each(handlerNames())(
    '%s has both authentication guards and no permission decorators',
    (handler) => {
      expect(metadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, PermissionGuard]);
      expect(metadata(PERMISSIONS_KEY, handler)).toBeUndefined();
      expect(metadata(PERMISSIONS_ANY_KEY, handler)).toBeUndefined();
    },
  );

  it.each(handlerNames())('%s asserts administrator access in the service', (handler) => {
    expect(assertsAdministrator(handler)).toBe(true);
  });
});
