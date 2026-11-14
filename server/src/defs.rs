//! Nạp catalog module/ngành từ JSON và xây Registry: đồ thị phụ thuộc, chỉ mục sự kiện.
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FieldDef {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String, // string|text|number|money|date|datetime|bool|json|enum|ref
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub system: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(default, rename = "ref", skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Transition {
    pub from: Vec<String>,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct States {
    pub field: String,
    pub initial: String,
    pub actions: BTreeMap<String, Transition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Constraint {
    Min {
        field: String,
        value: Decimal,
        message: String,
        #[serde(default, rename = "unlessSetting")]
        unless_setting: Option<String>,
    },
    NoOverlap {
        scope: String,
        start: String,
        end: String,
        #[serde(default, rename = "ignoreStates")]
        ignore_states: Vec<String>,
        message: String,
    },
    NoDateOverlap {
        scope: String,
        start: String,
        end: String,
        #[serde(default, rename = "ignoreStates")]
        ignore_states: Vec<String>,
        message: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityDef {
    #[serde(default)]
    pub module: String,
    pub name: String,
    pub label: String,
    pub fields: Vec<FieldDef>,
    #[serde(default)]
    pub states: Option<States>,
    #[serde(default)]
    pub computed: BTreeMap<String, String>,
    #[serde(default)]
    pub constraints: Vec<Constraint>,
    #[serde(default, rename = "systemManaged")]
    pub system_managed: bool,
}

impl EntityDef {
    pub fn qname(&self) -> String {
        format!("{}.{}", self.module, self.name)
    }
    pub fn field(&self, name: &str) -> Option<&FieldDef> {
        self.fields.iter().find(|f| f.name == name)
    }
    /// Tên bảng PostgreSQL: module__entity (gạch nối -> gạch dưới)
    pub fn table(&self) -> String {
        table_name(&self.module, &self.name)
    }
}

pub fn table_name(module: &str, entity: &str) -> String {
    format!("{}__{}", module.replace('-', "_"), entity)
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RuleSpec {
    pub on: String,
    #[serde(default)]
    pub when: Option<Value>,
    #[serde(default, rename = "forEach")]
    pub for_each: Option<String>,
    #[serde(default, rename = "where")]
    pub where_: Option<Value>,
    #[serde(rename = "do")]
    pub do_: String,
    pub entity: String,
    #[serde(default)]
    pub map: Option<Value>,
    #[serde(default, rename = "match")]
    pub match_: Option<Value>,
    #[serde(default)]
    pub set: Option<Value>,
    #[serde(default)]
    pub inc: Option<Value>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default, rename = "thenAction")]
    pub then_action: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub lookup: Option<BTreeMap<String, LookupSpec>>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LookupSpec {
    pub entity: String,
    #[serde(rename = "match")]
    pub match_: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobDue {
    pub field: String,
    pub op: String, // lte | lt
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobSpec {
    pub id: String,
    pub label: String,
    pub entity: String,
    #[serde(default, rename = "where")]
    pub where_: Option<Value>,
    pub due: JobDue,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeedSpec {
    pub entity: String,
    pub data: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleDef {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub version: String,
    pub depends: Vec<String>,
    #[serde(default)]
    pub core: bool,
    pub entities: Vec<EntityDef>,
    #[serde(default)]
    pub rules: Vec<RuleSpec>,
    #[serde(default)]
    pub seeds: Vec<SeedSpec>,
    #[serde(default)]
    pub publishes: Vec<String>,
    #[serde(default)]
    pub jobs: Vec<JobSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoleDef {
    pub name: String,
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vertical {
    pub id: String,
    pub name: String,
    pub description: String,
    pub modules: Vec<String>,
    #[serde(default)]
    pub terminology: BTreeMap<String, String>,
    #[serde(default, rename = "customFields")]
    pub custom_fields: BTreeMap<String, Vec<FieldDef>>,
    #[serde(default)]
    pub roles: BTreeMap<String, RoleDef>,
    #[serde(default)]
    pub kpis: Vec<String>,
    #[serde(default)]
    pub seeds: Vec<SeedSpec>,
}

#[derive(Debug, Clone)]
pub struct Sub {
    pub module: String,
    pub rule_index: usize,
}

/// Danh mục module đã nạp: đồ thị phụ thuộc, entity, sự kiện, người đăng ký sự kiện.
pub struct Registry {
    pub modules: HashMap<String, Arc<ModuleDef>>,
    pub order: Vec<String>,
    pub entities: HashMap<String, Arc<EntityDef>>,
    pub events: HashSet<String>,
    subs: HashMap<String, Vec<Sub>>,
}

impl Registry {
    pub fn new(mut defs: Vec<ModuleDef>) -> Result<Self, String> {
        let ids: HashSet<String> = defs.iter().map(|d| d.id.clone()).collect();
        for d in &defs {
            for dep in &d.depends {
                if !ids.contains(dep) {
                    return Err(format!(
                        "Module \"{}\" phụ thuộc \"{}\" nhưng chưa được cài",
                        d.id, dep
                    ));
                }
            }
        }
        for d in &mut defs {
            for e in &mut d.entities {
                e.module = d.id.clone();
            }
        }
        let modules: HashMap<String, Arc<ModuleDef>> = defs
            .into_iter()
            .map(|d| (d.id.clone(), Arc::new(d)))
            .collect();

        // Sắp xếp topo (phụ thuộc trước), ổn định theo id
        let mut order = Vec::new();
        let mut state: HashMap<String, u8> = HashMap::new();
        let mut sorted: Vec<&String> = modules.keys().collect();
        sorted.sort();
        fn visit(
            id: &str,
            modules: &HashMap<String, Arc<ModuleDef>>,
            state: &mut HashMap<String, u8>,
            order: &mut Vec<String>,
            trail: &mut Vec<String>,
        ) -> Result<(), String> {
            match state.get(id) {
                Some(2) => return Ok(()),
                Some(1) => return Err(format!("Vòng phụ thuộc: {} -> {}", trail.join(" -> "), id)),
                _ => {}
            }
            state.insert(id.to_string(), 1);
            trail.push(id.to_string());
            for dep in &modules[id].depends {
                visit(dep, modules, state, order, trail)?;
            }
            trail.pop();
            state.insert(id.to_string(), 2);
            order.push(id.to_string());
            Ok(())
        }
        for id in sorted {
            visit(id, &modules, &mut state, &mut order, &mut Vec::new())?;
        }

        let mut entities = HashMap::new();
        let mut events = HashSet::new();
        let mut subs: HashMap<String, Vec<Sub>> = HashMap::new();
        for id in &order {
            let m = &modules[id];
            for e in &m.entities {
                let q = e.qname();
                for ev in ["created", "updated", "deleted"] {
                    events.insert(format!("{q}.{ev}"));
                }
                if let Some(s) = &e.states {
                    for a in s.actions.keys() {
                        events.insert(format!("{q}.{a}"));
                    }
                }
                entities.insert(q, Arc::new(e.clone()));
            }
            for ev in &m.publishes {
                events.insert(ev.clone());
            }
        }
        for id in &order {
            for (i, r) in modules[id].rules.iter().enumerate() {
                subs.entry(r.on.clone()).or_default().push(Sub {
                    module: id.clone(),
                    rule_index: i,
                });
            }
        }
        Ok(Self {
            modules,
            order,
            entities,
            events,
            subs,
        })
    }

    pub fn subscribers(&self, event: &str) -> &[Sub] {
        self.subs.get(event).map(|v| v.as_slice()).unwrap_or(&[])
    }

    pub fn entity(&self, qname: &str) -> Option<&Arc<EntityDef>> {
        self.entities.get(qname)
    }

    pub fn qualify(&self, module: &str, entity: &str) -> String {
        if entity.contains('.') {
            entity.to_string()
        } else {
            format!("{module}.{entity}")
        }
    }

    /// Module lõi + các id yêu cầu + toàn bộ phụ thuộc, theo thứ tự topo.
    pub fn closure(&self, ids: &[String]) -> Result<Vec<String>, String> {
        let mut want: HashSet<String> = HashSet::new();
        fn add(reg: &Registry, id: &str, want: &mut HashSet<String>) -> Result<(), String> {
            let m = reg
                .modules
                .get(id)
                .ok_or_else(|| format!("Không có module \"{id}\""))?;
            if want.insert(id.to_string()) {
                for d in &m.depends {
                    add(reg, d, want)?;
                }
            }
            Ok(())
        }
        for m in self.modules.values() {
            if m.core {
                add(self, &m.id, &mut want)?;
            }
        }
        for id in ids {
            add(self, id, &mut want)?;
        }
        Ok(self
            .order
            .iter()
            .filter(|i| want.contains(*i))
            .cloned()
            .collect())
    }

    pub fn dependents(&self, id: &str) -> Vec<String> {
        self.modules
            .values()
            .filter(|m| m.depends.iter().any(|d| d == id))
            .map(|m| m.id.clone())
            .collect()
    }
}

/// Đọc mọi tệp *.json trong một thư mục.
pub fn load_dir<T: for<'de> Deserialize<'de>>(dir: &Path) -> Result<Vec<T>, String> {
    let mut out = Vec::new();
    let rd =
        std::fs::read_dir(dir).map_err(|e| format!("Không đọc được {}: {e}", dir.display()))?;
    let mut paths: Vec<_> = rd
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    paths.sort();
    for p in paths {
        let text = std::fs::read_to_string(&p).map_err(|e| format!("{}: {e}", p.display()))?;
        out.push(serde_json::from_str(&text).map_err(|e| format!("{}: {e}", p.display()))?);
    }
    Ok(out)
}

/// Phân tích cú pháp trường gọn (cho trường mở rộng): "ten[!]:kieu[:tham_so]".
pub fn parse_field(spec: &str) -> Result<FieldDef, String> {
    let mut parts = spec.splitn(3, ':');
    let mut name = parts.next().unwrap_or("").to_string();
    let mut required = false;
    if name.ends_with('!') {
        required = true;
        name.pop();
    }
    if name.is_empty()
        || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        || name.chars().next().unwrap().is_ascii_digit()
    {
        return Err(
            "Tên trường chỉ gồm chữ không dấu, số, gạch dưới và không bắt đầu bằng số".into(),
        );
    }
    let ty = parts.next().unwrap_or("string").to_string();
    let arg = parts.next().unwrap_or("").to_string();
    if ![
        "string", "text", "number", "money", "date", "datetime", "bool", "json", "enum", "ref",
    ]
    .contains(&ty.as_str())
    {
        return Err(format!("Kiểu trường không hợp lệ: {ty}"));
    }
    let mut f = FieldDef {
        name,
        ty: ty.clone(),
        required,
        system: false,
        options: None,
        reference: None,
    };
    if ty == "enum" {
        if arg.is_empty() {
            return Err("enum thiếu danh sách giá trị".into());
        }
        f.options = Some(arg.split('|').map(String::from).collect());
    }
    if ty == "ref" {
        if !arg.contains('.') {
            return Err("ref phải dạng module.entity".into());
        }
        f.reference = Some(arg);
    }
    Ok(f)
}
