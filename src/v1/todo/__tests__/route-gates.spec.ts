import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { describe, expect, it } from 'vitest';
import { AUTHENTICATED_GATE, GATED_ROUTES, ROUTE_GATES } from '@erp/contracts';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { TodoController } from '../controller/todo.controller.js';
import { TodoService } from '../service/todo.service.js';

type Handler = Exclude<keyof TodoController, 'constructor'>;

const HANDLERS = TodoController.prototype as unknown as Record<string, object>;

const SCREEN_GATES: Readonly<Record<string, Handler | null>> = {
  '/setup/todo': 'list',
  '/setup/todo/new': null,
  '/setup/todo/:id': 'get',
};

const EXPECTED_HANDLERS: readonly Handler[] = [
  'list',
  'get',
  'create',
  'update',
  'reorder',
  'setFinished',
  'remove',
];

const methods = (): string[] =>
  Object.getOwnPropertyNames(TodoController.prototype).filter((name) => name !== 'constructor');

const metadata = (key: string, name: string): unknown =>
  Reflect.getMetadata(key, HANDLERS[name] ?? {});

describe('Todo authenticated route contract', () => {
  it.each(Object.keys(SCREEN_GATES))('%s is declared as AUTHENTICATED_GATE', (route) => {
    expect(GATED_ROUTES).toContain(route);
    expect(ROUTE_GATES[route]).toBe(AUTHENTICATED_GATE);
  });

  it('classifies every handler and requires authentication without permission codes', () => {
    expect(methods().sort()).toEqual([...EXPECTED_HANDLERS].sort());

    for (const handler of methods()) {
      expect(metadata(GUARDS_METADATA, handler)).toEqual([JwtAuthGuard, PermissionGuard]);
      expect(metadata(PERMISSIONS_KEY, handler)).toBeUndefined();
      expect(metadata(PERMISSIONS_ANY_KEY, handler)).toBeUndefined();
    }
  });
  it('does not require administrator access in service handlers', () => {
    for (const handler of EXPECTED_HANDLERS) {
      const method = (TodoService.prototype as unknown as Record<string, unknown>)[handler];

      if (typeof method === 'function') {
        expect(String(method)).not.toContain('assertAdministrator(');
      }
    }
  });
});
