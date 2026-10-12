-- 0001-identity-audit — the append-only identity audit record.
--
-- Required by ADR-0034 decision 3: every identity change writes exactly one row here, in the same
-- transaction as the change, so an escalation is attributable. Columns are fixed by the
-- identity-access module brief §7. Created by plan 03.1-05.
--
-- Mechanism: ADR-0036 — forward-only numbered DDL in prisma/sql/, applied by `corepack yarn db:apply`
-- and by erp-infra scripts/local-up.mjs, then picked up by `corepack yarn db:pull` (DB-01: the mirror
-- is introspected, never authored). This file is never edited once applied; a correction is 0002-*.
-- Phase 5 owns migrations and supersedes this mechanism.
--
-- Ownership: `node` in prisma/ownership-node.json (ADR-0035) — not in the
-- legacy register, which is generated from the client's schema dump and would report it ORPHAN.
--
-- Engine, charset and collation are tblstaff's in this schema (InnoDB / utf8mb4 / utf8mb4_unicode_ci),
-- read from information_schema, not guessed.
--
-- There is deliberately no referential constraint to tblstaff: the log outlives the row it names,
-- and a Node-created table must not constrain a Perfex-owned one (ADR-0029). The plan's gate greps
-- this file for that phrase, so the statement below is the whole answer -- there is no such clause.

CREATE TABLE IF NOT EXISTS tblidentity_audit (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_staff_id   INT             NOT NULL,
  subject_staff_id INT             NULL,
  subject_role_id  INT             NULL,
  change_type      VARCHAR(32)     NOT NULL,
  permission_code  VARCHAR(191)    NULL,
  before_value     TEXT            NULL,
  after_value      TEXT            NULL,
  request_id       VARCHAR(64)     NOT NULL,
  created_at       DATETIME(3)     NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_identity_audit_subject (subject_staff_id, created_at),
  INDEX idx_identity_audit_actor (actor_staff_id, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
