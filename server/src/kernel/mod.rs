//! Kernel: đa tenant, RBAC, CRUD đúng kiểu trên PostgreSQL, máy trạng thái, luật tích hợp, xác thực.
use crate::defs::{EntityDef, FieldDef, Registry, RoleDef, Vertical};
use crate::error::{ApiError, R};
use crate::schema::{Sql, build_sql};
use deadpool_postgres::Pool;
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

pub mod auth;
pub mod data;
pub mod io;
pub mod rules;
pub mod tenants;

pub type Obj = Map<String, Value>;

#[derive(Debug, Clone)]
pub struct Tenant {
    pub id: String,
    pub name: String,
    pub vertical: Option<String>,
    pub plan_id: Option<String>,
    pub suspended: bool,
    pub modules: Vec<String>,
    pub terminology: BTreeMap<String, String>,
    pub settings: Value,
    pub extensions: BTreeMap<String, Vec<FieldDef>>,
    pub roles: BTreeMap<String, RoleDef>,
    pub created_at: String,
}

impl Tenant {
    pub fn has_module(&self, id: &str) -> bool {
        self.modules.iter().any(|m| m == id)
    }
    pub fn setting_bool(&self, key: &str) -> bool {
        self.settings
            .get(key)
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    }
    pub fn setting_str(&self, key: &str) -> Option<&str> {
        self.settings.get(key).and_then(Value::as_str)
    }
    pub fn business_timezone(&self) -> chrono_tz::Tz {
        self.setting_str("businessTimezone")
            .and_then(|value| value.parse().ok())
            .unwrap_or(chrono_tz::UTC)
    }
    pub fn business_today(&self) -> chrono::NaiveDate {
        chrono::Utc::now()
            .with_timezone(&self.business_timezone())
            .date_naive()
    }
}

#[derive(Debug, Clone)]
pub enum Actor {
    System,
    User {
        id: String,
        roles: Vec<String>,
        scopes: Option<Vec<String>>,
    },
}

impl Actor {
    pub fn user_id(&self) -> &str {
        match self {
            Actor::System => "system",
            Actor::User { id, .. } => id,
        }
    }
}

/// Entity kèm trường mở rộng của tenant.
#[derive(Clone)]
pub struct Ent {
    pub def: Arc<EntityDef>,
    pub ext: Vec<FieldDef>,
}

impl Ent {
    pub fn qname(&self) -> String {
        self.def.qname()
    }
    pub fn fields(&self) -> impl Iterator<Item = &FieldDef> {
        self.def.fields.iter().chain(self.ext.iter())
    }
    pub fn field(&self, name: &str) -> Option<&FieldDef> {
        self.fields().find(|f| f.name == name)
    }
    pub fn is_typed(&self, name: &str) -> bool {
        self.def.field(name).is_some()
    }
    pub fn state_field(&self) -> Option<&str> {
        self.def.states.as_ref().map(|s| s.field.as_str())
    }
}

#[derive(Clone)]
pub struct Opts {
    pub depth: Option<u32>,
    pub causation: Option<uuid::Uuid>,
    pub silent: bool,
}

impl Opts {
    pub fn top() -> Self {
        Opts {
            depth: None,
            causation: None,
            silent: false,
        }
    }
    pub fn silent_top() -> Self {
        Opts {
            depth: Some(0),
            causation: None,
            silent: true,
        }
    }
}

#[derive(Clone)]
pub struct KernelCfg {
    pub max_event_depth: u32,
    pub session_ttl: Duration,
}

impl Default for KernelCfg {
    fn default() -> Self {
        Self {
            max_event_depth: 12,
            session_ttl: Duration::from_secs(12 * 3600),
        }
    }
}

pub struct Kernel {
    pub reg: Arc<Registry>,
    pub verticals: HashMap<String, Arc<Vertical>>,
    pub pool: Pool,
    pub cfg: KernelCfg,
    pub(crate) sql: HashMap<String, Sql>,
    cache: RwLock<HashMap<String, (Instant, Arc<Tenant>)>>,
    pub(crate) login_fails: Mutex<HashMap<String, (u32, Instant)>>,
}

pub fn permission_matches(pattern: &str, permission: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let p: Vec<&str> = pattern.split('.').collect();
    let q: Vec<&str> = permission.split('.').collect();
    for (i, seg) in p.iter().enumerate() {
        if *seg == "*" {
            if i == p.len() - 1 {
                return q.len() > i;
            }
            if q.len() <= i {
                return false;
            }
            continue;
        }
        if q.get(i) != Some(seg) {
            return false;
        }
    }
    p.len() == q.len()
}

