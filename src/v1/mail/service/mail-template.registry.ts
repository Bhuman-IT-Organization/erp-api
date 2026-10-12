/**
 * The email templates the running process knows (RESEARCH R4, the `UploadPurposeRegistry` form).
 * A sending module registers its `MailTemplateDefinition` through `MailFacade.register` from its own
 * `onModuleInit`: the worker imports `V1Module` too, so registration there runs in both processes and
 * the worker can render and resolve every template it sends (Pitfall 12). A definition registered
 * from a controller or a lazy path would be missing in the worker.
 *
 * A malformed or duplicate definition throws at boot, so a slice cannot ship a template the editor,
 * the preview or the send would trip over later: a sample or fallback key the api's messages lack
 * fails here, not in front of an administrator.
 */
import { Injectable } from '@nestjs/common';
import { STORAGE_KEY } from '../../../shared/storage/storage.port.js';
import { MAIL_AUDIENCES, type MailAudience } from '../model/mail.model.js';
import { isMailMessageKey, messageOf, type MailMessageKey } from './mail.messages.js';

export interface MergeFieldDefinition {
  /** The Perfex key without braces, `/^[a-z][a-z0-9_]*$/`, unique per template. */
  readonly token: string;
  /** `url`: a link in the HTML part when its value is http(s). */
  readonly kind: 'text' | 'url';
  /** The `MAIL_MESSAGES` key of the synthetic sample value the preview and the test send use. */
  readonly sampleKey: MailMessageKey;
}

/** The most files one mail may carry (ADR-0052 decision 3); their total is capped by `UPLOAD_MAX_BYTES`. */
export const MAIL_ATTACHMENTS_MAX = 5;

/** One file a resolver attaches (ADR-0052): the send processor reads its bytes from `STORAGE` at send time. */
export interface MailAttachment {
  /** A Node storage key the owning module stored itself (`STORAGE_KEY`); never a path, URL or request value. */
  readonly storageKey: string;
  /** What the recipient sees: 1..255 characters, no '/', '\\' or control character. */
  readonly fileName: string;
  /** `^[a-z]+\/[a-z0-9.+-]+$`. */
  readonly contentType: string;
}

export interface ResolvedMail {
  /** `locale` null: the deployment default. */
  readonly to: { readonly email: string; readonly locale: string | null };
  /** Every token, already formatted by the owning module (D-10). */
  readonly values: Readonly<Record<string, string>>;
  /** ADR-0052: resolved at send time like the recipient; absent means none. */
  readonly attachments?: readonly MailAttachment[];
}

export interface MailTemplateDefinition {
  /** The Perfex slug, `/^[a-z][a-z0-9_]*$/`, at most 100 characters. */
  readonly key: string;
  /** The owning module's legacy name key, `/^[a-z][a-z0-9_]*$/`, at most 64 characters. */
  readonly module: string;
  readonly audience: MailAudience;
  readonly mergeFields: readonly MergeFieldDefinition[];
  /**
   * Perfex's slug when it does not fit the key grammar (e.g. `staff-forgot-password`): read
   * only to seed (`ensureSeeded` reads Perfex's rows by `legacySlug ?? key`). `LEGACY_SLUG`, at
   * most 100 characters, unique among the registered definitions.
   */
  readonly legacySlug?: string;
  /** The wording seeded when Perfex has no English row for the key. */
  readonly fallback: { readonly subjectKey: MailMessageKey; readonly messageKey: MailMessageKey };
  /** The record's recipient and values; `null` when the record is gone. */
  resolve(sourceRef: string): Promise<ResolvedMail | null>;
}

/** A template key, a module key and a merge-field token share one grammar. */
const NAME = /^[a-z][a-z0-9_]*$/u;
/** `tblmail_templates.template_key` is VARCHAR(100), Perfex's `slug` width. */
const KEY_MAX = 100;
/** `tblmail_templates.module` is VARCHAR(64). */
const MODULE_MAX = 64;
const KINDS: readonly string[] = ['text', 'url'];
/** Perfex's `tblemailtemplates.slug` grammar: the key's, plus the hyphen Perfex's module slugs use. */
const LEGACY_SLUG = /^[a-z][a-z0-9_-]*$/u;

/** What is wrong with one merge field (`seen`: the tokens before it), or null. */
function fieldProblem(field: MergeFieldDefinition, seen: ReadonlySet<string>): string | null {
  const sampleKey: string = field.sampleKey;
  if (!NAME.test(field.token))
    return `merge field ${JSON.stringify(field.token)} must match ${NAME.source}`;
  if (seen.has(field.token)) return `merge field ${field.token} is listed twice`;
  if (!KINDS.includes(field.kind)) return `merge field ${field.token} has an unknown kind`;
  if (!isMailMessageKey(sampleKey)) {
    return `merge field ${field.token} names sample key ${sampleKey}, which MAIL_MESSAGES lacks`;
  }
  return null;
}

