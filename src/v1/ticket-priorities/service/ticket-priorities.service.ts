/* eslint-disable @typescript-eslint/no-unused-vars -- intentionally keeping _user for standard method signatures */
import { Injectable, Inject } from '@nestjs/common';
import { TicketPrioritiesRepository } from '../repository/ticket-priorities.repository.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';

interface PriorityRow {
  priorityid: number;
  name: string;
}

// Define a local interface to avoid the restricted concrete import
interface ISettingsFacade {
  get(key: string): Promise<string>;
}

@Injectable()
export class TicketPrioritiesService {
  constructor(
    private readonly repository: TicketPrioritiesRepository,
    @Inject('SettingsFacade') private readonly settingsFacade: ISettingsFacade,
  ) {}

  /** Maps a DB row (priorityid) to the API response shape (id). */
  private toDto(row: PriorityRow) {
    return { id: row.priorityid, name: row.name };
  }

  async list(_user: AuthenticatedUser) {
    // Silences the unused variable warning
    try {
      const rows = await this.repository.findAll();
      return {
        data: rows.map((r: PriorityRow) => this.toDto(r)),
        meta: { total: rows.length },
      };
    } catch (error) {
      if (error instanceof AppError && error.code === 'ERP-CORE-0004') {
        return { data: [], meta: { total: 0 } };
      }
      throw error;
    }
  }

  async get(_user: AuthenticatedUser, params: { id: string | number }) {
    const item = await this.repository.findById(Number(params.id));
    if (!item) {
      throw new AppError('ERP-CORE-0004', 'Priority not found');
    }
    return this.toDto(item);
  }

  async create(_user: AuthenticatedUser, body: { name: string }) {
    const created = await this.repository.create({
      name: body.name,
    });
    return this.toDto(created);
  }

  async update(_user: AuthenticatedUser, params: { id: string | number }, body: { name?: string }) {
    const updated = await this.repository.update(Number(params.id), body);
    return this.toDto(updated);
  }

  async remove(_user: AuthenticatedUser, params: { id: string | number }) {
    const priorityId = Number(params.id);

    if (await this.repository.isReferenced(priorityId)) {
      throw new AppError('ERP-VALIDATION-0001', 'is_referenced');
    }

    // Look up the default priority setting; a failed lookup must not block delete.
    let defaultPriority: unknown = null;
    try {
      defaultPriority = await this.settingsFacade.get('email_piping_default_priority');
    } catch {
      // Ignore settings lookup failures if the setting doesn't exist
    }

    // Checked outside the try/catch so this error is not swallowed.
    if (Number(defaultPriority) === priorityId) {
      throw new AppError('ERP-VALIDATION-0001', 'is_referenced');
    }

    await this.repository.delete(priorityId);
  }
}
