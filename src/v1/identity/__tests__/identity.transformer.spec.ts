/**
 * IdentityTransformer: every DTO is built field by field and then parsed, so a key the wire shape
 * does not name cannot ride along — in this module that means a `tblstaff` column brief §2.1 leaves
 * to Perfex, a password hash, or an audit internal (threat T-3.1-45). The envelopes are BE-19's.
 */
import { describe, expect, it } from 'vitest';
import { SUPPORTED_LOCALES } from '../../../shared/config/legacy-locale.js';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { IDENTITY_CHANGE_TYPES } from '../identity.routes.js';
import { IdentityTransformer } from '../service/identity.transformer.js';
import type {
  Department,
  EnrichedStaffMember,
  IdentityAuditRow,
  MemberListRow,
  RoleDetail,
} from '../model/identity.model.js';
import { SEED_MEMBERS, SEED_ROLES } from './fakes.js';

const transformer = new IdentityTransformer();

/** A list page's meta as the repository computes it; the transformer passes it through untouched. */
const FIRST_PAGE = { nextCursor: null, prevCursor: null, total: 4, rangeStart: 1 } as const;

/**
 * The seeded members as list rows — the list carries fewer columns than the detail. `roleName` is
 * the name the repository resolved for the page (`SEED_ROLES`), `null` for the member with no role.
 */
function listRows(): MemberListRow[] {
  return SEED_MEMBERS.map((row) => ({
    staffId: row.staffId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    phoneNumber: row.phoneNumber,
    profileImage: row.profileImage,
    isAdmin: row.isAdmin,
    roleId: row.roleId,
    roleName: SEED_ROLES.find((role) => role.roleId === row.roleId)?.name ?? null,
    active: row.active,
    dateCreated: row.dateCreated,
    lastLogin: row.lastLogin,
  }));
}

function enriched(): EnrichedStaffMember {
  const member = SEED_MEMBERS[1];
  if (member === undefined) throw new Error('seed member missing');
  return {
    ...member,
    departmentIds: [2],
    permissions: ['staff.members.view'],
    roleName: 'Seed role A',
  };
}

describe('IdentityTransformer.toMemberResponse', () => {
  it('returns exactly the twenty-five documented keys', () => {
    expect(Object.keys(transformer.toMemberResponse(enriched())).sort()).toEqual(
      [
        'active',
        'dateCreated',
        'defaultLanguage',
        'departmentIds',
        'direction',
        'email',
        'emailSignature',
        'facebook',
        'firstName',
        'hourlyRate',
        'isAdmin',
        'isNotStaff',
        'lastActivity',
        'lastLogin',
        'lastName',
        'linkedin',
        'mediaPathSlug',
        'permissions',
        'phoneNumber',
        'profileImagePreviewUrl',
        'profileImageUrl',
        'roleId',
        'roleName',
        'skype',
        'staffId',
      ].sort(),
    );
  });

  it('strips a column the wire shape does not name, even when the entity carries one', () => {
    const leaky = { ...enriched(), password: '$2y$12$secret', profile_image: 'photo.png' };
    const dto = transformer.toMemberResponse(leaky);
    expect(dto).not.toHaveProperty('password');
    expect(dto).not.toHaveProperty('profile_image');
  });
});