/** What is wrong with an optional `legacySlug`, or null. */
function legacySlugProblem(slug: string | undefined): string | null {
  if (slug === undefined || (LEGACY_SLUG.test(slug) && slug.length <= KEY_MAX)) return null;
  return `legacySlug must match ${LEGACY_SLUG.source} and be at most ${String(KEY_MAX)} characters`;
}

/** What is wrong with `definition`, or null when nothing is. */
function problemOf(definition: MailTemplateDefinition): string | null {
  if (!NAME.test(definition.key) || definition.key.length > KEY_MAX) {
    return `key must match ${NAME.source} and be at most ${String(KEY_MAX)} characters`;
  }
  if (!NAME.test(definition.module) || definition.module.length > MODULE_MAX) {
    return `module ${JSON.stringify(definition.module)} must match ${NAME.source} and be at most ${String(MODULE_MAX)} characters`;
  }
  const slugProblem = legacySlugProblem(definition.legacySlug);
  if (slugProblem !== null) return slugProblem;
  if (!(MAIL_AUDIENCES as readonly string[]).includes(definition.audience)) {
    return `audience is not one of ${MAIL_AUDIENCES.join(', ')}`;
  }
  const seen = new Set<string>();
  for (const field of definition.mergeFields) {
    const problem = fieldProblem(field, seen);
    if (problem !== null) return problem;
    seen.add(field.token);
  }
  const fallbackKeys: readonly string[] = [
    definition.fallback.subjectKey,
    definition.fallback.messageKey,
  ];
  const missing = fallbackKeys.find((key) => !isMailMessageKey(key));
  return missing === undefined ? null : `fallback key ${missing} is not in MAIL_MESSAGES`;
}

const FILE_NAME_MAX = 255;
/** A path separator or a control character (\p{Cc}: U+0000-001F, U+007F-009F) in a file name. */
const FILE_NAME_FORBIDDEN = /[/\\]|\p{Cc}/u;
const CONTENT_TYPE = /^[a-z]+\/[a-z0-9.+-]+$/u;

/**
 * Pure (ADR-0052 decisions 2 and 3): why `list` cannot be sent (more than `MAIL_ATTACHMENTS_MAX`,
 * a key outside `STORAGE_KEY`, a bad file name or content type), or null. Names no key or file name.
 */
export function attachmentsProblem(list: readonly MailAttachment[]): string | null {
  if (list.length > MAIL_ATTACHMENTS_MAX) {
    return `more than ${String(MAIL_ATTACHMENTS_MAX)} attachments`;
  }
  for (const [index, file] of list.entries()) {
    const at = `attachment ${String(index + 1)}`;
    if (!STORAGE_KEY.test(file.storageKey)) return `${at}: the storage key is not a storage key`;
    if (
      file.fileName.length === 0 ||
      file.fileName.length > FILE_NAME_MAX ||
      FILE_NAME_FORBIDDEN.test(file.fileName)
    ) {
      return `${at}: the file name is empty, too long or holds a slash, a backslash or a control character`;
    }
    if (!CONTENT_TYPE.test(file.contentType))
      return `${at}: the content type is not ${CONTENT_TYPE.source}`;
  }
  return null;
}

/** Every merge field filled with its synthetic sample in `locale` (preview and test sends, never data). */
export function sampleValuesOf(
  definition: MailTemplateDefinition,
  locale: string,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    definition.mergeFields.map((field) => [field.token, messageOf(locale, field.sampleKey)]),
  );
}

/** The tokens of `definition` whose value is a link in the HTML part. */
export function urlTokensOf(definition: MailTemplateDefinition): ReadonlySet<string> {
  return new Set(
    definition.mergeFields.filter((field) => field.kind === 'url').map((field) => field.token),
  );
}

@Injectable()
export class MailTemplateRegistry {
  private readonly definitions = new Map<string, MailTemplateDefinition>();

  /** Throws on a malformed definition, a key already registered or a legacySlug already seeded from. */
  register(definition: MailTemplateDefinition): void {
    const problem = problemOf(definition);
    if (problem !== null) throw new Error(`mail template ${definition.key}: ${problem}`);
    if (this.definitions.has(definition.key)) {
      throw new Error(`mail template ${definition.key} is already registered`);
    }
    const slug = definition.legacySlug;
    if (slug !== undefined && [...this.definitions.values()].some((d) => d.legacySlug === slug)) {
      throw new Error(`mail template ${definition.key}: legacySlug ${slug} is already registered`);
    }
    this.definitions.set(definition.key, definition);
  }

  get(key: string): MailTemplateDefinition | undefined {
    return this.definitions.get(key);
  }

  /** Every registered key, sorted. */
  keys(): readonly string[] {
    return [...this.definitions.keys()].sort();
  }
}
