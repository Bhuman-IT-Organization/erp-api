/**
 * The HTTP contract of the `api/v1/identity` read endpoints, proven in-process with Fastify
 * `inject`: the guard on each handler, the BE-19 envelope and cursor grammar, the problem bodies,
 * the `x-request-id` every response carries, and the ADR-0030 route assertion.
 *
 * The write handlers, the admin-only granting gate and `GET audit` are in the second describe block;
 * the roles, catalogue and departments endpoints of plan 03.1-11 are in the third.
 */
import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import {
  auditListResponseSchema,
  departmentListResponseSchema,
  localeListResponseSchema,
  memberListResponseSchema,
  memberResponseSchema,
  permissionCatalogueResponseSchema,
  roleListResponseSchema,
  roleResponseSchema,
} from '../dto/identity.dto.js';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import { IDENTITY_ROUTES, MEMBER_EXPORT_COLUMNS, ROLE_EXPORT_COLUMNS } from '../identity.routes.js';
import { IdentityService } from '../service/identity.service.js';
import {
  createIdentityTestApp,
  EVERY_CODE_STAFF_ID,
  TEST_BEARERS,
  type IdentityTestApp,
} from './create-identity-test-app.js';
import { member, SEED_PICKER_DEPARTMENTS } from './fakes.js';

const BASE = `/${API_PREFIX}/${IDENTITY_ROUTES.base}`;
const MEMBERS = `${BASE}/${IDENTITY_ROUTES.members}`;
const AUDIT = `${BASE}/${IDENTITY_ROUTES.audit}`;
const ROLES = `${BASE}/${IDENTITY_ROUTES.roles}`;
const CATALOGUE = `${BASE}/${IDENTITY_ROUTES.permissionsCatalogue}`;
const DEPARTMENTS = `${BASE}/${IDENTITY_ROUTES.departments}`;
const LOCALES = `${BASE}/${IDENTITY_ROUTES.locales}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_UNPROCESSABLE = 422;

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('IdentityController reads (Fastify inject, no network)', () => {
  let ctx: IdentityTestApp;

  beforeAll(async () => {
    ctx = await createIdentityTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('registers every route under /api/v1/ (ADR-0030)', () => {
    const unprefixed = new Set(UNPREFIXED_ROUTES.map((route) => `/${route}`));
    const stray = ctx.routes.filter(
      (url) => !url.startsWith(`/${API_PREFIX}/`) && !unprefixed.has(url),
    );
    expect(stray).toEqual([]);
    expect(ctx.routes).toContain(MEMBERS);
  });

  it('GET members with staff.members.view answers 200 and the BE-19 envelope', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: MEMBERS,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_OK);
    expect(res.headers['content-type']).toContain('application/json');
    const body = memberListResponseSchema.parse(JSON.parse(res.payload));
    expect(body.data.map((row) => row.staffId)).toEqual([1, 2, 3, 4]);
    expect(body.meta).toEqual({
      nextCursor: null,
      prevCursor: null,
      total: 4,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
    expect(String(res.headers['x-request-id'])).toMatch(UUID);
    expect(res.payload).not.toContain('requestId');
  });

  /**
   * The Role column of `tables/staff.php` on the wire, for a bearer who is NOT an administrator.
   * This is the whole point of the field: the same bearer is refused `GET roles` (403
   * `ERP-IDENTITY-0004`, the block below pins it), so the web's client-side join answered nothing
   * and the column rendered an em dash for every non-administrator. `null` is
   * only ever "this member holds no role".
   */
  it('GET members carries roleName for a non-administrator, who may not read GET roles', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: MEMBERS,
      headers: bearer(TEST_BEARERS.viewer),
    });
    const rows = memberListResponseSchema.parse(JSON.parse(res.payload)).data;
    expect(rows.find((row) => row.staffId === 2)?.roleName).toBe('Seed role A');
    expect(rows.find((row) => row.staffId === 4)?.roleName).toBe('Seed role B');
    expect(rows.find((row) => row.staffId === 3)?.roleName).toBeNull();

    const roles = await ctx.app.inject({
      method: 'GET',
      url: ROLES,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(roles.statusCode).toBe(HTTP_FORBIDDEN);
  });

  /** `GET members?<query>` as the viewer: the status and, on a 200, the parsed envelope. */
  async function members(query: string) {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${MEMBERS}?${query}`,
      headers: bearer(TEST_BEARERS.viewer),
    });
    return {
      status: res.statusCode,
      res,
      body:
        res.statusCode === HTTP_OK ? memberListResponseSchema.parse(JSON.parse(res.payload)) : null,
    };
  }

  it('GET members pages Next then Previous: rank, total and both opaque cursors', async () => {
    const first = (await members('limit=2')).body;
    expect(first?.data.map((row) => row.staffId)).toEqual([1, 2]);
    expect(first?.meta).toMatchObject({ prevCursor: null, total: 4, rangeStart: 1 });
    expect(first?.meta.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);

    const second = (await members(`limit=2&cursor=${String(first?.meta.nextCursor)}`)).body;
    expect(second?.data.map((row) => row.staffId)).toEqual([3, 4]);
    expect(second?.meta).toMatchObject({ nextCursor: null, total: 4, rangeStart: 3 });
    expect(second?.meta.prevCursor).not.toBeNull();

    const back = (await members(`limit=2&cursor=${String(second?.meta.prevCursor)}`)).body;
    expect(back?.data.map((row) => row.staffId)).toEqual([1, 2]);
    expect(back?.meta).toMatchObject({ prevCursor: null, total: 4, rangeStart: 1 });
    expect(back?.meta.nextCursor).not.toBeNull();
  });

  it('GET members sort=email answers 200, ordered by e-mail ascending', async () => {
    const { status, body } = await members('sort=email');
    expect(status).toBe(HTTP_OK);
    const emails = body?.data.map((row) => row.email) ?? [];
    expect(emails).toEqual([...emails].sort());
    expect((await members('sort=-email')).body?.data.map((row) => row.email)).toEqual(
      [...emails].reverse(),
    );
  });

  it('GET members sort=-firstName answers the rows by first name descending', async () => {
    const { status, body } = await members('sort=-firstName');
    expect(status).toBe(HTTP_OK);
    expect(body?.data.map((row) => row.staffId)).toEqual([4, 3, 2, 1]);
  });

  it('GET members sort=-firstName pages Next and back to the same rows', async () => {
    const first = (await members('sort=-firstName&limit=3')).body;
    expect(first?.data.map((row) => row.staffId)).toEqual([4, 3, 2]);
    const second = (
      await members(`sort=-firstName&limit=3&cursor=${String(first?.meta.nextCursor)}`)
    ).body;
    expect(second?.data.map((row) => row.staffId)).toEqual([1]);
    expect(second?.meta.rangeStart).toBe(4);
    const back = (
      await members(`sort=-firstName&limit=3&cursor=${String(second?.meta.prevCursor)}`)
    ).body;
    expect(back?.data.map((row) => row.staffId)).toEqual([4, 3, 2]);
  });

  it('GET members refuses a cursor minted under sort=email when sent with sort=firstName', async () => {
    const minted = (await members('sort=email&limit=1')).body?.meta.nextCursor;
    expect(minted).toBeTruthy();
    const { status, res } = await members(`sort=firstName&cursor=${String(minted)}`);
    expect(status).toBe(HTTP_BAD_REQUEST);
    expect(problem(res).code).toBe('ERP-VALIDATION-0001');
  });

  it('GET members answers an empty result with total 0, rangeStart 0 and both cursors null', async () => {
    const { status, body } = await members('q=nobody-matches-this');
    expect(status).toBe(HTTP_OK);
    expect(body).toEqual({
      data: [],
      meta: {
        nextCursor: null,
        prevCursor: null,
        total: 0,
        rangeStart: 0,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    });
  });

  it('GET members counts only the rows the filters and q match', async () => {
    expect((await members('filter[active]=1&limit=1')).body?.meta.total).toBe(3);
    expect((await members('q=Seed4')).body?.meta.total).toBe(1);
  });

  it('GET members applies filter[active] and ?q= on the wire', async () => {
    const filtered = await ctx.app.inject({
      method: 'GET',
      url: `${MEMBERS}?filter[active]=0`,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(memberListResponseSchema.parse(JSON.parse(filtered.payload)).data).toHaveLength(1);
    const searched = await ctx.app.inject({
      method: 'GET',
      url: `${MEMBERS}?q=Seed4`,
      headers: bearer(TEST_BEARERS.viewer),
    });
    const body = memberListResponseSchema.parse(JSON.parse(searched.payload));
    expect(body.data.map((row) => row.staffId)).toEqual([4]);
  });

  it.each([
    ['an unknown filter field', 'filter[password]=x'],
    ['an offset paging key', 'page=2'],
    ['a limit out of range', 'limit=501'],
    ['a malformed cursor', 'cursor=not-a-number'],
    ['a tampered cursor', 'cursor=abc'],
    ['a bare decimal cursor (the pre-3.2 member cursor)', 'cursor=12'],
    ['the Role column (a join, D-41)', 'sort=roleName'],
    ['a compound sort', 'sort=firstName,email'],
    ['the Last login column (nullable, D-41)', 'sort=lastLogin'],
  ])('GET members refuses %s with 400 ERP-VALIDATION-0001', async (_case, query) => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${MEMBERS}?${query}`,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST);
    expect(problem(res).code).toBe('ERP-VALIDATION-0001');
  });

  it('GET members without a bearer answers 401 ERP-AUTH-0004', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: MEMBERS });
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED);
    expect(problem(res).code).toBe('ERP-AUTH-0004');
  });

  it('GET members without the permission answers 403 ERP-AUTH-0005', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: MEMBERS,
      headers: bearer(TEST_BEARERS.noPermission),
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-AUTH-0005');
  });

  it('GET members/:id answers the member with its departments, role and clean permissions', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_OK);
    const body = memberResponseSchema.parse(JSON.parse(res.payload));
    expect(body.staffId).toBe(2);
    expect(body.roleName).toBe('Seed role A');
    expect(body.permissions).toEqual(['sales.invoices.view', 'staff.members.view']);
    expect(res.payload).not.toContain('password');
  });

  it('GET members and members/:id carry the photo as a same-origin path, never a file name', async () => {
    const list = await ctx.app.inject({
      method: 'GET',
      url: MEMBERS,
      headers: bearer(TEST_BEARERS.viewer),
    });
    const rows = memberListResponseSchema.parse(JSON.parse(list.payload)).data;
    expect(rows.find((row) => row.staffId === 2)?.profileImageUrl).toBe(
      '/uploads/staff_profile_images/2/small_seed-photo.png',
    );
    expect(rows.find((row) => row.staffId === 2)?.profileImagePreviewUrl).toBe(
      '/uploads/staff_profile_images/2/thumb_seed-photo.png',
    );
    // Staff 4's stored name is a crafted traversal: the wire carries null, never a path out of the folder.
    expect(rows.find((row) => row.staffId === 4)?.profileImageUrl).toBeNull();
    expect(rows.find((row) => row.staffId === 4)?.profileImagePreviewUrl).toBeNull();
    expect(list.payload).not.toContain('etc/passwd');
    const one = await ctx.app.inject({
      method: 'GET',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.viewer),
    });
    const body = memberResponseSchema.parse(JSON.parse(one.payload));
    expect(body.profileImageUrl).toBe('/uploads/staff_profile_images/2/small_seed-photo.png');
    expect(body.profileImagePreviewUrl).toBe(
      '/uploads/staff_profile_images/2/thumb_seed-photo.png',
    );
    expect(one.payload).not.toContain('"profileImage"');
  });

  it('GET members carries Last Login and members/:id carries Last Active', async () => {
    const list = await ctx.app.inject({
      method: 'GET',
      url: MEMBERS,
      headers: bearer(TEST_BEARERS.viewer),
    });
    const rows = memberListResponseSchema.parse(JSON.parse(list.payload)).data;
    expect(rows.find((row) => row.staffId === 2)?.lastLogin).toBe('2026-02-03T09:15:00.000Z');
    // Perfex renders a member who has never signed in as "Never": on the wire that is null.
    expect(rows.find((row) => row.staffId === 1)?.lastLogin).toBeNull();
    const one = await ctx.app.inject({
      method: 'GET',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.viewer),
    });
    const body = memberResponseSchema.parse(JSON.parse(one.payload));
    expect(body.lastLogin).toBe('2026-02-03T09:15:00.000Z');
    expect(body.lastActivity).toBe('2026-02-03T11:45:00.000Z');
  });

  it('GET members/:id answers 404 ERP-IDENTITY-0005 for an unknown id', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${MEMBERS}/9999`,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_NOT_FOUND);
    expect(problem(res).code).toBe('ERP-IDENTITY-0005');
  });

  it('GET members/:id without the permission answers 403 ERP-AUTH-0005', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.noPermission),
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-AUTH-0005');
  });
});

