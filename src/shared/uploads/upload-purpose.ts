/**
 * Upload purposes (ADR-0041 §4): every tus upload names one in its `Upload-Metadata`, and the
 * module that owns the resulting rows registers it here in its `onModuleInit`. A purpose says who may use it (any-of clean permission codes),
 * where its bytes live (`storageArea`), its limits (`rules`) and what happens once a checked file is
 * in storage (`onComplete`, which writes the row). `shared/` owns no purpose itself.
 */
import { Injectable } from '@nestjs/common';

/** The route of the tus endpoint: `/api/v1/uploads` and `/api/v1/uploads/:id`. */
export const UPLOADS_ROUTE = 'uploads';

/** The final PATCH's header naming what `onComplete` created. */
export const UPLOAD_RESOURCE_HEADER = 'Erp-Upload-Resource';

/** A purpose name: lower-case words joined by `.` or `-`, e.g. `expense-categories.import`. */
const PURPOSE_NAME = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** A purpose's limits; the service answers the stricter of these and the env limits (P-11). */
export interface UploadRules {
  readonly maxBytes: number;
  /** Files per save, shown by K8 and checked by the browser. */
  readonly maxFiles: number;
  /** Lower case, no dot. */
  readonly extensions: readonly string[];
}

/** A complete upload that passed every check and is already in `STORAGE`. */
export interface CheckedUpload {
  readonly uploadId: string;
  readonly purpose: string;
  readonly staffId: number;
  readonly fileName: string;
  readonly size: number;
  readonly mime: string;
  readonly extension: string;
  /** The `STORAGE` key the bytes were moved to. */
  readonly storageKey: string;
  /** The client's other metadata keys (not `purpose`, `filename`, `staffId`), as sent at creation. */
  readonly meta: Readonly<Record<string, string>>;
}

/** What a module registers to accept uploads. */
export interface UploadPurpose {
  readonly name: string;
  /** Clean permission codes; the caller must hold one (an administrator holds every code). */
  readonly anyOf: readonly string[];
  /** The first segment of the storage key (`newStorageKey(storageArea)`). */
  readonly storageArea: string;
  rules(staffId: number): Promise<UploadRules>;
  /** Writes the owning row; a thrown `AppError` reaches the client with its own status. */
  onComplete(upload: CheckedUpload): Promise<{ readonly resourceId: string }>;
}

/** The purposes the running api accepts. */
@Injectable()
export class UploadPurposeRegistry {
  private readonly purposes = new Map<string, UploadPurpose>();

  /** Throws on a malformed or already registered name. */
  register(purpose: UploadPurpose): void {
    if (!PURPOSE_NAME.test(purpose.name)) {
      throw new Error(`invalid upload purpose name ${JSON.stringify(purpose.name)}`);
    }
    if (this.purposes.has(purpose.name)) {
      throw new Error(`upload purpose ${purpose.name} is already registered`);
    }
    this.purposes.set(purpose.name, purpose);
  }

  get(name: string): UploadPurpose | undefined {
    return this.purposes.get(name);
  }
}
