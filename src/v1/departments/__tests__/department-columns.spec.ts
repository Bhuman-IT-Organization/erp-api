/**
 * D-48, the credential guard, mechanical, and the read-only rule. `tbldepartments` is Perfex's table
 * (the legacy owner) and holds Perfex's ticket-mailbox settings, an encrypted password among them,
 * beside the six columns Node reads (D-47). So, over every non-test `.ts` file of `src/` (the
 * generated Prisma client excluded), comments stripped:
 *
 * - `DEPARTMENT_COLUMNS` is exactly the six read columns, in the module and in its source;
 * - every access to the `tbldepartments` delegate (`<expr>.tbldepartments.`, `tx.tbldepartments.`,
 *   the bracket form `['tbldepartments']`) that returns rows passes `select: DEPARTMENT_COLUMNS`,
 *   read from the call's own argument block; `count` needs none; any other read method, and a
 *   delegate taken whole or destructured, is a failure by itself;
 * - nothing writes the table: no delegate write method (`create`, `update`, `upsert`, `delete` and
 *   their `Many` forms) and no raw statement naming it with a write keyword;
 * - no non-test file of `src/v1/departments` names a mailbox column, as an identifier or a key;
 * - no file but the departments repository reaches the delegate, and every raw statement in `src/`
 *   that names `tbldepartments` selects no `*` and no mailbox column;
 * - and each rule fails on a temporary copy with one planted violation.
 *
 * No file is an exception: identity's department picker reads `DepartmentsFacade` since plan
 * 04.1-33 Task 3 (D-55), so identity names `tbldepartments` nowhere.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEPARTMENT_COLUMNS } from '../repository/departments.repository.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** The one file that may reach the delegate. */
const REPOSITORY = 'v1/departments/repository/departments.repository.ts';
/** The module whose files may never name a mailbox column. */
const MODULE = 'v1/departments';

/** The six columns Node reads (D-47). */
const READ_COLUMNS = [
  'calendar_id',
  'departmentid',
  'hidefromclient',
  'manager_id',
  'name',
  'parent_id',
];

/** The eight ticket-mailbox columns Node never reads, returns, logs or writes (D-47). */
const MAILBOX_COLUMNS = [
  'imap_username',
  'email',
  'email_from_header',
  'host',
  'password',
  'encryption',
  'folder',
  'delete_after_import',
];

/** Delegate read methods that answer rows: each must select `DEPARTMENT_COLUMNS`. */
const ROW_METHODS = [
  'findMany',
  'findFirst',
  'findUnique',
  'findFirstOrThrow',
  'findUniqueOrThrow',
];

/** Delegate read methods that answer a count, never a row. */
const COUNT_METHODS = ['count'];

/** Delegate methods that write: none may be called on `tbldepartments`, which is Perfex's. */
const WRITE_METHODS = [
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
];

/** A raw statement keyword that writes or alters a table. */
const RAW_WRITE = /\b(INSERT|UPDATE|DELETE|REPLACE|TRUNCATE|ALTER|DROP)\b/i;

/**
 * A path under identity's repository folder, joined from its segments: module-shape refuses the
 * literal folder path in any file outside identity (ADR-0034 decision 1).
 */
function identityFile(name: string): string {
  return ['v1', 'identity', 'repository', name].join('/');
}

interface Source {
  /** The path under the walked root, `/`-separated. */
  readonly file: string;
  /** The text with every comment blanked (line count kept). */
  readonly code: string;
}

/** Line and block comments blanked, line count preserved, so a code match is really code (module-shape's). */
function stripComments(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
  out = out.replace(
    /(^|[^:])\/\/[^\n]*/g,
    (match, lead: string) => lead + ' '.repeat(match.length - lead.length),
  );
  return out;
}