/**
 * The write endpoints and the audit read. A fresh app per case, because these mutate the fake
 * repositories.
 *
 * The block that matters is the granting one: an actor holding `staff.members.create` and
 * `staff.members.edit` — and, in the last case, EVERY code in the ADR-0033 catalogue — is refused
 * 403 on each granting field separately and let through on a profile-only save (ADR-0034 d.2,
 * threats T-3.1-40 and T-3.1-40B).
 */
describe('IdentityController writes and the audit log', () => {
  let ctx: IdentityTestApp;

  beforeEach(async () => {
    ctx = await createIdentityTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  const NEW_MEMBER = {
    email: 'e2e-new-member@example.invalid',
    firstName: 'E2e',
    lastName: 'Member',
    password: 'a-long-enough-password',
  };

  it('POST members with staff.members.create and no granting field answers 201', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: MEMBERS,
      headers: bearer(TEST_BEARERS.editor),
      payload: NEW_MEMBER,
    });
    expect(res.statusCode).toBe(HTTP_CREATED);
    const body = memberResponseSchema.parse(JSON.parse(res.payload));
    expect(body.email).toBe(NEW_MEMBER.email);
    expect(body.isAdmin).toBe(false);
    expect(ctx.audit.appended).toEqual([]);
  });

  it.each([
    ['roleId', { roleId: 10 }],
    ['permissions', { permissions: ['staff.members.view'] }],
    ['admin', { admin: true }],
  ])(
    'POST members carrying %s is refused 403 ERP-IDENTITY-0001 for a non-administrator',
    async (_field, granting) => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: MEMBERS,
        headers: bearer(TEST_BEARERS.editor),
        payload: { ...NEW_MEMBER, ...granting },
      });
      expect(res.statusCode).toBe(HTTP_FORBIDDEN);
      expect(problem(res).code).toBe('ERP-IDENTITY-0001');
      expect(ctx.audit.appended).toEqual([]);
    },
  );

  it.each([
    ['roleId', { roleId: 11 }],
    ['permissions', { permissions: ['staff.members.view'] }],
    ['admin', { admin: true }],
  ])(
    'PATCH members/:id carrying %s is refused 403 ERP-IDENTITY-0001 for a non-administrator',
    async (_field, granting) => {
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `${MEMBERS}/2`,
        headers: bearer(TEST_BEARERS.editor),
        payload: granting,
      });
      expect(res.statusCode).toBe(HTTP_FORBIDDEN);
      expect(problem(res).code).toBe('ERP-IDENTITY-0001');
      expect(ctx.repo.permissionWrites).toEqual([]);
      expect(ctx.audit.appended).toEqual([]);
    },
  );

  it('POST members naming an unknown department is 422 ERP-IDENTITY-0009 naming it, writing nothing (D-55)', async () => {
    const membersBefore = ctx.repo.members.length;
    const eventsBefore = ctx.publisher.count;
    const res = await ctx.app.inject({
      method: 'POST',
      url: MEMBERS,
      headers: bearer(TEST_BEARERS.editor),
      payload: { ...NEW_MEMBER, email: 'e2e-unknown-dept@example.invalid', departmentIds: [3, 99] },
    });
    expect(res.statusCode).toBe(HTTP_UNPROCESSABLE);
    const body = problem(res);
    expect(body.code).toBe('ERP-IDENTITY-0009');
    expect(body.detail).toBe('unknown department id(s): 99');
    expect(ctx.repo.members).toHaveLength(membersBefore);
    expect(ctx.publisher.count).toBe(eventsBefore);
  });

  it('PATCH members/:id adding an unknown department is 422 ERP-IDENTITY-0009 and changes nothing (D-55)', async () => {
    ctx.repo.departmentIds[2] = [3];
    const writesBefore = ctx.repo.departmentWrites.length;
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.editor),
      payload: { departmentIds: [3, 99] },
    });
    expect(res.statusCode).toBe(HTTP_UNPROCESSABLE);
    expect(problem(res).code).toBe('ERP-IDENTITY-0009');
    expect(ctx.repo.departmentIds[2]).toEqual([3]);
    expect(ctx.repo.departmentWrites).toHaveLength(writesBefore);
  });

  it('D-55: an update keeping a stored unknown id saves', async () => {
    ctx.repo.departmentIds[2] = [3, 77];
    const askedBefore = ctx.departments.asked.length;
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.editor),
      payload: { departmentIds: [3, 77] },
    });
    expect(res.statusCode).toBe(HTTP_OK);
    expect(memberResponseSchema.parse(JSON.parse(res.payload)).departmentIds).toEqual([3, 77]);
    expect(ctx.departments.asked).toHaveLength(askedBefore);
  });

  it('PATCH members/:id with a profile-only body is allowed for a non-administrator', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.editor),
      payload: { firstName: 'Renamed', departmentIds: [1] },
    });
    expect(res.statusCode).toBe(HTTP_OK);
    expect(memberResponseSchema.parse(JSON.parse(res.payload)).firstName).toBe('Renamed');
    expect(ctx.audit.appended).toEqual([]);
  });

  it('a bearer holding EVERY code in the catalogue is still refused a granting field', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.everyCode),
      payload: { admin: true },
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-IDENTITY-0001');
  });

  it('PATCH members/:id by an administrator grants, and writes one audit row carrying the x-request-id', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/2`,
      headers: { ...bearer(TEST_BEARERS.admin), 'x-request-id': 'e2e-grant-1' },
      payload: { roleId: 11 },
    });
    expect(res.statusCode).toBe(HTTP_OK);
    expect(res.headers['x-request-id']).toBe('e2e-grant-1');
    expect(ctx.audit.appended).toHaveLength(1);
    expect(ctx.audit.appended[0]).toMatchObject({
      actorStaffId: 1,
      subjectStaffId: 2,
      changeType: 'member.role.changed',
      beforeValue: '10',
      afterValue: '11',
      requestId: 'e2e-grant-1',
    });
  });

  it('PATCH members/:id/status answers 204 with no body', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/2/status`,
      headers: bearer(TEST_BEARERS.editor),
      payload: { active: false },
    });
    expect(res.statusCode).toBe(HTTP_NO_CONTENT);
    expect(res.payload).toBe('');
  });

  it('refuses an unknown key in a write body with 400 (a mistyped granting field is never ignored)', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.admin),
      payload: { administrator: true },
    });
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST);
    expect(problem(res).code).toBe('ERP-VALIDATION-0001');
  });

  it('refuses an unknown clean permission name with 422 ERP-IDENTITY-0003', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.admin),
      payload: { permissions: ['not.a.code'] },
    });
    expect(res.statusCode).toBe(HTTP_UNPROCESSABLE);
    expect(problem(res).code).toBe('ERP-IDENTITY-0003');
  });

  /**
   * CR review BL-1, the end-to-end half. `@erp/contracts`'s two mapping helpers used
   * `MAP[key] ?? null` over plain objects, so an inherited key answered with a function and
   * `perfexRowsFor` called `.lastIndexOf` on it: a `TypeError`, surfaced as 500
   * `ERP-INTERNAL-0001` on a route whose `@ApiZod` declares 422 `ERP-IDENTITY-0003`. These names
   * are the ones a caller reaches by typing them into the body, so they are asserted over the
   * real HTTP stack and not only against the helper.
   */
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'treats the inherited key %s as an unknown permission: 422 ERP-IDENTITY-0003, never a 500 (BL-1)',
    async (key) => {
      const res = await ctx.app.inject({
        method: 'PATCH',
        url: `${MEMBERS}/2`,
        headers: bearer(TEST_BEARERS.admin),
        payload: { permissions: [key] },
      });
      expect(res.statusCode).toBe(HTTP_UNPROCESSABLE);
      expect(problem(res).code).toBe('ERP-IDENTITY-0003');
    },
  );

  it.each([
    ['POST members', 'POST', MEMBERS, { ...{} }],
    ['PATCH members/:id', 'PATCH', `${MEMBERS}/2`, {}],
    ['PATCH members/:id/status', 'PATCH', `${MEMBERS}/2/status`, { active: true }],
  ])('%s without a bearer answers 401 ERP-AUTH-0004', async (_case, method, url, payload) => {
    const res = await ctx.app.inject({ method: method as 'POST', url, payload });
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED);
    expect(problem(res).code).toBe('ERP-AUTH-0004');
  });

  it.each([
    ['POST members', 'POST', MEMBERS, NEW_MEMBER],
    ['PATCH members/:id', 'PATCH', `${MEMBERS}/2`, { firstName: 'X' }],
    ['PATCH members/:id/status', 'PATCH', `${MEMBERS}/2/status`, { active: true }],
  ])('%s without the permission answers 403 ERP-AUTH-0005', async (_case, method, url, payload) => {
    const res = await ctx.app.inject({
      method: method as 'POST',
      url,
      headers: bearer(TEST_BEARERS.viewer),
      payload,
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-AUTH-0005');
  });

  // --- the four administrator-only rules of brief §5 that are not grants ------------------------

  it('refuses taking the administrator flag off staff id 1', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/1`,
      headers: bearer(TEST_BEARERS.admin),
      payload: { admin: false },
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-IDENTITY-0004');
  });

  it('refuses an administrator removing their own administrator flag', async () => {
    // The admin bearer IS staff 1, so this case also covers the self rule on another member id.
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/1`,
      headers: bearer(TEST_BEARERS.admin),
      payload: { admin: false },
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-IDENTITY-0004');
  });

  it("refuses a non-administrator changing an administrator's password", async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/1`,
      headers: bearer(TEST_BEARERS.editor),
      payload: { password: 'a-long-enough-password' },
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-IDENTITY-0004');
  });

  it("refuses a non-administrator changing an administrator's status", async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/1/status`,
      headers: bearer(TEST_BEARERS.editor),
      payload: { active: false },
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-IDENTITY-0004');
  });

  it('refuses anybody deactivating themselves', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/1/status`,
      headers: bearer(TEST_BEARERS.admin),
      payload: { active: false },
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-IDENTITY-0004');
  });

  it("refuses a non-administrator changing an administrator's e-mail (CR-03)", async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/1`,
      headers: bearer(TEST_BEARERS.editor),
      payload: { email: 'taken-over@example.invalid' },
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-IDENTITY-0004');
    expect((await ctx.repo.findMemberById(1))?.email).toBe('seed-1@example.invalid');
    expect(ctx.audit.appended).toEqual([]);
  });

  it('refuses a demoted administrator whose token still says admin setting their own flag (CR-02 b)', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/${String(EVERY_CODE_STAFF_ID)}`,
      headers: bearer(TEST_BEARERS.staleAdmin),
      payload: { admin: true },
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-IDENTITY-0004');
    expect((await ctx.repo.findMemberById(EVERY_CODE_STAFF_ID))?.isAdmin).toBe(false);
    expect(ctx.audit.appended).toEqual([]);
  });

  // --- GET audit --------------------------------------------------------------------------------

  it('GET audit answers the BE-19 envelope to an administrator', async () => {
    await ctx.app.inject({
      method: 'PATCH',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.admin),
      payload: { roleId: 11 },
    });
    const res = await ctx.app.inject({
      method: 'GET',
      url: AUDIT,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(res.statusCode).toBe(HTTP_OK);
    const body = auditListResponseSchema.parse(JSON.parse(res.payload));
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.changeType).toBe('member.role.changed');
    expect(body.meta).toEqual({ nextCursor: null });
  });

  it('GET audit refuses a non-administrator holding EVERY code in the catalogue with 403', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: AUDIT,
      headers: bearer(TEST_BEARERS.everyCode),
    });
    expect(res.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(res).code).toBe('ERP-IDENTITY-0004');
  });

  it('GET audit without a bearer answers 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: AUDIT });
    expect(res.statusCode).toBe(HTTP_UNAUTHORIZED);
    expect(problem(res).code).toBe('ERP-AUTH-0004');
  });

  it.each([
    ['an unknown filter field', 'filter[permissionCode]=x'],
    ['an offset paging key', 'size=10'],
    ['a limit out of range', 'limit=0'],
    ['a malformed cursor', 'cursor=abc'],
    ['a sort field the keyset cannot express', 'sort=actorStaffId'],
  ])('GET audit refuses %s with 400 ERP-VALIDATION-0001', async (_case, query) => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${AUDIT}?${query}`,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST);
    expect(problem(res).code).toBe('ERP-VALIDATION-0001');
  });
});

