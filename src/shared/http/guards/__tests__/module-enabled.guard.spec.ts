import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../config/app-config.js';
import { ModuleSwitch, type ModuleName } from '../../../config/modules.js';
import { AppError } from '../../../errors/app-error.js';
import { ModuleKey, ModuleOffNotFound } from '../../decorators/module-key.decorator.js';
import { ModuleEnabledGuard } from '../module-enabled.guard.js';

/** No module is switchable yet (`MODULE_NAMES` is empty); a stand-in name exercises the guard. */
const SAMPLE = 'sample' as ModuleName;

@ModuleKey(SAMPLE)
class KeyedController {
  handle(): void {
    return undefined;
  }
}

@ModuleKey(SAMPLE)
@ModuleOffNotFound()
class PublicController {
  handle(): void {
    return undefined;
  }
}

class UnkeyedController {
  handle(): void {
    return undefined;
  }
}

/** A reply that records the headers set on it. */
class RecordingReply {
  readonly headers: Record<string, string> = {};

  header(name: string, value: string): this {
    this.headers[name] = value;
    return this;
  }
}

function contextOf(
  controller: new () => { handle(): void },
  reply = new RecordingReply(),
): ExecutionContext {
  const instance = new controller();
  return {
    getHandler: () => instance.handle.bind(instance),
    getClass: () => controller,
    switchToHttp: () => ({ getResponse: () => reply }),
  } as unknown as ExecutionContext;
}

function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

function guardWith(disabled: readonly ModuleName[]): ModuleEnabledGuard {
  const modules = new ModuleSwitch({ env: { MODULES_DISABLED: disabled } } as unknown as AppConfig);
  return new ModuleEnabledGuard(new Reflector(), modules);
}

describe('ModuleEnabledGuard (ADR-0042, M6)', () => {
  it('passes a handler under a @ModuleKey class while the module is on', () => {
    expect(guardWith([]).canActivate(contextOf(KeyedController))).toBe(true);
  });

  it('fails closed on a class without @ModuleKey (a wiring defect)', () => {
    expect(() => guardWith([]).canActivate(contextOf(UnkeyedController))).toThrow(
      'ModuleEnabledGuard without @ModuleKey',
    );
  });

  it('answers the generic 404 with no-store and noindex on a @ModuleOffNotFound class while off (ADR-0051)', () => {
    const reply = new RecordingReply();
    const thrown = thrownBy(() =>
      guardWith([SAMPLE]).canActivate(contextOf(PublicController, reply)),
    );
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('ERP-CORE-0004');
    expect((thrown as AppError).status).toBe(404);
    expect(reply.headers).toEqual({
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    });
  });

  it('passes a @ModuleOffNotFound class while the module is on and sets no header', () => {
    const reply = new RecordingReply();
    expect(guardWith([]).canActivate(contextOf(PublicController, reply))).toBe(true);
    expect(reply.headers).toEqual({});
  });
});