/** Every non-test `.ts` file under `root`, the generated Prisma client excluded. */
function sourcesUnder(root: string): Source[] {
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter(
      (file) =>
        !file.split('/').includes('__tests__') &&
        !file.endsWith('.spec.ts') &&
        !file.startsWith('shared/db/generated/'),
    )
    .map((file) => ({ file, code: stripComments(readFileSync(join(root, file), 'utf8')) }));
}

/** One reach of the delegate: where, and the method called on it (`null` when taken whole). */
interface Access {
  readonly file: string;
  readonly line: number;
  readonly method: string | null;
  /** The call's argument block, `(` to its matching `)`; `''` when no call. */
  readonly args: string;
}

const ACCESS =
  /(?:\.\s*tbldepartments\b|\[\s*(['"`])tbldepartments\1\s*\])(?:\s*\.\s*([A-Za-z_$][\w$]*)\s*\()?/g;
const DESTRUCTURE = /\{[^{}]*\btbldepartments\b[^{}]*\}\s*=/g;

/** The text from the `(` at `open` to its matching `)`. */
function argumentBlock(code: string, open: number): string {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    const char = code[index];
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (depth === 0) return code.slice(open, index + 1);
  }
  return code.slice(open);
}

const lineOf = (code: string, index: number): number => code.slice(0, index).split('\n').length;

/** Every reach of the delegate in one file, destructuring included (as a method-less access). */
function accessesIn(source: Source): Access[] {
  const found: Access[] = [];
  for (const match of source.code.matchAll(ACCESS)) {
    const method = match[2] ?? null;
    const open = match.index + match[0].length - 1;
    found.push({
      file: source.file,
      line: lineOf(source.code, match.index),
      method,
      args: method === null ? '' : argumentBlock(source.code, open),
    });
  }
  for (const match of source.code.matchAll(DESTRUCTURE)) {
    found.push({
      file: source.file,
      line: lineOf(source.code, match.index),
      method: null,
      args: '',
    });
  }
  return found;
}

const where = (access: Access): string => `${access.file}:${String(access.line)}`;

/** The keys of the `DEPARTMENT_COLUMNS` object literal in a repository source. */
function columnsInSource(code: string): string[] {
  const match = /export const DEPARTMENT_COLUMNS\s*=\s*\{([^}]*)\}/.exec(code);
  if (match === null) return [];
  return [...(match[1] ?? '').matchAll(/([A-Za-z_]\w*)\s*:/g)].map((key) => key[1] ?? '').sort();
}

/** Rule 1 over a root: the repository's `DEPARTMENT_COLUMNS` literal holds exactly the six. */
function columnsOffences(root: string): string[] {
  const repository = sourcesUnder(root).find((source) => source.file === REPOSITORY);
  if (repository === undefined) return [`${REPOSITORY} is missing`];
  const keys = columnsInSource(repository.code);
  return JSON.stringify(keys) === JSON.stringify(READ_COLUMNS)
    ? []
    : [`DEPARTMENT_COLUMNS holds ${keys.join(', ')}`];
}

/** Rule 2 over a root: every reach that returns rows selects `DEPARTMENT_COLUMNS`. */
function selectOffences(root: string): string[] {
  return sourcesUnder(root)
    .flatMap(accessesIn)
    .flatMap((access) => {
      if (access.method === null) return [`${where(access)} takes the delegate whole`];
      if (COUNT_METHODS.includes(access.method)) return [];
      // A write is rule 3's offence, reported there.
      if (WRITE_METHODS.includes(access.method)) return [];
      if (!ROW_METHODS.includes(access.method)) {
        return [`${where(access)} calls ${access.method}, which the guard does not know`];
      }
      return /\bselect\s*:\s*DEPARTMENT_COLUMNS\b(?!\s*[.[(])/.test(access.args)
        ? []
        : [`${where(access)} calls ${access.method} without select: DEPARTMENT_COLUMNS`];
    });
}

/**
 * Rule 3 over a root: nothing writes `tbldepartments` (Perfex's table): no delegate write method,
 * and no raw statement naming the table with a write keyword.
 */
function writeOffences(root: string): string[] {
  const sources = sourcesUnder(root);
  const delegateWrites = sources
    .flatMap(accessesIn)
    .filter((access) => access.method !== null && WRITE_METHODS.includes(access.method))
    .map((access) => `${where(access)} writes tbldepartments with ${access.method ?? ''}`);
  const rawWrites = sources.flatMap((source) =>
    rawStatements(source)
      .filter((text) => RAW_WRITE.test(text))
      .map(() => `${source.file} has a raw statement writing tbldepartments`),
  );
  return [...delegateWrites, ...rawWrites];
}

/** Rule 4 over a root: no non-test file of the module names a mailbox column. */
function mailboxOffences(root: string): string[] {
  const names = new RegExp(String.raw`\b(${MAILBOX_COLUMNS.join('|')})\b`, 'g');
  return sourcesUnder(root)
    .filter((source) => source.file.startsWith(`${MODULE}/`))
    .flatMap((source) =>
      [...source.code.matchAll(names)].map(
        (match) =>
          `${source.file}:${String(lineOf(source.code, match.index))} names ${match[1] ?? ''}`,
      ),
    );
}

/** The raw statements (template literals) of a source that name `tbldepartments`. */
function rawStatements(source: Source): string[] {
  return [...source.code.matchAll(/`[^`]*`/g)]
    .map((match) => match[0])
    .filter((text) => /\btbldepartments\b/.test(text));
}

/**
 * Rule 5 over a root: no file but the repository reaches the delegate, and every raw statement
 * naming `tbldepartments`, anywhere, selects no `*` and no mailbox column.
 */
function ownerOffences(root: string): string[] {
  const names = new RegExp(String.raw`\b(${MAILBOX_COLUMNS.join('|')})\b`);
  const sources = sourcesUnder(root);
  const reaches = sources
    .filter((source) => source.file !== REPOSITORY)
    .flatMap(accessesIn)
    .map((access) => `${where(access)} reaches tbldepartments outside ${REPOSITORY}`);
  const statements = sources.flatMap((source) =>
    rawStatements(source)
      .filter((text) => text.includes('*') || names.test(text))
      .map(() => `${source.file} has a raw tbldepartments statement with * or a mailbox column`),
  );
  return [...reaches, ...statements];
}

/** A temporary `src` holding the real repository and the given extra files; deleted by the caller. */
function plantedRoot(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'department-columns-'));
  const real = readFileSync(join(SRC, REPOSITORY), 'utf8');
  const all: Record<string, string> = { [REPOSITORY]: real, ...files };
  for (const [file, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

/** The real repository with one line added at its end. */
function repositoryWith(line: string): Record<string, string> {
  return { [REPOSITORY]: `${readFileSync(join(SRC, REPOSITORY), 'utf8')}\n${line}\n` };
}

/** Runs `rule` on a planted root and deletes it. */
function onPlanted(rule: (root: string) => string[], files: Readonly<Record<string, string>>) {
  const root = plantedRoot(files);
  try {
    return rule(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('D-48, the credential guard over src/', () => {
  it('D-48: DEPARTMENT_COLUMNS is exactly the six read columns', () => {
    expect(Object.keys(DEPARTMENT_COLUMNS).sort()).toEqual(READ_COLUMNS);
    expect(new Set(Object.values(DEPARTMENT_COLUMNS))).toEqual(new Set([true]));
    expect(columnsOffences(SRC)).toEqual([]);
  });

  it('D-48: every tbldepartments call that returns rows selects DEPARTMENT_COLUMNS', () => {
    const offences = selectOffences(SRC);
    expect(offences, offences.join('\n')).toEqual([]);
    const reached = sourcesUnder(SRC).flatMap(accessesIn);
    expect(reached.filter((access) => access.file === REPOSITORY).length).toBeGreaterThan(5);
  }, 60_000);

  it('nothing in src/ writes tbldepartments (Perfex owns it; Node only reads it)', () => {
    const offences = writeOffences(SRC);
    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('D-48: no file names a mailbox column', () => {
    const offences = mailboxOffences(SRC);
    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('D-48: only the departments repository names tbldepartments', () => {
    const offences = ownerOffences(SRC);
    expect(offences, offences.join('\n')).toEqual([]);
  });

  it('D-48: the guard fails on a planted violation', () => {
    expect(onPlanted(selectOffences, {})).toEqual([]);
    expect(onPlanted(ownerOffences, {})).toEqual([]);
    expect(onPlanted(mailboxOffences, {})).toEqual([]);
    expect(onPlanted(columnsOffences, {})).toEqual([]);
    expect(onPlanted(writeOffences, {})).toEqual([]);

    const planted: readonly [string, (root: string) => string[], Record<string, string>][] = [
      [
        'a findMany without the select',
        selectOffences,
        repositoryWith('void this.prisma.client.tbldepartments.findMany({ where: {} });'),
      ],
      [
        'a transaction delegate without the select',
        selectOffences,
        repositoryWith('void tx.tbldepartments.findMany({ where: {} });'),
      ],
      [
        'a destructured delegate',
        selectOffences,
        repositoryWith('const { tbldepartments } = this.prisma.client;'),
      ],
      [
        'the bracket form without the select',
        selectOffences,
        repositoryWith("void this.prisma.client['tbldepartments'].findFirst({});"),
      ],
      [
        'a select spreading the allow-list with more',
        selectOffences,
        repositoryWith(
          'void this.prisma.client.tbldepartments.findFirst({ select: { ...DEPARTMENT_COLUMNS, host: true } });',
        ),
      ],
      [
        'a delete(',
        writeOffences,
        repositoryWith(
          'void this.prisma.client.tbldepartments.delete({ where: { departmentid: 1 }, select: DEPARTMENT_COLUMNS });',
        ),
      ],
      [
        'a create',
        writeOffences,
        repositoryWith(
          "void this.prisma.client.tbldepartments.create({ data: { name: 'x' }, select: DEPARTMENT_COLUMNS });",
        ),
      ],
      [
        'an update through a transaction delegate',
        writeOffences,
        repositoryWith(
          "void tx.tbldepartments.update({ where: { departmentid: 1 }, data: { name: 'x' }, select: DEPARTMENT_COLUMNS });",
        ),
      ],
      [
        'a deleteMany (a count, still a write)',
        writeOffences,
        repositoryWith('void this.prisma.client.tbldepartments.deleteMany({ where: {} });'),
      ],
      [
        'a raw UPDATE of tbldepartments in another module',
        writeOffences,
        {
          'v1/taxes/repository/zz-probe.ts':
            "void client.$executeRaw`UPDATE tbldepartments SET name = 'x' WHERE departmentid = 1`;\n",
        },
      ],
      [
        'a mailbox column in the module',
        mailboxOffences,
        { [`${MODULE}/service/zz-probe.ts`]: 'export const PROBE = { password: true };\n' },
      ],
      [
        'a seventh column in the allow-list',
        columnsOffences,
        {
          [REPOSITORY]: readFileSync(join(SRC, REPOSITORY), 'utf8').replace(
            'parent_id: true,',
            'parent_id: true,\n  password: true,',
          ),
        },
      ],
      [
        'an identity file reading tbldepartments',
        ownerOffences,
        {
          [identityFile('zz-probe.ts')]:
            'void this.prisma.client.tbldepartments.findMany({ select: DEPARTMENT_COLUMNS });\n',
        },
      ],
      [
        'a raw statement selecting * from tbldepartments',
        ownerOffences,
        {
          'v1/taxes/repository/zz-probe.ts':
            'void client.$queryRaw`SELECT * FROM tbldepartments WHERE departmentid = 1`;\n',
        },
      ],
    ];
    for (const [label, rule, files] of planted) {
      expect(onPlanted(rule, files), label).not.toEqual([]);
    }
  });
});