/**
 * The roles half on the wire. The case this file exists for is the first one: a bearer holding
 * `staff.roles.create`, `staff.roles.edit` **and** `staff.roles.delete` — and in fact every code in
 * the ADR-0033 catalogue — is refused 403 by all three role writes, and reads both role endpoints
 * successfully with the same token (ADR-0034 d.2, brief §5's correction table).
 */
describe('IdentityController roles, catalogue and departments', () => {
  let ctx: IdentityTestApp;

  beforeEach(async () => {
    ctx = await createIdentityTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it('registers the role, catalogue and department routes under /api/v1/', () => {
    expect(ctx.routes).toContain(ROLES);
    expect(ctx.routes).toContain(`${ROLES}/:id`);
    expect(ctx.routes).toContain(CATALOGUE);
    expect(ctx.routes).toContain(DEPARTMENTS);
  });

  it.each([
    ['POST', ROLES, { name: 'From e2e', permissions: [] }],
    ['PATCH', `${ROLES}/10`, { name: 'From e2e' }],
    ['DELETE', `${ROLES}/11`, undefined],
  ] as const)(
    '%s %s is refused 403 ERP-IDENTITY-0001 for a bearer holding every catalogue code',
    async (method, url, payload) => {
      const res = await ctx.app.inject({
        method,
        url,
        headers: bearer(TEST_BEARERS.everyCode),
        ...(payload === undefined ? {} : { payload }),
      });
      expect(res.statusCode).toBe(HTTP_FORBIDDEN);
      expect(problem(res).code).toBe('ERP-IDENTITY-0001');
      expect(ctx.audit.appended).toEqual([]);
      expect(ctx.repo.roleWrites).toEqual([]);
    },
  );

  it('an administrator reads GET roles and GET roles/:id successfully', async () => {
    const list = await ctx.app.inject({
      method: 'GET',
      url: ROLES,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(list.statusCode).toBe(HTTP_OK);
    const body = roleListResponseSchema.parse(JSON.parse(list.payload));
    expect(body.data.map((row) => row.memberCount)).toEqual([2, 1]);
    expect(body.meta).toEqual({
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });

    const one = await ctx.app.inject({
      method: 'GET',
      url: `${ROLES}/10`,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(one.statusCode).toBe(HTTP_OK);
    expect(roleResponseSchema.parse(JSON.parse(one.payload)).permissions).toEqual([
      'staff.members.view',
    ]);
  });

  /**
   * The migration lead's 2026-09-24 decision, one case per handler: `ROUTE_GATES['/setup/roles']` is
   * `'admin'`, so BOTH roles reads answer 403 `ERP-IDENTITY-0004` for a bearer holding every code
   * in the catalogue — `staff.roles.view` included — while the administrator gets 200. Before the
   * decision the same bearer read every role's full permission template, a capability Perfex never
   * granted and no screen exercised.
   */
  it.each([
    ['GET roles', ROLES],
    ['GET roles/:id', `${ROLES}/10`],
  ] as const)(
    '%s refuses a non-administrator holding staff.roles.view with 403 ERP-IDENTITY-0004, and admits an administrator',
    async (_name, url) => {
      const refused = await ctx.app.inject({
        method: 'GET',
        url,
        headers: bearer(TEST_BEARERS.everyCode),
      });
      expect(refused.statusCode).toBe(HTTP_FORBIDDEN);
      expect(problem(refused).code).toBe('ERP-IDENTITY-0004');

      const admitted = await ctx.app.inject({
        method: 'GET',
        url,
        headers: bearer(TEST_BEARERS.admin),
      });
      expect(admitted.statusCode).toBe(HTTP_OK);
    },
  );

  it('the member-form viewer keeps GET permissions/catalogue while both roles reads refuse it', async () => {
    const catalogue = await ctx.app.inject({
      method: 'GET',
      url: CATALOGUE,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(catalogue.statusCode).toBe(HTTP_OK);
    const role = await ctx.app.inject({
      method: 'GET',
      url: `${ROLES}/10`,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(role.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(role).code).toBe('ERP-IDENTITY-0004');
  });

  /** `GET roles?<query>` as the administrator: the status, the raw response and the parsed body. */
  async function roles(query: string) {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${ROLES}?${query}`,
      headers: bearer(TEST_BEARERS.admin),
    });
    return {
      status: res.statusCode,
      res,
      body:
        res.statusCode === HTTP_OK ? roleListResponseSchema.parse(JSON.parse(res.payload)) : null,
    };
  }

  it('GET roles pages by keyset and refuses an unlisted sort field with 400', async () => {
    const page = (await roles('limit=1')).body;
    expect(page?.data.map((row) => row.roleId)).toEqual([10]);
    expect(page?.meta).toMatchObject({ prevCursor: null, total: 2, rangeStart: 1 });

    const second = (await roles(`limit=1&cursor=${String(page?.meta.nextCursor)}`)).body;
    expect(second?.data[0]?.roleId).toBe(11);
    expect(second?.meta).toMatchObject({ nextCursor: null, rangeStart: 2 });

    const bad = await roles('sort=memberCount');
    expect(bad.status).toBe(HTTP_BAD_REQUEST);
    expect(problem(bad.res).code).toBe('ERP-VALIDATION-0001');
  });

  it('GET roles sort=name answers 200, ordered by name (it was a 400 before 3.2)', async () => {
    ctx.repo.roles.push({ roleId: 300, name: 'Accounts', serializedPermissions: null });
    const asc = await roles('sort=name');
    expect(asc.status).toBe(HTTP_OK);
    expect(asc.body?.data.map((row) => row.name)).toEqual([
      'Accounts',
      'Seed role A',
      'Seed role B',
    ]);
    expect((await roles('sort=-name')).body?.data.map((row) => row.roleId)).toEqual([11, 10, 300]);
  });

  it('GET roles q= searches the role name case-insensitively, and total counts only the matches', async () => {
    ctx.repo.roles.push(
      { roleId: 300, name: 'Warehouse Supervisor', serializedPermissions: null },
      { roleId: 301, name: 'Hardware Buyer', serializedPermissions: null },
    );
    const { status, body } = await roles('q=war');
    expect(status).toBe(HTTP_OK);
    expect(body?.data.map((row) => row.name)).toEqual(['Warehouse Supervisor', 'Hardware Buyer']);
    expect(body?.meta).toEqual({
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });

  it('GET roles refuses a q longer than 100 characters with 400 ERP-VALIDATION-0001', async () => {
    const res = await roles(`q=${'x'.repeat(101)}`);
    expect(res.status).toBe(HTTP_BAD_REQUEST);
    expect(problem(res.res).code).toBe('ERP-VALIDATION-0001');
  });

  it('GET roles/:id answers 404 ERP-IDENTITY-0008 for an unknown role', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${ROLES}/9999`,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(res.statusCode).toBe(HTTP_NOT_FOUND);
    expect(problem(res).code).toBe('ERP-IDENTITY-0008');
  });

  it('an administrator creates, updates and deletes a role; each answers its status', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: ROLES,
      headers: bearer(TEST_BEARERS.admin),
      payload: { name: 'From e2e', permissions: ['staff.roles.view'] },
    });
    expect(created.statusCode).toBe(HTTP_CREATED);
    const role = roleResponseSchema.parse(JSON.parse(created.payload));
    expect(role.permissions).toEqual(['staff.roles.view']);
    expect(created.headers['x-request-id']).toMatch(UUID);

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: `${ROLES}/${String(role.roleId)}`,
      headers: bearer(TEST_BEARERS.admin),
      payload: { name: 'From e2e, renamed' },
    });
    expect(patched.statusCode).toBe(HTTP_OK);
    expect(roleResponseSchema.parse(JSON.parse(patched.payload)).name).toBe('From e2e, renamed');

    const deleted = await ctx.app.inject({
      method: 'DELETE',
      url: `${ROLES}/${String(role.roleId)}`,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(deleted.statusCode).toBe(HTTP_NO_CONTENT);
    expect(deleted.payload).toBe('');
  });

  it('DELETE roles/:id answers 409 ERP-IDENTITY-0006 while a member still holds the role', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: `${ROLES}/10`,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(res.statusCode).toBe(HTTP_CONFLICT);
    expect(problem(res).code).toBe('ERP-IDENTITY-0006');
  });

  it('POST roles answers 409 on a duplicate name and 422 on an unknown clean permission name', async () => {
    const duplicate = await ctx.app.inject({
      method: 'POST',
      url: ROLES,
      headers: bearer(TEST_BEARERS.admin),
      payload: { name: 'Seed role A', permissions: [] },
    });
    expect(duplicate.statusCode).toBe(HTTP_CONFLICT);
    expect(problem(duplicate).code).toBe('ERP-IDENTITY-0007');

    const unknown = await ctx.app.inject({
      method: 'POST',
      url: ROLES,
      headers: bearer(TEST_BEARERS.admin),
      payload: { name: 'From e2e', permissions: ['not.a.code'] },
    });
    expect(unknown.statusCode).toBe(HTTP_UNPROCESSABLE);
    expect(problem(unknown).code).toBe('ERP-IDENTITY-0003');
  });

  it('a role write body is strict: Perfex’s own field name is a 400', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${ROLES}/10`,
      headers: bearer(TEST_BEARERS.admin),
      payload: { update_staff_permissions: true },
    });
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST);
    expect(problem(res).code).toBe('ERP-VALIDATION-0001');
  });

  it('PATCH roles/:id with applyToMembers replaces the holders’ rows and fans out the events', async () => {
    const res = await ctx.app.inject({
      method: 'PATCH',
      url: `${ROLES}/10`,
      headers: bearer(TEST_BEARERS.admin),
      payload: { permissions: ['staff.members.edit'], applyToMembers: true },
    });
    expect(res.statusCode).toBe(HTTP_OK);
    // Staff 1 holds role 10 and is an administrator, so only staff 2 is written to.
    expect(ctx.repo.permissionWrites.map((write) => write.staffId)).toEqual([2]);
    expect(ctx.publisher.drain().map((event) => event.name)).toEqual([
      'identity.role.updated',
      'identity.permissions.replaced',
    ]);
    const roleRows = ctx.audit.appended.filter((entry) => entry.subjectRoleId !== null);
    expect(roleRows).toHaveLength(1);
    expect(ctx.audit.appended.filter((entry) => entry.subjectStaffId === 2).length).toBeGreaterThan(
      0,
    );
  });

  it('GET permissions/catalogue admits either view code and answers the clean-name grid', async () => {
    for (const token of [TEST_BEARERS.viewer, TEST_BEARERS.everyCode]) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: CATALOGUE,
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(HTTP_OK);
      const body = permissionCatalogueResponseSchema.parse(JSON.parse(res.payload));
      expect(body.meta.total).toBeGreaterThan(500);
      expect(body.data.some((entry) => entry.module === 'staff')).toBe(true);
    }
    const refused = await ctx.app.inject({
      method: 'GET',
      url: CATALOGUE,
      headers: bearer(TEST_BEARERS.noPermission),
    });
    expect(refused.statusCode).toBe(HTTP_FORBIDDEN);
  });

  it('GET departments answers two keys per row on staff.members.view, and 403 without it', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: DEPARTMENTS,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_OK);
    const body = departmentListResponseSchema.parse(JSON.parse(res.payload));
    expect(body.meta.total).toBe(body.data.length);
    for (const row of body.data) expect(Object.keys(row).sort()).toEqual(['departmentId', 'name']);
    expect(res.payload).not.toContain('password');
    // D-55: the picker reads DepartmentsFacade.listForPicker(), the wire unchanged, by name.
    expect(res.payload).toBe(
      JSON.stringify({
        data: SEED_PICKER_DEPARTMENTS,
        meta: { total: SEED_PICKER_DEPARTMENTS.length },
      }),
    );

    const refused = await ctx.app.inject({
      method: 'GET',
      url: DEPARTMENTS,
      headers: bearer(TEST_BEARERS.noPermission),
    });
    expect(refused.statusCode).toBe(HTTP_FORBIDDEN);
  });

  it('GET locales answers what the deployment supports on staff.members.view, and 403 without it', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: LOCALES,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_OK);
    const body = localeListResponseSchema.parse(JSON.parse(res.payload));
    expect(body.data).toEqual([
      { locale: 'en', legacyLanguage: 'english' },
      { locale: 'ar', legacyLanguage: 'arabic' },
    ]);
    expect(body.meta).toEqual({ total: 2 });

    const refused = await ctx.app.inject({
      method: 'GET',
      url: LOCALES,
      headers: bearer(TEST_BEARERS.noPermission),
    });
    expect(refused.statusCode).toBe(HTTP_FORBIDDEN);
  });

  it('every role, catalogue, department and locale endpoint needs a bearer', async () => {
    for (const [method, url] of [
      ['GET', ROLES],
      ['GET', `${ROLES}/10`],
      ['POST', ROLES],
      ['PATCH', `${ROLES}/10`],
      ['DELETE', `${ROLES}/10`],
      ['GET', CATALOGUE],
      ['GET', DEPARTMENTS],
      ['GET', LOCALES],
    ] as const) {
      const res = await ctx.app.inject({ method, url, payload: {} });
      expect(res.statusCode).toBe(HTTP_UNAUTHORIZED);
      expect(problem(res).code).toBe('ERP-AUTH-0004');
    }
  });
});

/**
 * Plan 03.2-05 (D-26, D-42): the CSV export behind each identity list, on the wire. Everything the
 * list's query matches — every page, not one — gated exactly like the list, with the translated
 * header row treated as untrusted input and every cell escaped against formula injection.
 */
describe('IdentityController CSV export (D-26, D-42)', () => {
  let ctx: IdentityTestApp;
  const MEMBERS_EXPORT = `${BASE}/${IDENTITY_ROUTES.membersExport}`;
  const ROLES_EXPORT = `${BASE}/${IDENTITY_ROUTES.rolesExport}`;
  /** 2026-09-25T23:30:00Z: late on the 25th in UTC, so the file name must say 25, whatever the zone. */
  const FIXED_NOW_MS = Date.UTC(2026, 8, 25, 23, 30);
  const BOM = '\uFEFF';
  const CRLF = '\r\n';

  beforeEach(async () => {
    ctx = await createIdentityTestApp();
    ctx.moduleRef.get(IdentityService).now = () => FIXED_NOW_MS;
  });

  afterEach(async () => {
    await ctx.close();
  });

  function exportUrl(base: string, params: readonly (readonly [string, string])[] = []): string {
    const search = new URLSearchParams();
    for (const [key, value] of params) search.append(key, value);
    const text = search.toString();
    return text === '' ? base : `${base}?${text}`;
  }

  /** The body's records without the BOM; the last CRLF leaves an empty tail, which is dropped. */
  function records(payload: string): string[] {
    expect(payload.startsWith(BOM)).toBe(true);
    const lines = payload.slice(BOM.length).split(CRLF);
    expect(lines.at(-1)).toBe('');
    return lines.slice(0, -1);
  }

  function issuePaths(res: { payload: string; headers: Record<string, unknown> }): unknown[] {
    const body = problem(res) as { issues?: { path: unknown }[] };
    return (body.issues ?? []).map((issue) => issue.path);
  }

  it('registers both export routes under /api/v1/identity', () => {
    expect(ctx.routes).toContain(MEMBERS_EXPORT);
    expect(ctx.routes).toContain(ROLES_EXPORT);
  });

  it('GET members/export answers text/csv with the attachment name, no-store, the BOM, CRLF and the seven wire names', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: MEMBERS_EXPORT,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_OK);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="staff-members-2026-09-25.csv"',
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(String(res.headers['x-request-id'])).toMatch(UUID);
    const lines = records(res.payload);
    expect(lines[0]).toBe('staffId,firstName,lastName,email,roleName,active,lastLogin');
    expect(MEMBER_EXPORT_COLUMNS).toHaveLength(7);
    expect(lines.slice(1)).toEqual([
      '1,Seed1,Member,seed-1@example.invalid,Seed role A,1,',
      '2,Seed2,Member,seed-2@example.invalid,Seed role A,1,2026-02-03T09:15:00.000Z',
      '3,Seed3,Member,seed-3@example.invalid,,0,',
      '4,Seed4,Member,seed-4@example.invalid,Seed role B,1,',
    ]);
  });

  it('writes the translated header labels as the first line, escaping one that starts with = (D-42)', async () => {
    const labels = ['ID', 'First name', 'Last name', '=Email', 'Role', 'Active', 'Last login'];
    const res = await ctx.app.inject({
      method: 'GET',
      url: exportUrl(
        MEMBERS_EXPORT,
        labels.map((label) => ['header', label] as const),
      ),
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_OK);
    expect(records(res.payload)[0]).toBe("ID,First name,Last name,'=Email,Role,Active,Last login");
  });

  it('refuses six header labels for seven columns with 400 ERP-VALIDATION-0001 on the header path', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: exportUrl(
        MEMBERS_EXPORT,
        ['a', 'b', 'c', 'd', 'e', 'f'].map((label) => ['header', label] as const),
      ),
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST);
    expect(problem(res).code).toBe('ERP-VALIDATION-0001');
    expect(issuePaths(res)).toEqual([['header']]);
  });

  it('refuses a header label longer than 100 characters with 400 on the header path', async () => {
    const labels = ['x'.repeat(101), 'b', 'c', 'd', 'e', 'f', 'g'];
    const res = await ctx.app.inject({
      method: 'GET',
      url: exportUrl(
        MEMBERS_EXPORT,
        labels.map((label) => ['header', label] as const),
      ),
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST);
    expect(issuePaths(res)).toEqual([['header']]);
  });

  it('escapes a formula in a data cell with an apostrophe, unquoted when nothing else needs quoting', async () => {
    const index = ctx.repo.members.findIndex((row) => row.staffId === 2);
    const seeded = ctx.repo.members[index];
    if (seeded === undefined) throw new Error('seed member 2 is missing');
    ctx.repo.members[index] = { ...seeded, firstName: "=cmd|' /C calc'!A0" };
    const res = await ctx.app.inject({
      method: 'GET',
      url: MEMBERS_EXPORT,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_OK);
    const row = records(res.payload).find((line) => line.startsWith('2,'));
    expect(row?.split(',')[1]).toBe("'=cmd|' /C calc'!A0");
  });

  it('exports EVERY row q matches, in the sort asked for, across more than one list page (600 rows)', async () => {
    for (let id = 1000; id < 1600; id += 1) {
      ctx.repo.members.push(member({ staffId: id, email: `bulk-${String(id)}@example.invalid` }));
    }
    const res = await ctx.app.inject({
      method: 'GET',
      url: exportUrl(MEMBERS_EXPORT, [
        ['q', 'bulk-'],
        ['sort', '-email'],
      ]),
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_OK);
    const emails = records(res.payload)
      .slice(1)
      .map((line) => line.split(',')[3]);
    expect(emails).toHaveLength(600);
    expect(emails.every((email) => email?.startsWith('bulk-'))).toBe(true);
    expect(emails).toEqual([...emails].sort().reverse());
    expect(emails[0]).toBe('bulk-1599@example.invalid');
  });

  it('applies filter[active] like the list does', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: exportUrl(MEMBERS_EXPORT, [['filter[active]', '0']]),
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_OK);
    expect(records(res.payload).slice(1)).toEqual(['3,Seed3,Member,seed-3@example.invalid,,0,']);
  });

  it('refuses more than 10,000 matching rows with 400 on the export path, and reads no row', async () => {
    ctx.repo.memberCountOverride = 10_001;
    const read = vi.spyOn(ctx.repo, 'listMembers');
    const res = await ctx.app.inject({
      method: 'GET',
      url: MEMBERS_EXPORT,
      headers: bearer(TEST_BEARERS.viewer),
    });
    expect(res.statusCode).toBe(HTTP_BAD_REQUEST);
    expect(problem(res).code).toBe('ERP-VALIDATION-0001');
    expect(issuePaths(res)).toEqual([['export']]);
    // The numbers ride on the issue, so the web can say "limited to 10,000; this list has 10,001".
    expect(problem(res).issues).toEqual([
      {
        path: ['export'],
        message: 'too many rows to export',
        params: { limit: EXPORT_MAX_ROWS, total: EXPORT_MAX_ROWS + 1 },
      },
    ]);
    expect(read).toHaveBeenCalledTimes(0);
  });

  it('refuses a sort the list refuses, and a cursor or a limit (an export has neither)', async () => {
    for (const params of [
      [['sort', 'lastLogin']],
      [['cursor', 'abc']],
      [['limit', '10']],
    ] as const) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: exportUrl(MEMBERS_EXPORT, params),
        headers: bearer(TEST_BEARERS.viewer),
      });
      expect(res.statusCode, JSON.stringify(params)).toBe(HTTP_BAD_REQUEST);
      expect(problem(res).code).toBe('ERP-VALIDATION-0001');
    }
  });

  it('GET members/export without a bearer answers 401, and without staff.members.view 403', async () => {
    const anonymous = await ctx.app.inject({ method: 'GET', url: MEMBERS_EXPORT });
    expect(anonymous.statusCode).toBe(HTTP_UNAUTHORIZED);
    expect(problem(anonymous).code).toBe('ERP-AUTH-0004');
    const refused = await ctx.app.inject({
      method: 'GET',
      url: MEMBERS_EXPORT,
      headers: bearer(TEST_BEARERS.noPermission),
    });
    expect(refused.statusCode).toBe(HTTP_FORBIDDEN);
    expect(problem(refused).code).toBe('ERP-AUTH-0005');
  });

  it('GET roles/export refuses a non-administrator, even one holding every code, with 403 ERP-IDENTITY-0004', async () => {
    for (const token of [TEST_BEARERS.viewer, TEST_BEARERS.everyCode]) {
      const res = await ctx.app.inject({
        method: 'GET',
        url: ROLES_EXPORT,
        headers: bearer(token),
      });
      expect(res.statusCode).toBe(HTTP_FORBIDDEN);
      expect(problem(res).code).toBe('ERP-IDENTITY-0004');
    }
    const anonymous = await ctx.app.inject({ method: 'GET', url: ROLES_EXPORT });
    expect(anonymous.statusCode).toBe(HTTP_UNAUTHORIZED);
  });

  it('GET roles/export answers an administrator the three columns, named roles-<date>.csv', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: ROLES_EXPORT,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(res.statusCode).toBe(HTTP_OK);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="roles-2026-09-25.csv"');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(ROLE_EXPORT_COLUMNS).toHaveLength(3);
    expect(records(res.payload)).toEqual([
      'roleId,name,memberCount',
      '10,Seed role A,2',
      '11,Seed role B,1',
    ]);
  });

  it('the static export segment wins over :id — members/export and roles/export are never read as an id', async () => {
    // Were `members/:id` to capture the path, its params schema would refuse `export` with a 400.
    const membersRes = await ctx.app.inject({
      method: 'GET',
      url: MEMBERS_EXPORT,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(membersRes.statusCode).toBe(HTTP_OK);
    expect(membersRes.headers['content-type']).toBe('text/csv; charset=utf-8');
    const rolesRes = await ctx.app.inject({
      method: 'GET',
      url: ROLES_EXPORT,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(rolesRes.statusCode).toBe(HTTP_OK);
    // And `:id` still answers a real id.
    const one = await ctx.app.inject({
      method: 'GET',
      url: `${MEMBERS}/2`,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(one.statusCode).toBe(HTTP_OK);
  });
});

/**
 * Plan 04.1.1-02 (D-02, D-07, D-13, D-15, D-24, D-25, D-27, D-28): the same two exports answer
 * Excel, PDF and print rows through the shared core, each format behind the list's own gate.
 */
describe('IdentityController export formats (04.1.1: CSV, Excel, PDF, print)', () => {
  let ctx: IdentityTestApp;
  const MEMBERS_EXPORT = `${BASE}/${IDENTITY_ROUTES.membersExport}`;
  const ROLES_EXPORT = `${BASE}/${IDENTITY_ROUTES.rolesExport}`;
  const FIXED_NOW_MS = Date.UTC(2026, 8, 25, 23, 30);
  const FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;
  /** "Sara" in Arabic script: outside the PDF standard font's WinAnsi range. */
  const ARABIC_NAME = '\u0633\u0627\u0631\u0629';
  const TITLE_MAX_LENGTH = 100;

  beforeEach(async () => {
    ctx = await createIdentityTestApp();
    ctx.moduleRef.get(IdentityService).now = () => FIXED_NOW_MS;
  });

  afterEach(async () => {
    await ctx.close();
  });

  function exportUrl(base: string, params: readonly (readonly [string, string])[] = []): string {
    const search = new URLSearchParams();
    for (const [key, value] of params) search.append(key, value);
    const text = search.toString();
    return text === '' ? base : `${base}?${text}`;
  }

  function get(
    url: string,
    token: string = TEST_BEARERS.viewer,
  ): ReturnType<typeof ctx.app.inject> {
    return ctx.app.inject({ method: 'GET', url, headers: bearer(token) });
  }

  function issuesOf(res: { payload: string; headers: Record<string, unknown> }): unknown {
    return (problem(res) as { issues?: unknown }).issues;
  }

  function issuePaths(res: { payload: string; headers: Record<string, unknown> }): unknown[] {
    const body = problem(res) as { issues?: { path: unknown }[] };
    return (body.issues ?? []).map((issue) => issue.path);
  }

  function renameMember(staffId: number, firstName: string): void {
    const index = ctx.repo.members.findIndex((row) => row.staffId === staffId);
    const seeded = ctx.repo.members[index];
    if (seeded === undefined) throw new Error(`seed member ${String(staffId)} is missing`);
    ctx.repo.members[index] = { ...seeded, firstName };
  }

  it('answers Excel and PDF as attachments named staff-members-<date>.<ext>, no-store, with their bytes', async () => {
    const xlsx = await get(exportUrl(MEMBERS_EXPORT, [['format', 'xlsx']]));
    expect(xlsx.statusCode).toBe(HTTP_OK);
    expect(xlsx.headers['content-type']).toBe(XLSX_CONTENT_TYPE);
    expect(xlsx.headers['content-disposition']).toBe(
      'attachment; filename="staff-members-2026-09-25.xlsx"',
    );
    expect(xlsx.headers['cache-control']).toBe('no-store');
    expect(xlsx.rawPayload.subarray(0, 2).toString('latin1')).toBe('PK');
    const pdf = await get(exportUrl(MEMBERS_EXPORT, [['format', 'pdf']]));
    expect(pdf.statusCode).toBe(HTTP_OK);
    expect(pdf.headers['content-type']).toBe(PDF_CONTENT_TYPE);
    expect(pdf.headers['content-disposition']).toBe(
      'attachment; filename="staff-members-2026-09-25.pdf"',
    );
    expect(pdf.headers['cache-control']).toBe('no-store');
    expect(pdf.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('answers print rows as JSON, no-store and no attachment, in the sent labels, blanks and date format', async () => {
    const res = await get(
      exportUrl(MEMBERS_EXPORT, [
        ['format', 'print'],
        ['title', 'Staff'],
        ['yes', 'Active'],
        ['no', 'Inactive'],
        ...['', '', '', '', 'No role', '', 'Never'].map((blank) => ['blank', blank] as const),
        ['dateFormat', 'd/m/Y'],
        ['timeFormat', '12'],
        ['timeZone', 'Asia/Dubai'],
      ]),
    );
    expect(res.statusCode).toBe(HTTP_OK);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toBeUndefined();
    expect(JSON.parse(res.payload)).toEqual({
      exportedAt: new Date(FIXED_NOW_MS).toISOString(),
      headers: [...MEMBER_EXPORT_COLUMNS],
      rows: [
        ['1', 'Seed1', 'Member', 'seed-1@example.invalid', 'Seed role A', 'Active', 'Never'],
        [
          '2',
          'Seed2',
          'Member',
          'seed-2@example.invalid',
          'Seed role A',
          'Active',
          '03/02/2026 1:15 PM',
        ],
        ['3', 'Seed3', 'Member', 'seed-3@example.invalid', 'No role', 'Inactive', 'Never'],
        ['4', 'Seed4', 'Member', 'seed-4@example.invalid', 'Seed role B', 'Active', 'Never'],
      ],
    });
  });

  it('column narrows the export to the named columns, in canonical order, with one header each (D-13)', async () => {
    const res = await get(
      exportUrl(MEMBERS_EXPORT, [
        ['column', 'email'],
        ['column', 'staffId'],
        ['header', 'ID'],
        ['header', 'E-mail'],
      ]),
    );
    expect(res.statusCode).toBe(HTTP_OK);
    const lines = res.payload.slice(1).split('\r\n');
    expect(lines.slice(0, 2)).toEqual(['ID,E-mail', '1,seed-1@example.invalid']);
  });

  it.each([
    ['key', [['key', '1']]],
    ['format', [['format', 'docx']]],
    [
      'title',
      [
        ['format', 'pdf'],
        ['title', 'x'.repeat(TITLE_MAX_LENGTH + 1)],
      ],
    ],
    [
      'timeZone',
      [
        ['format', 'print'],
        ['timeZone', 'Mars/Base'],
      ],
    ],
  ] as const)(
    'refuses a bad %s with 400 ERP-VALIDATION-0001 on its own path',
    async (path, params) => {
      const res = await get(exportUrl(MEMBERS_EXPORT, params));
      expect(res.statusCode).toBe(HTTP_BAD_REQUEST);
      expect(problem(res).code).toBe('ERP-VALIDATION-0001');
      expect(issuePaths(res)).toEqual([[path]]);
    },
  );

  it('refuses a PDF holding an Arabic name on the font path, and prints the same list (D-24)', async () => {
    renameMember(2, ARABIC_NAME);
    const pdf = await get(exportUrl(MEMBERS_EXPORT, [['format', 'pdf']]));
    expect(pdf.statusCode).toBe(HTTP_BAD_REQUEST);
    expect(issuePaths(pdf)).toEqual([['font']]);
    const print = await get(exportUrl(MEMBERS_EXPORT, [['format', 'print']]));
    expect(print.statusCode).toBe(HTTP_OK);
    const body = JSON.parse(print.payload) as { rows: string[][] };
    expect(body.rows[1]?.[1]).toBe(ARABIC_NAME);
  });

  it('refuses 1,001 matching members as pdf and print with no row read, and answers them as csv (D-06)', async () => {
    ctx.repo.memberCountOverride = PRINT_MAX_ROWS + 1;
    const read = vi.spyOn(ctx.repo, 'listMembers');
    for (const format of ['pdf', 'print'] as const) {
      const res = await get(exportUrl(MEMBERS_EXPORT, [['format', format]]));
      expect(res.statusCode, format).toBe(HTTP_BAD_REQUEST);
      expect(issuesOf(res), format).toEqual([
        {
          path: ['export'],
          message: 'too many rows to export',
          params: { limit: PRINT_MAX_ROWS, total: PRINT_MAX_ROWS + 1 },
        },
      ]);
    }
    expect(read).toHaveBeenCalledTimes(0);
    const csv = await get(exportUrl(MEMBERS_EXPORT, [['format', 'csv']]));
    expect(csv.statusCode).toBe(HTTP_OK);
  });

  it('refuses every format to a bearer without staff.members.view with 403 (D-02)', async () => {
    for (const format of FORMATS) {
      const res = await get(
        exportUrl(MEMBERS_EXPORT, [['format', format]]),
        TEST_BEARERS.noPermission,
      );
      expect(res.statusCode, format).toBe(HTTP_FORBIDDEN);
      expect(problem(res).code, format).toBe('ERP-AUTH-0005');
    }
  });

  it('refuses every roles format to a non-administrator with 403 ERP-IDENTITY-0004, never counting (D-02)', async () => {
    const count = vi.spyOn(ctx.repo, 'countRoles');
    for (const format of FORMATS) {
      const res = await get(exportUrl(ROLES_EXPORT, [['format', format]]), TEST_BEARERS.everyCode);
      expect(res.statusCode, format).toBe(HTTP_FORBIDDEN);
      expect(problem(res).code, format).toBe('ERP-IDENTITY-0004');
    }
    expect(count).toHaveBeenCalledTimes(0);
  });

  it('answers an administrator the roles in every format, and refuses a key there too (D-27)', async () => {
    const pdf = await get(exportUrl(ROLES_EXPORT, [['format', 'pdf']]), TEST_BEARERS.admin);
    expect(pdf.headers['content-disposition']).toBe('attachment; filename="roles-2026-09-25.pdf"');
    const print = await get(exportUrl(ROLES_EXPORT, [['format', 'print']]), TEST_BEARERS.admin);
    expect((JSON.parse(print.payload) as { rows: string[][] }).rows).toEqual([
      ['10', 'Seed role A', '2'],
      ['11', 'Seed role B', '1'],
    ]);
    const keyed = await get(exportUrl(ROLES_EXPORT, [['key', '10']]), TEST_BEARERS.admin);
    expect(keyed.statusCode).toBe(HTTP_BAD_REQUEST);
    expect(issuePaths(keyed)).toEqual([['key']]);
  });

  it('GET members and GET roles carry printLimit beside exportLimit in their meta', async () => {
    const members = await get(MEMBERS, TEST_BEARERS.admin);
    const roles = await get(ROLES, TEST_BEARERS.admin);
    for (const res of [members, roles]) {
      expect(JSON.parse(res.payload)).toMatchObject({
        meta: { exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS },
      });
    }
  });
});
