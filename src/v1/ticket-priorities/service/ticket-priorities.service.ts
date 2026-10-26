/* eslint-disable @typescript-eslint/no-unused-vars -- intentionally keeping _user for standard method signatures */
import { Injectable } from '@nestjs/common';
import { TicketPrioritiesRepository } from '../repository/ticket-priorities.repository.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { SettingsFacade } from '../../settings/index.js';

interface PriorityRow {
  priorityid: number;
  name: string;
}

@Injectable()
export class TicketPrioritiesService {
  constructor(
    private readonly repository: TicketPrioritiesRepository,
    private readonly settingsFacade: SettingsFacade,
  ) {}
  /** Maps a DB row (priorityid) to the API response shape (id). */
  private toDto(row: PriorityRow) {
    return { id: row.priorityid, name: row.name };
  }

  async list(_user: AuthenticatedUser) {
    try {
      const result = (await this.repository.findAll()) as PriorityRow[] | null;
      const rows = result ?? [];
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
    let defaultPriority: string | null = null;
    try {
      defaultPriority = await this.settingsFacade.getOption(
        'email_piping_default_priority' as Parameters<SettingsFacade['getOption']>[0],
      );
    } catch {
      // Setting not readable: treat it as "no default"
    }
    // Checked outside the try/catch so this error is not swallowed.
    if (Number(defaultPriority) === priorityId) {
      throw new AppError('ERP-VALIDATION-0001', 'is_referenced');
    }

    await this.repository.delete(priorityId);
  }
}
