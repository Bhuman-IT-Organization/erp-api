import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { ServicesController } from '../controller/services.controller.js';
import type { ServicesService } from '../service/services.service.js';

const USER = { isAdmin: true, staffId: 1 } as unknown as AuthenticatedUser;

function build() {
  const service = {
    list: vi.fn().mockResolvedValue('list'),
    get: vi.fn().mockResolvedValue('get'),
    create: vi.fn().mockResolvedValue('create'),
    update: vi.fn().mockResolvedValue('update'),
    remove: vi.fn().mockResolvedValue(undefined),
  };
  return { service, controller: new ServicesController(service as unknown as ServicesService) };
}

describe('ServicesController', () => {
  it('hands the actor and the raw input to the service and returns its answer', async () => {
    const { controller, service } = build();
    const query = { q: 'a' };
    const params = { id: '1' };
    const body = { name: 'a' };

    await expect(controller.list(USER, query)).resolves.toBe('list');
    await expect(controller.get(USER, params)).resolves.toBe('get');
    await expect(controller.create(USER, body)).resolves.toBe('create');
    await expect(controller.update(USER, params, body)).resolves.toBe('update');
    await expect(controller.remove(USER, params)).resolves.toBeUndefined();

    expect(service.list).toHaveBeenCalledWith(USER, query);
    expect(service.get).toHaveBeenCalledWith(USER, params);
    expect(service.create).toHaveBeenCalledWith(USER, body);
    expect(service.update).toHaveBeenCalledWith(USER, params, body);
    expect(service.remove).toHaveBeenCalledWith(USER, params);
  });
});
