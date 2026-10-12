-- 0004-mail: the Node mail store (templates, their per-locale wording) and the sent-email log.
--
-- Required by Phase 4.3 D-03 (Node owns the templates its modules send), D-05 (one log row per send,
-- never the body) and ADR-0049 decisions 1, 5, 7 and 8 (the shared mail sender, v1/mail). Created by
-- plan 04.3-04.
--
-- Mechanism: ADR-0036, forward-only numbered DDL in prisma/sql/, applied by `corepack yarn db:apply`
-- and by erp-infra scripts/local-up.mjs, then picked up by `corepack yarn db:pull` (DB-01: the mirror
-- is introspected, never authored). This file is never edited once applied; a correction is a new,
-- higher-numbered file. 0002 and 0003 are claimed by Phase 4.2 plans, so this file is 0004. Phase 5
-- owns migrations and supersedes this mechanism.
--
-- Ownership: `node` (v1/mail) in prisma/ownership-node.json (ADR-0035), not
-- in the legacy register, which is generated from the client's schema dump and would report them
-- ORPHAN.
--
-- Engine, charset and collation are tblstaff's in this schema (InnoDB / utf8mb4 / utf8mb4_unicode_ci),
-- read from information_schema, not guessed.
--
-- There is no referential constraint to a Perfex table (ADR-0029); the one foreign key is Node to Node.
-- Perfex's own tblmail_queue and tblemailtemplates are Perfex's tables and are not touched here.
--
-- Ids are INT UNSIGNED, not BIGINT: Prisma maps them to number, and 4.29 billion rows is far beyond a
-- 12-month log. The message is MEDIUMTEXT: 20,000 characters of utf8mb4 can exceed TEXT's 65,535
-- bytes. tblmail_sent_emails holds no subject, body or merge value (D-05).

CREATE TABLE IF NOT EXISTS tblmail_templates (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_key        VARCHAR(100) NOT NULL,
  module              VARCHAR(64)  NOT NULL,
  active              TINYINT(1)   NOT NULL DEFAULT 1,
  formatting_dropped  TINYINT(1)   NOT NULL DEFAULT 0,
  updated_by_staff_id INT          NULL,
  created_at          DATETIME(3)  NOT NULL,
  updated_at          DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mail_templates_key (template_key),
  INDEX idx_mail_templates_module (module, id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tblmail_template_versions (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_id  INT UNSIGNED NOT NULL,
  locale       VARCHAR(16)  NOT NULL,
  subject      VARCHAR(255) NOT NULL,
  message      MEDIUMTEXT   NOT NULL,
  updated_at   DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mail_template_versions (template_id, locale),
  CONSTRAINT fk_mail_template_versions_template FOREIGN KEY (template_id)
    REFERENCES tblmail_templates (id) ON DELETE CASCADE
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tblmail_sent_emails (
  id                    INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  template_key          VARCHAR(100)     NULL,
  is_test               TINYINT(1)       NOT NULL DEFAULT 0,
  source_ref            VARCHAR(191)     NULL,
  recipient_email       VARCHAR(191)     NOT NULL,
  locale                VARCHAR(16)      NOT NULL,
  status                VARCHAR(16)      NOT NULL,
  attempts              TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts          TINYINT UNSIGNED NOT NULL,
  next_try_at           DATETIME(3)      NULL,
  failure_reason        VARCHAR(32)      NULL,
  server_reply          VARCHAR(1000)    NULL,
  dedupe_key            VARCHAR(191)     NULL,
  resent_from_id        INT UNSIGNED     NULL,
  requested_by_staff_id INT              NULL,
  request_id            VARCHAR(64)      NULL,
  queued_at             DATETIME(3)      NOT NULL,
  sent_at               DATETIME(3)      NULL,
  updated_at            DATETIME(3)      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mail_sent_dedupe (dedupe_key),
  INDEX idx_mail_sent_queued (queued_at, id),
  INDEX idx_mail_sent_template (template_key, queued_at),
  INDEX idx_mail_sent_status (status, queued_at),
  INDEX idx_mail_sent_recipient (recipient_email, queued_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4 COLLATE = utf8mb4_unicode_ci;