pub fn base_roles() -> BTreeMap<String, RoleDef> {
    let r = |name: &str, perms: &[&str]| RoleDef {
        name: name.to_string(),
        permissions: perms.iter().map(|s| s.to_string()).collect(),
    };
    BTreeMap::from([
        ("admin".into(), r("Quản trị", &["*"])),
        (
            "manager".into(),
            r(
                "Quản lý (đọc tất cả, ghi các module nghiệp vụ)",
                &["*.*.read", "*.*.create", "*.*.update"],
            ),
        ),
        ("viewer".into(), r("Chỉ xem", &["*.*.read"])),
        (
            "sales_rep".into(),
            r(
                "Nhân viên kinh doanh",
                &[
                    "crm.*",
                    "sales.*",
                    "master-data.*",
                    "inventory.warehouse.read",
                    "inventory.stock_level.read",
                    "loyalty.*.read",
                ],
            ),
        ),
        (
            "accountant".into(),
            r(
                "Kế toán",
                &[
                    "accounting.*",
                    "einvoice.*",
                    "budget.*",
                    "expense.*",
                    "payments.*",
                    "*.*.read",
                ],
            ),
        ),
        (
            "warehouse_keeper".into(),
            r(
                "Thủ kho",
                &["inventory.*", "purchasing.*.read", "master-data.*.read"],
            ),
        ),
        (
            "hr_officer".into(),
            r(
                "Nhân sự",
                &[
                    "hrm.*",
                    "payroll.*",
                    "recruitment.*",
                    "lms.*",
                    "performance.*",
                ],
            ),
        ),
        (
            "support_agent".into(),
            r(
                "Hỗ trợ khách hàng",
                &[
                    "helpdesk.*",
                    "communication.*",
                    "master-data.party.*",
                    "*.*.read",
                ],
            ),
        ),
    ])
}

