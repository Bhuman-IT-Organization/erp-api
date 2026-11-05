import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { TodoController } from '../controller/todo.controller.js';
import type { TodoService } from '../service/todo.service.js';

const USER = { isAdmin: false, staffId: 5 } as unknown as AuthenticatedUser;

function build() {
  const service = {
    list: vi.fn().mockResolvedValue('list'),
    get: vi.fn().mockResolvedValue('get'),
    create: vi.fn().mockResolvedValue('create'),
    update: vi.fn().mockResolvedValue('update'),
    setFinished: vi.fn().mockResolvedValue('finished'),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  return { service, controller: new TodoController(service as unknown as TodoService) };
}

describe('TodoController', () => {
  it('hands the actor and the raw input to the service and returns its answer', async () => {
    const { controller, service } = build();
    const query = { status: 'unfinished' };
    const params = { id: '1' };
    const body = { description: 'a' };
    const finish = { finished: true };

    await expect(controller.list(USER, query)).resolves.toBe('list');
    await expect(controller.get(USER, params)).resolves.toBe('get');
    await expect(controller.create(USER, body)).resolves.toBe('create');
    await expect(controller.update(USER, params, body)).resolves.toBe('update');
    await expect(controller.setFinished(USER, params, finish)).resolves.toBe('finished');
    await expect(controller.remove(USER, params)).resolves.toBeUndefined();

    expect(service.list).toHaveBeenCalledWith(USER, query);
    expect(service.get).toHaveBeenCalledWith(USER, params);
    expect(service.create).toHaveBeenCalledWith(USER, body);
    expect(service.update).toHaveBeenCalledWith(USER, params, body);
    expect(service.setFinished).toHaveBeenCalledWith(USER, params, finish);
    expect(service.remove).toHaveBeenCalledWith(USER, params);
  });
});
