import { Injectable } from '@nestjs/common';
import type { Service } from '../model/services.model.js';
import { ServicesService, type ServicesDescription } from '../service/services.service.js';

/**
 * Provides read-only access to service data for other modules.
 */
@Injectable()
export class ServicesFacade {
  /**
   * Creates the services facade.
   * @param service - The services service instance.
   */
  constructor(private readonly service: ServicesService) {}

  /**
   * Returns the services module description.
   * @returns The module description.
   */
  describe(): ServicesDescription {
    return this.service.describe();
  }

  /**
   * Finds a service by its ID.
   * @param id - The service ID.
   * @returns The service if found, otherwise null.
   */
  findById(id: number): Promise<Service | null> {
    return this.service.findById(id);
  }

  /**
   * Returns all services.
   * @returns A list of services.
   */
  listAll(): Promise<readonly Service[]> {
    return this.service.listAll();
  }

  /**
   * Finds services matching the supplied IDs.
   * @param ids - The service IDs to find.
   * @returns The matching services.
   */
  findByIds(ids: readonly number[]): Promise<readonly Service[]> {
    return this.service.findByIds(ids);
  }
}
