/**
 * Verifies that Lead Statuses screens are declared administrator-only and that every
 * controller handler uses the expected guards and calls assertAdministrator in its service.
 */
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
import { LeadStatusesController } from '../controller/lead-statuses.controller.js';
import { LeadStatusesService } from '../service/lead-statuses.service.js';

type HandlerName = Exclude<keyof LeadStatusesController, 'constructor'>;

const SCREEN_READS: Readonly<Record<string, HandlerName | null>> = {
  '/setup/lead-statuses': 'list',
  '/setup/lead-statuses/new': null,
  '/setup/lead-statuses/:id': 'get',
};

const OTHER_HANDLERS: Readonly<Record<string, string>> = {
  exportCsv: '/setup/lead-statuses',
  create: '/setup/lead-statuses/new',
  update: '/setup/lead-statuses/:id',
  remove: '/setup/lead-statuses/:id',
};

const HANDLERS = LeadStatusesController.prototype as unknown as Record<string, object>;

const metadata = (key: string, handler: string): unknown =>
  Reflect.getMetadata(key, HANDLERS[handler] ?? {});

const handlerNames = (): string[] =>
  Object.getOwnPropertyNames(LeadStatusesController.prototype).filter(
    (name) => name !== 'constructor',
  );

function assertsAdministrator(handler: string): boolean {
  const method = (LeadStatusesService.prototype as unknown as Record<string, unknown>)[handler];

  return typeof method === 'function' && String(method).includes('assertAdministrator(');
}

describe('ROUTE_GATES declares Lead Statuses screens administrator-only', () => {
  it.each(Object.keys(SCREEN_READS))('%s is gated ADMIN_GATE', (route) => {
    expect(GATED_ROUTES).toContain(route);
    expect(ROUTE_GATES[route]).toBe(ADMIN_GATE);
  });
});

describe('every Lead Statuses handler is classified and administrator-only', () => {
  it('classifies every controller handler', () => {
    const classified = [
      ...Object.values(SCREEN_READS).filter((name): name is HandlerName => name !== null),
      ...Object.keys(OTHER_HANDLERS),
    ].sort();

    expect(handlerNames().sort()).toEqual(classified);

    const unknown = Object.values(OTHER_HANDLERS).filter((route) => !(route in SCREEN_READS));

    expect(unknown, 'a handler is filed against a screen that is not gated').toEqual([]);
  });

  it.each(handlerNames())('%s carries JwtAuthGuard and PermissionGuard', (handler) => {
    expect(metadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, PermissionGuard]);
  });

  it.each(handlerNames())('%s declares no permission-code decorator', (handler) => {
    expect(metadata(PERMISSIONS_KEY, handler), `${handler}: no @Permissions`).toBeUndefined();

    expect(
      metadata(PERMISSIONS_ANY_KEY, handler),
      `${handler}: no @PermissionsAny`,
    ).toBeUndefined();
  });

  it.each(handlerNames())('LeadStatusesService.%s calls assertAdministrator', (handler) => {
    expect(assertsAdministrator(handler)).toBe(true);
  });
});