describe('IdentityTransformer.toListResponse', () => {
  it('builds the BE-19 envelope with the thirteen list columns', () => {
    const meta = { nextCursor: 'bmV4dA', prevCursor: 'cHJldg', total: 40, rangeStart: 11 };
    const response = transformer.toListResponse(listRows(), meta);
    expect(response.meta).toEqual({
      ...meta,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
    expect(response.data).toHaveLength(SEED_MEMBERS.length);
    expect(Object.keys(response.data[0] ?? {})).toHaveLength(13);
  });

  /**
   * The Role column of `tables/staff.php`, on the row itself: the web renders `roleName` and joins
   * nothing, because `GET roles` is administrator-only and a non-administrator's join answered 403
   * and showed an em dash. `null` is "no role", never a missing column.
   */
  it('carries the role name on a row that holds a role and null on the row that holds none', () => {
    const rows = transformer.toListResponse(listRows(), FIRST_PAGE).data;
    expect(rows.find((row) => row.staffId === 2)?.roleName).toBe('Seed role A');
    expect(rows.find((row) => row.staffId === 4)?.roleName).toBe('Seed role B');
    const roleless = rows.find((row) => row.staffId === 3);
    expect(roleless?.roleId).toBeNull();
    expect(roleless?.roleName).toBeNull();
  });

  it('carries null for a role id tblroles no longer holds, and never an error', () => {
    const dangling = listRows().map((row) =>
      row.staffId === 2 ? { ...row, roleId: 4242, roleName: null } : row,
    );
    const rows = transformer.toListResponse(dangling, FIRST_PAGE).data;
    expect(rows.find((row) => row.staffId === 2)?.roleId).toBe(4242);
    expect(rows.find((row) => row.staffId === 2)?.roleName).toBeNull();
  });

  it('carries the photo path on the row that has one and null on the crafted name', () => {
    const rows = transformer.toListResponse(listRows(), FIRST_PAGE).data;
    expect(rows.find((row) => row.staffId === 2)?.profileImageUrl).toBe(
      '/uploads/staff_profile_images/2/small_seed-photo.png',
    );
    expect(rows.find((row) => row.staffId === 1)?.profileImageUrl).toBeNull();
    expect(rows.find((row) => row.staffId === 4)?.profileImageUrl).toBeNull();
  });
});

/**
 * The photo contract, which is `v1/branding`'s company-logo contract per member id: the entity
 * carries the bare stored name, the wire carries a same-origin path under Perfex's folder with the
 * `small_` prefix the legacy staff list renders, and a name the guard refuses is `null`.
 * The refusals are the point — a crafted column value must not be able to name a file outside the
 * member's own folder, whatever the disk holds.
 */
describe('IdentityTransformer profile image URL', () => {
  it('builds /uploads/staff_profile_images/<staffId>/small_<file> for a bare name', () => {
    const dto = transformer.toMemberResponse({ ...enriched(), profileImage: 'photo_01.PNG' });
    expect(dto.profileImageUrl).toBe('/uploads/staff_profile_images/2/small_photo_01.PNG');
  });

  it.each([
    ['an unset column', null],
    ['an empty name', ''],
    ['a parent-directory name', '..'],
    ['a relative traversal', '../../../etc/passwd'],
    ['an encoded traversal', '..%2Fphoto.png'],
    ['a forward slash', 'sub/photo.png'],
    ['an absolute path', '/etc/passwd'],
    ['a backslash', 'sub\\photo.png'],
    ['a Windows path', 'C:\\photo.png'],
    ['a leading dot', '.htaccess'],
    ['a shell character', 'photo.png;rm -rf /'],
    ['a NUL byte', 'photo.png\u0000.php'],
    ['a tab', 'photo\t.png'],
    ['a newline', 'photo\n.png'],
    ['a DEL character', 'photo\u007f.png'],
    ['a double dot inside the name', 'x..y.png'],
    ['a name over 255 characters', 'a'.repeat(252) + '.png'],
  ])('answers null for %s', (_case, stored) => {
    expect(
      transformer.toMemberResponse({ ...enriched(), profileImage: stored }).profileImageUrl,
    ).toBeNull();
  });

  /**
   * Perfex keeps the uploaded name (`unique_filename`), spaces and parentheses included, so a real
   * stored name is accepted and its one path segment is percent-encoded. The fixtures use Perfex's
   * shapes with a neutral name, never a real member's.
   */
  it.each([
    ['a Perfex name with spaces', '42010_Jane Doe_0.jpg', 'small_42010_Jane%20Doe_0.jpg'],
    ['parentheses', 'Jane Doe (1).jpg', 'small_Jane%20Doe%20(1).jpg'],
    ['a leading dash', '-photo.png', 'small_-photo.png'],
    ['a percent sign', '100%.png', 'small_100%25.png'],
    ['a hash and a question mark', 'a#b?.png', 'small_a%23b%3F.png'],
    ['Arabic letters', 'صورة.jpg', 'small_%D8%B5%D9%88%D8%B1%D8%A9.jpg'],
    ['exactly 255 characters', 'a'.repeat(251) + '.png', `small_${'a'.repeat(251)}.png`],
  ])('builds the percent-encoded URL for %s', (_case, stored, segment) => {
    expect(
      transformer.toMemberResponse({ ...enriched(), profileImage: stored }).profileImageUrl,
    ).toBe(`/uploads/staff_profile_images/2/${segment}`);
  });

  it('the preview URL is encoded the same way, on the list row and the detail', () => {
    const expected = '/uploads/staff_profile_images/7/thumb_Jane%20Doe%20(1).jpg';
    const row = { ...listRows()[0], staffId: 7, profileImage: 'Jane Doe (1).jpg' } as MemberListRow;
    expect(transformer.toListRow(row).profileImagePreviewUrl).toBe(expected);
    const detail = transformer.toMemberResponse({
      ...enriched(),
      staffId: 7,
      profileImage: 'Jane Doe (1).jpg',
    });
    expect(detail.profileImagePreviewUrl).toBe(expected);
  });

  it('builds the 320 px preview beside the 96 px thumbnail, on the list row and the detail (D-23)', () => {
    const row = { ...listRows()[0], staffId: 7, profileImage: 'photo.jpg' } as MemberListRow;
    const listed = transformer.toListRow(row);
    expect(listed.profileImageUrl).toBe('/uploads/staff_profile_images/7/small_photo.jpg');
    expect(listed.profileImagePreviewUrl).toBe('/uploads/staff_profile_images/7/thumb_photo.jpg');
    const detail = transformer.toMemberResponse({
      ...enriched(),
      staffId: 7,
      profileImage: 'photo.jpg',
    });
    expect(detail.profileImageUrl).toBe('/uploads/staff_profile_images/7/small_photo.jpg');
    expect(detail.profileImagePreviewUrl).toBe('/uploads/staff_profile_images/7/thumb_photo.jpg');
  });

  it.each([
    ['a parent-directory traversal', '../x.jpg'],
    ['a path segment', 'a/b.jpg'],
    ['an empty name', ''],
    ['an unset column', null],
  ])('answers null for BOTH urls on %s — one guard covers both sizes', (_case, stored) => {
    const detail = transformer.toMemberResponse({ ...enriched(), profileImage: stored });
    expect(detail.profileImageUrl).toBeNull();
    expect(detail.profileImagePreviewUrl).toBeNull();
    const row = { ...listRows()[1], profileImage: stored } as MemberListRow;
    expect(transformer.toListRow(row).profileImagePreviewUrl).toBeNull();
    expect(transformer.toListRow(row).profileImageUrl).toBeNull();
  });

  it('never addresses the original upload: every URL carries a size prefix Perfex writes', () => {
    const dto = transformer.toMemberResponse({ ...enriched(), profileImage: 'photo.png' });
    expect(dto.profileImageUrl).toMatch(/\/small_photo\.png$/);
    expect(dto.profileImagePreviewUrl).toMatch(/\/thumb_photo\.png$/);
  });

  it('never emits the raw file name on the wire', () => {
    const dto = transformer.toMemberResponse({ ...enriched(), profileImage: 'photo.png' });
    expect(dto).not.toHaveProperty('profileImage');
    expect(JSON.stringify(dto)).not.toContain('"photo.png"');
  });
});

/**
 * Last Login and Last Active, each on the shape whose legacy view renders it: `tables/staff.php`'s
 * fourth column is `last_login`, so the list row carries it; `views/admin/staff/member.php` shows
 * Last Active in its header, so the member response carries `lastActivity` too. Both are ISO strings
 * or `null` — the api never formats a date, and `null` is what Perfex renders as "Never".
 */
describe('IdentityTransformer last login and last activity', () => {
  it('passes both timestamps through on the member response', () => {
    const dto = transformer.toMemberResponse(enriched());
    expect(dto.lastLogin).toBe('2026-02-03T09:15:00.000Z');
    expect(dto.lastActivity).toBe('2026-02-03T11:45:00.000Z');
  });

  it('answers null for a member who has never signed in or been active', () => {
    const dto = transformer.toMemberResponse({
      ...enriched(),
      lastLogin: null,
      lastActivity: null,
    });
    expect(dto.lastLogin).toBeNull();
    expect(dto.lastActivity).toBeNull();
  });

  it('carries lastLogin on a list row and NOT lastActivity (the list view shows one of the two)', () => {
    const rows = transformer.toListResponse(listRows(), FIRST_PAGE).data;
    expect(rows.find((row) => row.staffId === 2)?.lastLogin).toBe('2026-02-03T09:15:00.000Z');
    expect(rows.find((row) => row.staffId === 1)?.lastLogin).toBeNull();
    expect(rows[0]).not.toHaveProperty('lastActivity');
  });
});

/**
 * The locale list: the offering direction of `shared/config/legacy-locale.ts`. Each row carries the
 * BCP-47 tag the web switches on and the legacy pack name the member's `default_language` stores, so
 * the form can submit a value Perfex also understands; `total` is the count, and there is no cursor.
 */
describe('IdentityTransformer.toLocaleListResponse', () => {
  it('builds the unpaged envelope from SUPPORTED_LOCALES', () => {
    const response = transformer.toLocaleListResponse(SUPPORTED_LOCALES);
    expect(response.data).toEqual([
      { locale: 'en', legacyLanguage: 'english' },
      { locale: 'ar', legacyLanguage: 'arabic' },
    ]);
    expect(response.meta).toEqual({ total: SUPPORTED_LOCALES.length });
  });

  it('strips anything the wire shape does not name', () => {
    const rows: unknown = [
      { locale: 'en', legacyLanguage: 'english', packPath: '/language/english' },
    ];
    const response = transformer.toLocaleListResponse(rows as typeof SUPPORTED_LOCALES);
    expect(response.data[0]).toEqual({ locale: 'en', legacyLanguage: 'english' });
    expect(response.data[0]).not.toHaveProperty('packPath');
  });
});

describe('IdentityTransformer.toAuditResponse', () => {
  const row: IdentityAuditRow = {
    id: '42',
    actorStaffId: 1,
    subjectStaffId: 2,
    subjectRoleId: null,
    changeType: IDENTITY_CHANGE_TYPES.memberAdminChanged,
    permissionCode: null,
    beforeValue: '0',
    afterValue: '1',
    requestId: 'req-1',
    createdAt: new Date('2026-09-24T10:00:00.000Z'),
  };

  it('renders the brief §7 columns and an ISO timestamp', () => {
    const response = transformer.toAuditResponse([row], null);
    expect(response.data[0]).toEqual({
      id: '42',
      actorStaffId: 1,
      subjectStaffId: 2,
      subjectRoleId: null,
      changeType: 'member.admin.changed',
      permissionCode: null,
      beforeValue: '0',
      afterValue: '1',
      requestId: 'req-1',
      createdAt: '2026-09-24T10:00:00.000Z',
    });
    expect(response.meta).toEqual({ nextCursor: null });
  });

  it('carries no password, token or e-mail key', () => {
    const keys = Object.keys(transformer.toAuditResponse([row], null).data[0] ?? {});
    expect(keys).not.toContain('password');
    expect(keys).not.toContain('token');
    expect(keys).not.toContain('email');
  });
});

describe('IdentityTransformer role, catalogue and department envelopes', () => {
  it('both list envelopes carry meta.exportLimit = EXPORT_MAX_ROWS, the one export cap (03.2 lead decision 2a)', () => {
    expect(transformer.toListResponse([], FIRST_PAGE).meta.exportLimit).toBe(EXPORT_MAX_ROWS);
    expect(transformer.toRoleListResponse([], FIRST_PAGE).meta.exportLimit).toBe(EXPORT_MAX_ROWS);
  });

  it('both list envelopes carry meta.printLimit = PRINT_MAX_ROWS, the PDF and print cap (04.1.1 D-06)', () => {
    expect(transformer.toListResponse([], FIRST_PAGE).meta.printLimit).toBe(PRINT_MAX_ROWS);
    expect(transformer.toRoleListResponse([], FIRST_PAGE).meta.printLimit).toBe(PRINT_MAX_ROWS);
  });

  it('toRoleListResponse carries memberCount per row and passes the list meta through (BE-19)', () => {
    const meta = { nextCursor: 'bmV4dA', prevCursor: null, total: 21, rangeStart: 1 };
    const response = transformer.toRoleListResponse(
      [{ roleId: 10, name: 'Seed role A', memberCount: 2 }],
      meta,
    );
    expect(response).toEqual({
      data: [{ roleId: 10, name: 'Seed role A', memberCount: 2 }],
      meta: { ...meta, exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS },
    });
  });

  it('builds the list meta field by field: a key the meta does not name never rides along', () => {
    const leaky = { ...FIRST_PAGE, items: ['leak'], sql: 'SELECT 1' };
    const response = transformer.toRoleListResponse([], leaky);
    expect(response.meta).toEqual({
      ...FIRST_PAGE,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });

  it('toRoleResponse strips anything the wire shape does not name, members included', () => {
    const detail: unknown = {
      roleId: 10,
      name: 'Seed role A',
      permissions: ['staff.members.view'],
      members: [
        {
          staffId: 2,
          firstName: 'Seed2',
          lastName: 'Member',
          email: 'seed-2@example.invalid',
          active: true,
          // Never on the wire: a member row of a role is five fields.
          passwordHash: 'must-not-survive',
        },
      ],
      memberCount: 1,
    };
    const response = transformer.toRoleResponse(detail as RoleDetail);
    expect(Object.keys(response).sort()).toEqual([
      'memberCount',
      'members',
      'name',
      'permissions',
      'roleId',
    ]);
    expect(Object.keys(response.members[0] ?? {})).not.toContain('passwordHash');
  });

  it('toPermissionCatalogueResponse counts the codes it carries', () => {
    const response = transformer.toPermissionCatalogueResponse([
      {
        module: 'staff',
        resources: [
          {
            resource: 'members',
            actions: [
              { action: 'view', code: 'staff.members.view' },
              { action: 'edit', code: 'staff.members.edit' },
            ],
          },
        ],
      },
    ]);
    expect(response.meta).toEqual({ total: 2 });
    expect(response.data[0]?.resources[0]?.actions).toHaveLength(2);
  });

  it('toDepartmentListResponse answers two keys per row — never the IMAP password column', () => {
    const response = transformer.toDepartmentListResponse([
      { departmentId: 1, name: 'Support' },
      // A row that still carried the rest of tbldepartments would lose it here.
      { departmentId: 2, name: 'Sales', password: 'must-not-survive' } as unknown as Department,
    ]);
    expect(response).toEqual({
      data: [
        { departmentId: 1, name: 'Support' },
        { departmentId: 2, name: 'Sales' },
      ],
      meta: { total: 2 },
    });
  });
});