impl Kernel {
    pub fn new(reg: Registry, verticals: Vec<Vertical>, pool: Pool, cfg: KernelCfg) -> Self {
        let sql = reg
            .entities
            .iter()
            .map(|(q, d)| (q.clone(), build_sql(d)))
            .collect();
        Self {
            reg: Arc::new(reg),
            verticals: verticals
                .into_iter()
                .map(|v| (v.id.clone(), Arc::new(v)))
                .collect(),
            pool,
            cfg,
            sql,
            cache: RwLock::new(HashMap::new()),
            login_fails: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn sql_for(&self, qname: &str) -> &Sql {
        &self.sql[qname]
    }

    // ───────── Tenant (có cache ngắn hạn; vô hiệu hóa khi thay đổi) ─────────

    pub async fn tenant(&self, id: &str) -> R<Arc<Tenant>> {
        if let Some((at, t)) = self.cache.read().unwrap().get(id) {
            if at.elapsed() < Duration::from_secs(3) {
                return Ok(t.clone());
            }
        }
        let t = Arc::new(self.load_tenant(id).await?);
        self.cache
            .write()
            .unwrap()
            .insert(id.to_string(), (Instant::now(), t.clone()));
        Ok(t)
    }

    pub fn invalidate(&self, id: &str) {
        self.cache.write().unwrap().remove(id);
    }

    async fn load_tenant(&self, id: &str) -> R<Tenant> {
        let conn = self.pool.get().await?;
        let row = conn
            .query_opt(
                "SELECT id, name, vertical, plan_id, suspended, modules, terminology, settings, extensions, \
                 to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') FROM osp_tenants WHERE id = $1",
                &[&id],
            )
            .await?
            .ok_or_else(|| ApiError::new(404, "TENANT_NOT_FOUND", format!("Không có tenant {id}")))?;
        let roles_rows = conn
            .query(
                "SELECT id, name, permissions FROM osp_roles WHERE tenant_id = $1 ORDER BY id",
                &[&id],
            )
            .await?;
        let mut roles = BTreeMap::new();
        for r in roles_rows {
            roles.insert(
                r.get::<_, String>(0),
                RoleDef {
                    name: r.get(1),
                    permissions: r.get(2),
                },
            );
        }
        let terminology: Value = row.get(6);
        let extensions: Value = row.get(8);
        let stored_modules: Vec<String> = row.get(5);
        let modules = self
            .reg
            .closure(&stored_modules)
            .map_err(ApiError::internal)?;
        Ok(Tenant {
            id: row.get(0),
            name: row.get(1),
            vertical: row.get(2),
            plan_id: row.get(3),
            suspended: row.get(4),
            modules,
            terminology: serde_json::from_value(terminology).unwrap_or_default(),
            settings: row.get(7),
            extensions: serde_json::from_value(extensions).unwrap_or_default(),
            roles,
            created_at: row.get(9),
        })
    }

    // ───────── Quyền ─────────

    pub fn can(&self, t: &Tenant, actor: &Actor, permission: &str) -> bool {
        match actor {
            Actor::System => true,
            Actor::User {
                roles: _,
                scopes: Some(scopes),
                ..
            } => scopes
                .iter()
                .any(|scope| permission_matches(scope, permission)),
            Actor::User { roles, .. } => roles.iter().any(|r| {
                t.roles.get(r).is_some_and(|role| {
                    role.permissions
                        .iter()
                        .any(|p| permission_matches(p, permission))
                })
            }),
        }
    }

    pub fn authorize(&self, t: &Tenant, actor: &Actor, permission: &str) -> R<()> {
        if self.can(t, actor, permission) {
            Ok(())
        } else {
            Err(ApiError::forbidden(permission))
        }
    }

    /// Entity đã bật cho tenant, kèm trường mở rộng.
    pub fn ent(&self, t: &Tenant, qname: &str) -> R<Ent> {
        let def = self.reg.entity(qname).ok_or_else(|| {
            ApiError::new(404, "ENTITY_NOT_FOUND", format!("Không có entity {qname}"))
        })?;
        if !t.has_module(&def.module) {
            return Err(ApiError::new(
                404,
                "MODULE_NOT_ENABLED",
                format!(
                    "Module \"{}\" chưa được bật cho tenant {}",
                    def.module, t.id
                ),
            ));
        }
        Ok(Ent {
            def: def.clone(),
            ext: t.extensions.get(qname).cloned().unwrap_or_default(),
        })
    }

    /// Mô tả đầy đủ cho UI: module đã bật, entity (kèm trường mở rộng), thuật ngữ, vai trò.
    pub fn meta(&self, t: &Tenant) -> R<Value> {
        let mut events: Vec<String> = self
            .reg
            .events
            .iter()
            .filter(|event_type| {
                event_type
                    .split('.')
                    .next()
                    .is_some_and(|module| t.has_module(module))
            })
            .cloned()
            .collect();
        events.sort();
        let modules: Vec<Value> = t
            .modules
            .iter()
            .filter_map(|id| self.reg.modules.get(id))
            .map(|m| {
                let entities: Vec<Value> = m
                    .entities
                    .iter()
                    .map(|e| {
                        let q = format!("{}.{}", m.id, e.name);
                        let mut fields = serde_json::to_value(&e.fields).unwrap_or_default();
                        if let (Some(arr), Some(ext)) = (fields.as_array_mut(), t.extensions.get(&q)) {
                            arr.extend(ext.iter().map(|f| serde_json::to_value(f).unwrap_or_default()));
                        }
                        json!({ "module": m.id, "name": e.name, "qname": q, "label": e.label, "fields": fields, "states": e.states, "computed": e.computed, "systemManaged": e.system_managed })
                    })
                    .collect();
                json!({ "id": m.id, "name": m.name, "description": m.description, "category": m.category, "depends": m.depends, "core": m.core, "entities": entities })
            })
            .collect();
        let all: Vec<Value> = self
            .reg
            .order
            .iter()
            .map(|id| &self.reg.modules[id])
            .map(|m| json!({ "id": m.id, "name": m.name, "category": m.category, "core": m.core, "depends": m.depends, "description": m.description }))
            .collect();
        let vertical = t.vertical.as_ref().and_then(|v| self.verticals.get(v));
        Ok(json!({
            "id": t.id, "name": t.name, "vertical": t.vertical, "verticalName": vertical.map(|v| v.name.clone()),
            "terminology": t.terminology, "roles": t.roles, "extensions": t.extensions, "settings": t.settings,
            "kpis": vertical.map(|v| v.kpis.clone()).unwrap_or_default(),
            "summaryEntities": vertical.map(|v| v.summary_entities.clone()).unwrap_or_default(),
            "setupEntities": vertical.map(|v| v.setup_entities.clone()).unwrap_or_default(), "events": events,
            "allModules": all, "modules": modules,
        }))
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PublicUser {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub roles: Vec<String>,
    pub disabled: bool,
    pub has_password: bool,
    pub mfa_enabled: bool,
    pub created_at: String,
}
