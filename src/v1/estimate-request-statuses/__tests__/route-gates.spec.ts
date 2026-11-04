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
import { EstimateRequestStatusesController } from '../controller/estimate-request-statuses.controller.js';
import { EstimateRequestStatusesService } from '../service/estimate-request-statuses.service.js';

type HandlerName = Exclude<keyof EstimateRequestStatusesController, 'constructor'>;

const SCREEN_READS: Readonly<Record<string, HandlerName | null>> = {
  '/setup/estimate-request-statuses': 'list',
  '/setup/estimate-request-statuses/new': null,
  '/setup/estimate-request-statuses/:id': 'get',
};

const OTHER_HANDLERS: Readonly<Record<string, string>> = {
  exportCsv: '/setup/estimate-request-statuses',
  remove: '/setup/estimate-request-statuses',
  create: '/setup/estimate-request-statuses/new',
  update: '/setup/estimate-request-statuses/:id',
};

const HANDLERS = EstimateRequestStatusesController.prototype as unknown as Record<string, object>;
const metadata = (key: string, handler: string): unknown =>
  Reflect.getMetadata(key, HANDLERS[handler] ?? {});
const handlerNames = (): string[] =>
  Object.getOwnPropertyNames(EstimateRequestStatusesController.prototype).filter(
    (name) => name !== 'constructor',
  );

function assertsAdministrator(handler: string): boolean {
  const method = (EstimateRequestStatusesService.prototype as unknown as Record<string, unknown>)[
    handler
  ];
  return typeof method === 'function' && String(method).includes('assertAdministrator(');
}

describe('estimate-request-statuses route gates', () => {
  it.each(Object.keys(SCREEN_READS))('%s is administrator-only', (route) => {
    expect(GATED_ROUTES).toContain(route);
    expect(ROUTE_GATES[route]).toBe(ADMIN_GATE);
  });

  it('classifies every controller handler under one of the three gated screens', () => {
    const classified = [
      ...Object.values(SCREEN_READS).filter((name): name is HandlerName => name !== null),
      ...Object.keys(OTHER_HANDLERS),
    ].sort();
    expect(handlerNames().sort()).toEqual(classified);
    expect(Object.values(OTHER_HANDLERS).every((route) => route in SCREEN_READS)).toBe(true);
  });

  it.each(handlerNames())(
    '%s has authentication guards, no code permissions, and an admin check',
    (handler) => {
      expect(metadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, PermissionGuard]);
      expect(metadata(PERMISSIONS_KEY, handler)).toBeUndefined();
      expect(metadata(PERMISSIONS_ANY_KEY, handler)).toBeUndefined();
      expect(assertsAdministrator(handler)).toBe(true);
    },
  );
});
