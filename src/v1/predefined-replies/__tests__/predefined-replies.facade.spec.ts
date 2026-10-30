import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type AuthenticatedUser,
} from '../../../shared/http/auth/access-token-verifier.js';
import { EventsModule } from '../../../shared/events/events.module.js';
import { LoggerModule } from '../../../shared/logger/logger.module.js';
import { PredefinedRepliesFacade } from '../facade/predefined-replies.facade.js';
import { PredefinedRepliesModule } from '../predefined-replies.module.js';
import { PredefinedRepliesRepository } from '../repository/predefined-replies.repository.js';
import { asRepository, InMemoryPredefinedRepliesRepository } from './fakes.js';

const ADMIN = {
  staffId: 1,
  sessionId: 'facade-test-session',
  jti: 'facade-test-jti',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: 4_102_444_800,
} satisfies AuthenticatedUser;

class StubAccessTokenVerifier implements AccessTokenVerifier {
  verifyAccessToken(): Promise<AuthenticatedUser | null> {
    return Promise.resolve(ADMIN);
  }

  hasPermission(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: ACCESS_TOKEN_VERIFIER,
      useClass: StubAccessTokenVerifier,
    },
  ],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class StubVerifierModule {}

describe('PredefinedRepliesFacade through PredefinedRepliesModule', () => {
  it('exposes actor-free reads and returns stored HTML unchanged', async () => {
    const repository = new InMemoryPredefinedRepliesRepository();

    const second = await repository.create({
      name: 'Second',
      message: '<p>Stored <b>HTML</b></p>',
    });

    const first = await repository.create({
      name: 'First',
      message: '<p>First</p>',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, EventsModule, StubVerifierModule, PredefinedRepliesModule],
    })
      .overrideProvider(PredefinedRepliesRepository)
      .useValue(asRepository(repository))
      .compile();

    try {
      const facade = moduleRef.get(PredefinedRepliesFacade);

      await expect(facade.list(ADMIN, {})).resolves.toMatchObject({
        data: [
          { id: String(second.id), name: 'Second' },
          { id: String(first.id), name: 'First' },
        ],
        meta: { total: 2 },
      });

      await expect(facade.listAll()).resolves.toEqual([first, second]);

      await expect(facade.findById(second.id)).resolves.toEqual(second);

      await expect(facade.findById(404)).resolves.toBeNull();

      await expect(facade.findByIds([second.id, first.id, second.id, 404])).resolves.toEqual([
        second,
        first,
      ]);
    } finally {
      await moduleRef.close();
    }
  });
});
