/**
 * Provides `STORAGE` everywhere (ADR-0041): `VolumeStorage` at `FILE_STORAGE_DIR`. The env schema
 * requires the variable outside `NODE_ENV=test`; a unit app without it still boots, and any storage
 * call it makes rejects with `FILE_STORAGE_DIR is not set`, so a test that stores files without
 * configuring storage fails loudly instead of writing somewhere unexpected.
 */
import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { STORAGE, type StoragePort } from './storage.port.js';
import { VolumeStorage } from './volume.storage.js';

const unconfigured = (): Promise<never> => Promise.reject(new Error('FILE_STORAGE_DIR is not set'));

/** The storage a unit app gets when `FILE_STORAGE_DIR` is unset: every call rejects. */
const UNCONFIGURED_STORAGE: StoragePort = {
  putFile: unconfigured,
  putStream: unconfigured,
  read: unconfigured,
  stat: unconfigured,
  delete: unconfigured,
};

/** `STORAGE` from the validated env. */
@Global()
@Module({
  providers: [
    {
      provide: STORAGE,
      inject: [AppConfig],
      useFactory: (config: AppConfig): StoragePort => {
        const dir = config.env.FILE_STORAGE_DIR;
        return dir === undefined ? UNCONFIGURED_STORAGE : new VolumeStorage(dir);
      },
    },
  ],
  exports: [STORAGE],
})
export class StorageModule {}
