//! Lược đồ PostgreSQL: bảng nền tảng + một bảng có cột đúng kiểu cho mỗi entity.
//! - Khóa chính (tenant_id, id); tham chiếu là khóa ngoại phức hợp (NO ACTION, hoãn được khi xóa cả tenant) (tenant_id, ref) -> không thể trỏ sang tenant khác.
//! - enum là CHECK; bắt buộc là NOT NULL; Row-Level Security cô lập theo tenant (app.tenant_id).
//! - Di trú cộng thêm (additive): thêm bảng/cột/chỉ mục khi định nghĩa thay đổi; không bao giờ xóa dữ liệu.
use crate::defs::{EntityDef, FieldDef, Registry};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use tokio_postgres::Client;

pub const SCHEMA_VERSION: i32 = 1;

const PLATFORM_DDL: &str = r#"
CREATE TABLE IF NOT EXISTS osp_schema_version (version integer NOT NULL);
CREATE TABLE IF NOT EXISTS osp_schema (table_name text PRIMARY KEY, hash text NOT NULL);

CREATE TABLE IF NOT EXISTS osp_tenants (
  id text PRIMARY KEY,
  name text NOT NULL,
  vertical text,
  plan_id text,
  suspended boolean NOT NULL DEFAULT false,
  modules text[] NOT NULL DEFAULT '{}',
  terminology jsonb NOT NULL DEFAULT '{}',
  settings jsonb NOT NULL DEFAULT '{}',
  extensions jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS osp_roles (
  tenant_id text NOT NULL,
  id text NOT NULL,
  name text NOT NULL,
  permissions text[] NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE IF NOT EXISTS osp_users (
  tenant_id text NOT NULL REFERENCES osp_tenants(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL,
  email text,
  roles text[] NOT NULL,
  password_hash text,
  email_verified boolean NOT NULL DEFAULT true,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE osp_users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT true;
ALTER TABLE osp_users ADD COLUMN IF NOT EXISTS totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE osp_users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE osp_users ADD COLUMN IF NOT EXISTS totp_nonce text;
ALTER TABLE osp_users ADD COLUMN IF NOT EXISTS totp_pending_secret text;
ALTER TABLE osp_users ADD COLUMN IF NOT EXISTS totp_pending_nonce text;
ALTER TABLE osp_users ADD COLUMN IF NOT EXISTS totp_pending_expires_at timestamptz;
ALTER TABLE osp_users ADD COLUMN IF NOT EXISTS totp_pending_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE osp_users ADD COLUMN IF NOT EXISTS totp_last_counter bigint NOT NULL DEFAULT -1;
ALTER TABLE osp_users ADD COLUMN IF NOT EXISTS totp_disable_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE osp_users ADD COLUMN IF NOT EXISTS totp_disable_locked_until timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS osp_users_email ON osp_users (tenant_id, lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS osp_sessions (
  hash text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES osp_tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  kind text NOT NULL,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE INDEX IF NOT EXISTS osp_sessions_user ON osp_sessions (tenant_id, user_id);
ALTER TABLE osp_sessions ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE osp_sessions ADD COLUMN IF NOT EXISTS scopes text[];

CREATE TABLE IF NOT EXISTS osp_user_recovery_codes (
  tenant_id text NOT NULL REFERENCES osp_tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  code_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz,
  PRIMARY KEY (tenant_id, user_id, code_hash)
);
CREATE INDEX IF NOT EXISTS osp_user_recovery_available
  ON osp_user_recovery_codes (tenant_id, user_id, created_at) WHERE used_at IS NULL;
ALTER TABLE osp_user_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE osp_user_recovery_codes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON osp_user_recovery_codes;
CREATE POLICY tenant_isolation ON osp_user_recovery_codes
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE IF NOT EXISTS osp_auth_mail_outbox (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES osp_tenants(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'retry', 'sent', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS osp_auth_mail_ready ON osp_auth_mail_outbox (tenant_id, available_at, created_at) WHERE status IN ('queued', 'retry', 'processing');
ALTER TABLE osp_auth_mail_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE osp_auth_mail_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON osp_auth_mail_outbox;
CREATE POLICY tenant_isolation ON osp_auth_mail_outbox USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

CREATE TABLE IF NOT EXISTS osp_events (
  seq bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  id uuid NOT NULL,
  type text NOT NULL,
  at timestamptz NOT NULL,
  depth integer NOT NULL,
  record_id text,
  causation_id uuid,
  handled jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS osp_events_tenant ON osp_events (tenant_id, seq DESC);
CREATE INDEX IF NOT EXISTS osp_events_record_type ON osp_events (tenant_id, record_id, type, at);

CREATE TABLE IF NOT EXISTS osp_audit (
  seq bigserial PRIMARY KEY,
  tenant_id text NOT NULL,
  id uuid NOT NULL,
  at timestamptz NOT NULL,
  user_id text NOT NULL,
  action text NOT NULL,
  target text,
  detail text
);
CREATE INDEX IF NOT EXISTS osp_audit_tenant ON osp_audit (tenant_id, seq DESC);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'osp_audit_tenant_fk') THEN
    ALTER TABLE osp_audit ADD CONSTRAINT osp_audit_tenant_fk
      FOREIGN KEY (tenant_id) REFERENCES osp_tenants(id) ON DELETE CASCADE;
  END IF;
END $$;
ALTER TABLE osp_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE osp_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON osp_audit;
CREATE POLICY tenant_isolation ON osp_audit
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE OR REPLACE FUNCTION osp_audit_append_only_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'osp_audit is append-only' USING ERRCODE = '55000';
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'osp_audit_append_only' AND tgrelid = 'osp_audit'::regclass
  ) THEN
    CREATE TRIGGER osp_audit_append_only
      BEFORE UPDATE OR DELETE ON osp_audit
      FOR EACH ROW EXECUTE FUNCTION osp_audit_append_only_guard();
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'osp_audit_no_truncate' AND tgrelid = 'osp_audit'::regclass
  ) THEN
    CREATE TRIGGER osp_audit_no_truncate
      BEFORE TRUNCATE ON osp_audit
      FOR EACH STATEMENT EXECUTE FUNCTION osp_audit_append_only_guard();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS osp_failures (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  event_id uuid,
  event_type text NOT NULL,
  module text NOT NULL,
  rule_index integer NOT NULL,
  error text NOT NULL,
  event jsonb NOT NULL,
  status text NOT NULL DEFAULT 'open',
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS osp_failures_tenant ON osp_failures (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS osp_outbox (
  id uuid PRIMARY KEY,
  tenant_id text NOT NULL,
  webhook_id uuid NOT NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'delivered', 'dead', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, webhook_id, event_id)
);
CREATE INDEX IF NOT EXISTS osp_outbox_ready ON osp_outbox (available_at, created_at) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS osp_outbox_tenant_status ON osp_outbox (tenant_id, status, created_at DESC);
"#;

const DOCUMENT_ATTACHMENTS_DDL: &str = r#"
CREATE TABLE IF NOT EXISTS document__attachment_blob (
  tenant_id text NOT NULL REFERENCES osp_tenants(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  document_id uuid NOT NULL,
  document_version integer NOT NULL CHECK (document_version > 0),
  file_name text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  uploaded_by text NOT NULL,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, document_id, document_version)
);
CREATE INDEX IF NOT EXISTS document_attachment_versions
  ON document__attachment_blob (tenant_id, document_id, document_version DESC);
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'document_attachment_document_fk'
      AND conrelid = 'document__attachment_blob'::regclass
  ) THEN
    ALTER TABLE document__attachment_blob
      ADD CONSTRAINT document_attachment_document_fk
      FOREIGN KEY (tenant_id, document_id)
      REFERENCES document__document (tenant_id, id)
      ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;
ALTER TABLE document__attachment_blob ENABLE ROW LEVEL SECURITY;
ALTER TABLE document__attachment_blob FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document__attachment_blob;
CREATE POLICY tenant_isolation ON document__attachment_blob
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
CREATE OR REPLACE FUNCTION document_attachment_immutable_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'document attachments are immutable' USING ERRCODE = '55000';
END;
$$;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'document_attachment_immutable'
      AND tgrelid = 'document__attachment_blob'::regclass
  ) THEN
    CREATE TRIGGER document_attachment_immutable
      BEFORE UPDATE OR DELETE ON document__attachment_blob
      FOR EACH ROW EXECUTE FUNCTION document_attachment_immutable_guard();
  END IF;
END $$;
"#;

pub fn pg_type(f: &FieldDef) -> &'static str {
    match f.ty.as_str() {
        "number" => "double precision",
        "money" => "numeric(20,4)",
        "bool" => "boolean",
        "date" => "date",
        "datetime" => "timestamptz",
        "json" => "jsonb",
        "ref" => "uuid",
        _ => "text", // string, text, enum
    }
}

pub fn quote(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

/// Tên ràng buộc/chỉ mục <= 63 byte: cắt phần đầu + băm ngắn để duy nhất.
fn short_name(prefix: &str, base: &str) -> String {
    let h = hex::encode(Sha256::digest(base.as_bytes()));
    let head: String = base.chars().take(63 - prefix.len() - 10).collect();
    format!("{prefix}{head}_{}", &h[..8])
}

fn literal(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn column_ddl(f: &FieldDef, def: &EntityDef, creating: bool) -> String {
    let mut s = format!("{} {}", quote(&f.name), pg_type(f));
    let is_state = def.states.as_ref().is_some_and(|st| st.field == f.name);
    if creating && (f.required || is_state) {
        s.push_str(" NOT NULL");
    }
    s
}

async fn migrate_master_data_reference_columns(
    tx: &tokio_postgres::Transaction<'_>,
) -> Result<(), String> {
    tx.batch_execute(
        r#"
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'master_data__product' AND column_name = 'uom' AND data_type = 'text') THEN
            UPDATE master_data__product p SET uom = u.id::text FROM master_data__uom u WHERE p.tenant_id = u.tenant_id AND lower(btrim(p.uom)) = lower(btrim(u.name));
            UPDATE master_data__product p SET custom = p.custom || jsonb_build_object('legacy_uom_label', p.uom) WHERE p.uom IS NOT NULL AND NOT EXISTS (SELECT 1 FROM master_data__uom u WHERE u.tenant_id = p.tenant_id AND lower(btrim(u.name)) = lower(btrim(p.uom))) AND (p.uom !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR NOT EXISTS (SELECT 1 FROM master_data__uom u WHERE u.tenant_id = p.tenant_id AND u.id = CASE WHEN p.uom ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p.uom::uuid ELSE NULL END));
            UPDATE master_data__product p SET uom = NULL WHERE p.uom IS NOT NULL AND (p.uom !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR NOT EXISTS (SELECT 1 FROM master_data__uom u WHERE u.tenant_id = p.tenant_id AND u.id = CASE WHEN p.uom ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p.uom::uuid ELSE NULL END));
            ALTER TABLE master_data__product ALTER COLUMN uom TYPE uuid USING CASE WHEN uom ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN uom::uuid ELSE NULL END;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'master_data__product' AND column_name = 'category' AND data_type = 'text') THEN
            UPDATE master_data__product p SET category = c.id::text FROM master_data__product_category c WHERE p.tenant_id = c.tenant_id AND lower(btrim(p.category)) = lower(btrim(c.name));
            UPDATE master_data__product p SET custom = p.custom || jsonb_build_object('legacy_category_label', p.category) WHERE p.category IS NOT NULL AND NOT EXISTS (SELECT 1 FROM master_data__product_category c WHERE c.tenant_id = p.tenant_id AND lower(btrim(c.name)) = lower(btrim(p.category))) AND (p.category !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR NOT EXISTS (SELECT 1 FROM master_data__product_category c WHERE c.tenant_id = p.tenant_id AND c.id = CASE WHEN p.category ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p.category::uuid ELSE NULL END));
            UPDATE master_data__product p SET category = NULL WHERE p.category IS NOT NULL AND (p.category !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR NOT EXISTS (SELECT 1 FROM master_data__product_category c WHERE c.tenant_id = p.tenant_id AND c.id = CASE WHEN p.category ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN p.category::uuid ELSE NULL END));
            ALTER TABLE master_data__product ALTER COLUMN category TYPE uuid USING CASE WHEN category ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN category::uuid ELSE NULL END;
          END IF;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'master_data__product_category' AND column_name = 'parent' AND data_type = 'text') THEN
            UPDATE master_data__product_category child SET parent = parent_row.id::text FROM master_data__product_category parent_row WHERE lower(btrim(child.parent)) = lower(btrim(parent_row.name)) AND child.tenant_id = parent_row.tenant_id;
            UPDATE master_data__product_category child SET custom = child.custom || jsonb_build_object('legacy_parent_label', child.parent) WHERE child.parent IS NOT NULL AND NOT EXISTS (SELECT 1 FROM master_data__product_category parent_row WHERE parent_row.tenant_id = child.tenant_id AND lower(btrim(parent_row.name)) = lower(btrim(child.parent))) AND (child.parent !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR NOT EXISTS (SELECT 1 FROM master_data__product_category parent_row WHERE parent_row.tenant_id = child.tenant_id AND parent_row.id = CASE WHEN child.parent ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN child.parent::uuid ELSE NULL END));
            UPDATE master_data__product_category child SET parent = NULL WHERE child.parent IS NOT NULL AND (child.parent !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR NOT EXISTS (SELECT 1 FROM master_data__product_category parent_row WHERE parent_row.tenant_id = child.tenant_id AND parent_row.id = CASE WHEN child.parent ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN child.parent::uuid ELSE NULL END));
            ALTER TABLE master_data__product_category ALTER COLUMN parent TYPE uuid USING CASE WHEN parent ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN parent::uuid ELSE NULL END;
          END IF;
        END $$;
        "#,
    )
    .await
    .map_err(|error| error.to_string())
}

fn entity_hash(def: &EntityDef) -> String {
    hex::encode(Sha256::digest(
        serde_json::to_string(def).unwrap_or_default().as_bytes(),
    ))
}

/// Áp dụng toàn bộ lược đồ. Chạy trong một giao dịch (DDL của PostgreSQL có tính giao dịch).
pub async fn migrate(client: &mut Client, reg: &Registry) -> Result<(), String> {
    let e = |x: tokio_postgres::Error| {
        format!("{x} {:?}", x.as_db_error().map(|d| d.message().to_string()))
    };
    let tx = client.transaction().await.map_err(e)?;
    // Chỉ một tiến trình di trú tại một thời điểm
    tx.batch_execute("SELECT pg_advisory_xact_lock(7731001)")
        .await
        .map_err(e)?;
    tx.batch_execute(PLATFORM_DDL).await.map_err(e)?;
    let has = tx
        .query_opt("SELECT version FROM osp_schema_version LIMIT 1", &[])
        .await
        .map_err(e)?;
    if has.is_none() {
        tx.execute(
            "INSERT INTO osp_schema_version (version) VALUES ($1)",
            &[&SCHEMA_VERSION],
        )
        .await
        .map_err(e)?;
    }

    let known: HashMap<String, String> = tx
        .query("SELECT table_name, hash FROM osp_schema", &[])
        .await
        .map_err(e)?
        .into_iter()
        .map(|r| (r.get(0), r.get(1)))
        .collect();
    let existing: HashMap<String, HashSet<String>> = {
        let mut m: HashMap<String, HashSet<String>> = HashMap::new();
        for r in tx
            .query("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()", &[])
            .await
            .map_err(e)?
        {
            m.entry(r.get(0)).or_default().insert(r.get(1));
        }
        m
    };

    // Lượt 1: bảng + cột + CHECK + chỉ mục + RLS
    let mut changed: Vec<&EntityDef> = Vec::new();
    for id in &reg.order {
        for def in &reg.modules[id].entities {
            let table = def.table();
            let hash = entity_hash(def);
            if known.get(&table) == Some(&hash) {
                continue;
            }
            changed.push(def);
            if !existing.contains_key(&table) {
                let mut cols = vec![
                    "tenant_id text NOT NULL".to_string(),
                    "id uuid NOT NULL".to_string(),
                    "created_at timestamptz NOT NULL".to_string(),
                    "updated_at timestamptz NOT NULL".to_string(),
                ];
                cols.extend(def.fields.iter().map(|f| column_ddl(f, def, true)));
                cols.push("custom jsonb NOT NULL DEFAULT '{}'".to_string());
                cols.push("PRIMARY KEY (tenant_id, id)".to_string());
                tx.batch_execute(&format!(
                    "CREATE TABLE {} ({})",
                    quote(&table),
                    cols.join(", ")
                ))
                .await
                .map_err(e)?;
            } else {
                let have = &existing[&table];
                for f in def.fields.iter().filter(|f| !have.contains(&f.name)) {
                    tx.batch_execute(&format!(
                        "ALTER TABLE {} ADD COLUMN {}",
                        quote(&table),
                        column_ddl(f, def, false)
                    ))
                    .await
                    .map_err(e)?;
                    if let Some(states) =
                        def.states.as_ref().filter(|states| states.field == f.name)
                    {
                        tx.batch_execute(&format!(
                            "UPDATE {} SET {} = {} WHERE {} IS NULL",
                            quote(&table),
                            quote(&f.name),
                            literal(&states.initial),
                            quote(&f.name)
                        ))
                        .await
                        .map_err(e)?;
                    }
                }
            }
            // CHECK cho enum/trạng thái: tạo lại để theo kịp danh sách giá trị
            if def.qname() == "construction.boq" {
                // Promote existing estimates to the first controlled baseline revision.
                tx.execute(
                    "UPDATE construction__boq SET revision = 1 WHERE revision IS NULL",
                    &[],
                )
                .await
                .map_err(e)?;
                tx.execute(
                    "UPDATE construction__boq SET number = 'BOQ-' || substr(project::text, 1, 8) || '-R' || revision::text WHERE number IS NULL",
                    &[],
                )
                .await
                .map_err(e)?;
            }
            for f in def.fields.iter().filter(|f| f.ty == "enum") {
                let name = short_name("ck_", &format!("{table}_{}", f.name));
                let opts = f
                    .options
                    .clone()
                    .unwrap_or_default()
                    .iter()
                    .map(|o| literal(o))
                    .collect::<Vec<_>>()
                    .join(", ");
                tx.batch_execute(&format!(
                    "ALTER TABLE {t} DROP CONSTRAINT IF EXISTS {n}; ALTER TABLE {t} ADD CONSTRAINT {n} CHECK ({c} IS NULL OR {c} IN ({opts}))",
                    t = quote(&table), n = quote(&name), c = quote(&f.name)
                )).await.map_err(e)?;
            }
            // Chỉ mục
            tx.batch_execute(&format!(
                "CREATE INDEX IF NOT EXISTS {} ON {} (tenant_id, created_at DESC)",
                quote(&short_name("ix_", &format!("{table}_created"))),
                quote(&table)
            ))
            .await
            .map_err(e)?;
            for f in def
                .fields
                .iter()
                .filter(|f| f.ty == "ref" || def.states.as_ref().is_some_and(|s| s.field == f.name))
            {
                tx.batch_execute(&format!(
                    "CREATE INDEX IF NOT EXISTS {} ON {} (tenant_id, {})",
                    quote(&short_name("ix_", &format!("{table}_{}", f.name))),
                    quote(&table),
                    quote(&f.name)
                ))
                .await
                .map_err(e)?;
            }
            // Row-Level Security theo tenant
            tx.batch_execute(&format!(
                "ALTER TABLE {t} ENABLE ROW LEVEL SECURITY; ALTER TABLE {t} FORCE ROW LEVEL SECURITY; \
                 DROP POLICY IF EXISTS tenant_isolation ON {t}; \
                 CREATE POLICY tenant_isolation ON {t} USING (tenant_id = current_setting('app.tenant_id', true)) \
                 WITH CHECK (tenant_id = current_setting('app.tenant_id', true))",
                t = quote(&table)
            )).await.map_err(e)?;
        }
    }

    if reg.entity("document.document").is_some() {
        tx.batch_execute(DOCUMENT_ATTACHMENTS_DDL)
            .await
            .map_err(e)?;
    }

    if reg.modules.contains_key("events") {
        tx.batch_execute(
            "UPDATE events__ticket AS ticket \
             SET reservation_expires_at = ticket.created_at + make_interval(mins => COALESCE(( \
                 SELECT CASE \
                     WHEN event.reservation_minutes BETWEEN 5 AND 60 \
                      AND event.reservation_minutes = trunc(event.reservation_minutes) \
                     THEN event.reservation_minutes::int ELSE 15 END \
                 FROM events__event AS event \
                 WHERE event.tenant_id = ticket.tenant_id AND event.id = ticket.event \
             ), 15)) \
             WHERE ticket.status = 'reserved' AND ticket.reservation_expires_at IS NULL; \
             CREATE INDEX IF NOT EXISTS events_ticket_reservation_due \
             ON events__ticket (tenant_id, reservation_expires_at) \
             WHERE status = 'reserved' AND reservation_expires_at IS NOT NULL;",
        )
        .await
        .map_err(e)?;
    }

    // Lượt 2: khóa ngoại (sau khi mọi bảng đã có)
    migrate_master_data_reference_columns(&tx).await?;

    let fk_existing: HashSet<String> = tx
        .query("SELECT conname FROM pg_constraint WHERE contype = 'f'", &[])
        .await
        .map_err(e)?
        .into_iter()
        .map(|r| r.get(0))
        .collect();
    for def in &changed {
        let table = def.table();
        for f in def.fields.iter().filter(|f| f.ty == "ref") {
            let target = f
                .reference
                .as_deref()
                .and_then(|q| reg.entity(q))
                .ok_or_else(|| format!("{table}.{}: ref không hợp lệ", f.name))?;
            let name = short_name("fk_", &format!("{table}_{}", f.name));
            if fk_existing.contains(&name) {
                continue;
            }
            tx.batch_execute(&format!(
                "ALTER TABLE {t} ADD CONSTRAINT {n} FOREIGN KEY (tenant_id, {c}) REFERENCES {tt} (tenant_id, id) ON DELETE NO ACTION DEFERRABLE INITIALLY IMMEDIATE",
                t = quote(&table), n = quote(&name), c = quote(&f.name), tt = quote(&target.table())
            )).await.map_err(e)?;
        }
        tx.execute(
            "INSERT INTO osp_schema (table_name, hash) VALUES ($1, $2) ON CONFLICT (table_name) DO UPDATE SET hash = EXCLUDED.hash",
            &[&table, &entity_hash(def)],
        ).await.map_err(e)?;
    }
    // Preserve pre-amortization lending repayments when the new schedule
    // columns are introduced. Their old split is unknown, so keep the amount
    // intact as principal and mark the rows as legacy instead of inventing
    // historical interest.
    if reg.entity("lending.repayment").is_some() {
        tx.batch_execute(
            "WITH ranked AS (\
                SELECT tenant_id, id, row_number() OVER (PARTITION BY tenant_id, loan ORDER BY due_date NULLS LAST, created_at, id) AS seq \
                FROM lending__repayment\
            ) \
            UPDATE lending__repayment r SET \
                installment_no = COALESCE(r.installment_no, ranked.seq::double precision), \
                principal_component = COALESCE(r.principal_component, r.amount), \
                interest_component = COALESCE(r.interest_component, 0), \
                legacy_schedule = COALESCE(r.legacy_schedule, true), \
                due_date = COALESCE(r.due_date, r.created_at::date) \
            FROM ranked WHERE ranked.tenant_id = r.tenant_id AND ranked.id = r.id AND (\
                r.installment_no IS NULL OR r.principal_component IS NULL OR \
                r.interest_component IS NULL OR r.legacy_schedule IS NULL OR r.due_date IS NULL\
            )",
        )
        .await
        .map_err(e)?;
    }
    tx.commit().await.map_err(e)?;
    tracing::info!(tables_changed = changed.len(), "di trú lược đồ hoàn tất");
    Ok(())
}

/// Câu SQL dựng sẵn cho mỗi entity (tránh dựng lại mỗi yêu cầu).
pub struct Sql {
    pub insert: String,
    pub update: String,
    pub select_one: String,
    pub delete: String,
}

pub fn build_sql(def: &EntityDef) -> Sql {
    let t = quote(&def.table());
    let cols: Vec<String> = def
        .fields
        .iter()
        .map(|f| quote(&f.name))
        .chain(["created_at", "updated_at", "custom"].map(String::from))
        .collect();
    let col_list = cols.join(", ");
    Sql {
        insert: format!(
            "INSERT INTO {t} SELECT * FROM jsonb_populate_record(NULL::{t}, $1::jsonb)"
        ),
        update: format!(
            "UPDATE {t} t SET ({col_list}) = (SELECT {col_list} FROM jsonb_populate_record(NULL::{t}, $3::jsonb) r) WHERE t.tenant_id = $1 AND t.id = $2::uuid"
        ),
        select_one: format!(
            "SELECT (to_jsonb(t) - 'tenant_id' - 'custom') || t.custom FROM {t} t WHERE t.tenant_id = $1 AND t.id = $2::uuid"
        ),
        delete: format!("DELETE FROM {t} WHERE tenant_id = $1 AND id = $2::uuid"),
    }
}
