use osp_server::{defs, expr, openapi};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const CATEGORIES: [(&str, &str); 8] = [
    ("core", "Lõi"),
    ("sales", "Bán hàng & khách hàng"),
    ("supply", "Chuỗi cung ứng"),
    ("finance", "Tài chính"),
    ("people", "Nhân sự"),
    ("operations", "Vận hành"),
    ("platform", "Nền tảng dùng chung"),
    ("industry", "Module chuyên ngành"),
];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("server directory has a workspace parent")
        .to_path_buf()
}

fn rust_context_id(id: &str) -> String {
    match id {
        // The public catalog is named `events`; the Rust directory is explicit
        // to avoid colliding with the shared modules/events.rs dispatcher.
        "events" => "event_management".into(),
        _ => id.replace('-', "_"),
    }
}

fn catalog_context_id(rust_id: &str) -> String {
    match rust_id {
        "event_management" => "events".into(),
        _ => rust_id.replace('_', "-"),
    }
}

fn append_rust_sources(directory: &Path, sources: &mut String) -> std::io::Result<()> {
    for entry in fs::read_dir(directory)? {
        let path = entry?.path();
        if path.is_dir() {
            append_rust_sources(&path, sources)?;
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("rs") {
            sources.push_str(&fs::read_to_string(path)?);
            sources.push('\n');
        }
    }
    Ok(())
}

fn read_layer_sources(context: &Path, layer: &str) -> std::io::Result<String> {
    let flat = context.join(format!("{layer}.rs"));
    let module_directory = context.join(layer);
    let mut sources = if flat.is_file() {
        fs::read_to_string(flat)?
    } else {
        fs::read_to_string(module_directory.join("mod.rs"))?
    };
    if module_directory.is_dir() {
        append_rust_sources(&module_directory, &mut sources)?;
    }
    Ok(sources)
}

fn load() -> Result<(Vec<defs::ModuleDef>, Vec<defs::Vertical>, defs::Registry), String> {
    let root = root();
    let modules: Vec<defs::ModuleDef> = defs::load_dir(&root.join("definitions/modules"))?;
    let verticals: Vec<defs::Vertical> = defs::load_dir(&root.join("definitions/verticals"))?;
    let registry = defs::Registry::new(modules.clone())?;
    Ok((modules, verticals, registry))
}

fn lint_typescript_sources(directory: &Path, issues: &mut Vec<String>) {
    const GENERATED_DIRS: [&str; 6] = [
        ".git",
        "node_modules",
        "target",
        "dist",
        "build",
        "client-dist",
    ];
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if !GENERATED_DIRS.contains(&entry.file_name().to_string_lossy().as_ref()) {
                lint_typescript_sources(&path, issues);
            }
        } else if file_type.is_file()
            && path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| matches!(extension, "ts" | "tsx" | "mts" | "cts"))
        {
            issues.push(format!(
                "TypeScript source is not allowed; move business behavior to Rust: {}",
                path.strip_prefix(root()).unwrap_or(&path).display()
            ));
        }
    }
}

fn lint_context_dependencies(
    module_root: &Path,
    registry: &defs::Registry,
    issues: &mut Vec<String>,
) {
    fn rust_files(directory: &Path, files: &mut Vec<PathBuf>) {
        let Ok(entries) = fs::read_dir(directory) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                rust_files(&path, files);
            } else if file_type.is_file()
                && path.extension().and_then(|extension| extension.to_str()) == Some("rs")
            {
                files.push(path);
            }
        }
    }

    for (module_id, module) in &registry.modules {
        let context_id = rust_context_id(module_id);
        let context_path = module_root.join(&context_id);
        let mut files = Vec::new();
        rust_files(&context_path, &mut files);
        let allowed = registry
            .closure(&module.depends)
            .unwrap_or_default()
            .into_iter()
            .collect::<HashSet<_>>();
        for path in files {
            let Ok(source) = fs::read_to_string(&path) else {
                continue;
            };
            for other_id in registry.modules.keys().filter(|id| *id != module_id) {
                let other_context = rust_context_id(other_id);
                let facade = format!("crate::modules::{other_context}::");
                if !source.contains(&facade) {
                    continue;
                }
                if !allowed.contains(other_id) {
                    issues.push(format!(
                        "[{module_id}] Rust context calls {other_id} without declaring it in depends: {}",
                        path.strip_prefix(root()).unwrap_or(&path).display()
                    ));
                }
                for layer in ["application", "domain", "persistence", "reports", "worker"] {
                    if source.contains(&format!("{facade}{layer}::")) {
                        issues.push(format!(
                            "[{module_id}] Rust context must use the {other_id} facade, not its internal {layer} layer: {}",
                            path.strip_prefix(root()).unwrap_or(&path).display()
                        ));
                    }
                }
            }
        }
    }
}

fn lint_kernel_dispatch(module_root: &Path, registry: &defs::Registry, issues: &mut Vec<String>) {
    let dispatcher = match fs::read_to_string(module_root.join("validation.rs")) {
        Ok(source) => source,
        Err(error) => {
            issues.push(format!(
                "Cannot read Rust action dispatcher server/src/modules/validation.rs: {error}"
            ));
            return;
        }
    };
    let data_path = root().join("server/src/kernel/data.rs");
    let mut kernel_data = match fs::read_to_string(&data_path) {
        Ok(source) => source,
        Err(error) => {
            issues.push(format!(
                "Cannot read {}: {error}",
                data_path
                    .strip_prefix(root())
                    .unwrap_or(&data_path)
                    .display()
            ));
            return;
        }
    };
    let data_modules_path = data_path.with_extension("");
    if data_modules_path.is_dir()
        && let Err(error) = append_rust_sources(&data_modules_path, &mut kernel_data)
    {
        issues.push(format!(
            "Cannot read Rust kernel data modules under {}: {error}",
            data_modules_path
                .strip_prefix(root())
                .unwrap_or(&data_modules_path)
                .display()
        ));
        return;
    }
    let module_dispatch_path = module_root.join("mod.rs");
    let module_dispatch = match fs::read_to_string(&module_dispatch_path) {
        Ok(source) => source,
        Err(error) => {
            issues.push(format!(
                "Cannot read {}: {error}",
                module_dispatch_path
                    .strip_prefix(root())
                    .unwrap_or(&module_dispatch_path)
                    .display()
            ));
            return;
        }
    };
    let event_dispatch_path = module_root.join("events.rs");
    let mut event_dispatch = match fs::read_to_string(&event_dispatch_path) {
        Ok(source) => source,
        Err(error) => {
            issues.push(format!(
                "Cannot read {}: {error}",
                event_dispatch_path
                    .strip_prefix(root())
                    .unwrap_or(&event_dispatch_path)
                    .display()
            ));
            return;
        }
    };
    let event_dispatch_modules = event_dispatch_path.with_extension("");
    if event_dispatch_modules.is_dir()
        && let Err(error) = append_rust_sources(&event_dispatch_modules, &mut event_dispatch)
    {
        issues.push(format!(
            "Cannot read Rust event dispatcher modules under {}: {error}",
            event_dispatch_modules
                .strip_prefix(root())
                .unwrap_or(&event_dispatch_modules)
                .display()
        ));
        return;
    }
    let domain_hooks = [
        "validate",
        "validate_update",
        "validate_remove",
        "validate_action",
    ];
    for module_id in registry.modules.keys() {
        let context_id = rust_context_id(module_id);
        let context = module_root.join(&context_id);
        let domain_path = context.join("domain.rs");
        let mod_path = context.join("mod.rs");
        let domain = match fs::read_to_string(&domain_path) {
            Ok(source) => source,
            Err(error) => {
                issues.push(format!(
                    "[{module_id}] Cannot read {}: {error}",
                    domain_path
                        .strip_prefix(root())
                        .unwrap_or(&domain_path)
                        .display()
                ));
                continue;
            }
        };
        let declaration = match fs::read_to_string(&mod_path) {
            Ok(source) => source,
            Err(error) => {
                issues.push(format!(
                    "[{module_id}] Cannot read {}: {error}",
                    mod_path.strip_prefix(root()).unwrap_or(&mod_path).display()
                ));
                continue;
            }
        };
        if declaration.contains("pub(crate) fn scheduled_jobs()")
            && !module_dispatch.contains(&format!(
                "\"{module_id}\" => {context_id}::scheduled_jobs()"
            ))
        {
            issues.push(format!(
                "[{module_id}] scheduled_jobs is not registered in server/src/modules/mod.rs"
            ));
        }
        for hook in domain_hooks {
            if !domain.contains(&format!("pub fn {hook}(")) {
                continue;
            }
            if !declaration.contains(hook) {
                issues.push(format!(
                    "[{module_id}] domain::{hook} is not exported from its Rust context"
                ));
            }
            let routed_hook = if domain.contains(&format!("pub fn {hook}_at(")) {
                format!("{hook}_at")
            } else {
                hook.to_string()
            };
            if !dispatcher.contains(&format!("{context_id}::{routed_hook}(")) {
                issues.push(format!(
                    "[{module_id}] domain::{hook} is not routed by server/src/modules/validation.rs"
                ));
            }
        }

        let persistence_path = context.join("persistence.rs");
        let persistence = match fs::read_to_string(&persistence_path) {
            Ok(source) => source,
            Err(error) => {
                issues.push(format!(
                    "[{module_id}] Cannot read {}: {error}",
                    persistence_path
                        .strip_prefix(root())
                        .unwrap_or(&persistence_path)
                        .display()
                ));
                continue;
            }
        };
        if persistence.contains("pub async fn validate_persistence(") {
            if !declaration.contains("validate_persistence") {
                issues.push(format!(
                    "[{module_id}] persistence::validate_persistence is not exported from its Rust context"
                ));
            }
            if !dispatcher.contains(&format!("{context_id}::validate_persistence(")) {
                issues.push(format!(
                    "[{module_id}] persistence::validate_persistence is not routed by server/src/modules/validation.rs"
                ));
            }
        }

        let application = match read_layer_sources(&context, "application") {
            Ok(source) => source,
            Err(error) => {
                issues.push(format!(
                    "[{module_id}] Cannot read application layer in {}: {error}",
                    context.strip_prefix(root()).unwrap_or(&context).display()
                ));
                continue;
            }
        };
        if application.contains("pub async fn prepare_document(")
            || application.contains("pub fn prepare_document(")
        {
            if !declaration.contains("prepare_document") {
                issues.push(format!(
                    "[{module_id}] application::prepare_document is not exported from its Rust context"
                ));
            }
            if !kernel_data.contains(&format!("crate::modules::{context_id}::prepare_document(")) {
                issues.push(format!(
                    "[{module_id}] application::prepare_document is not called by the kernel"
                ));
            }
        }
        if application.contains("pub async fn handle_source_event(") {
            if !declaration.contains("handle_source_event") {
                issues.push(format!(
                    "[{module_id}] application::handle_source_event is not exported from its Rust context"
                ));
            }
            if !event_dispatch.contains(&format!("{context_id}::handle_source_event(")) {
                issues.push(format!(
                    "[{module_id}] application::handle_source_event is not called by the Rust event dispatcher"
                ));
            }
        }
        let routed_action = if domain.contains("pub fn validate_action_at(") {
            "validate_action_at"
        } else {
            "validate_action"
        };
        if domain.contains("pub fn validate_action(")
            && !dispatcher.contains(&format!("{context_id}::{routed_action}("))
        {
            issues.push(format!(
                "[{module_id}] domain::validate_action is not routed by server/src/modules/validation.rs"
            ));
        }
    }
}

fn lint_expressions(value: &Value, location: &str, issues: &mut Vec<String>) {
    match value {
        Value::String(source) => {
            if let Some(expression) = source.strip_prefix('=') {
                if let Err(error) = expr::validate_expr(expression) {
                    issues.push(format!(
                        "{location}: biểu thức `{source}` không hợp lệ: {error}"
                    ));
                }
            }
        }
        Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                lint_expressions(item, &format!("{location}[{index}]"), issues);
            }
        }
        Value::Object(fields) => {
            for (key, item) in fields {
                lint_expressions(item, &format!("{location}.{key}"), issues);
            }
        }
        _ => {}
    }
}

fn lint(
    modules: &[defs::ModuleDef],
    verticals: &[defs::Vertical],
    registry: &defs::Registry,
) -> Vec<String> {
    let mut issues = Vec::new();
    lint_typescript_sources(&root(), &mut issues);
    let module_root = root().join("server/src/modules");
    lint_context_dependencies(&module_root, registry, &mut issues);
    lint_kernel_dispatch(&module_root, registry, &mut issues);
    let module_index = fs::read_to_string(module_root.join("mod.rs"));
    match &module_index {
        Ok(source) => {
            let expected_contexts = registry
                .modules
                .keys()
                .map(|id| rust_context_id(id))
                .collect::<HashSet<_>>();
            for id in registry.modules.keys() {
                let rust_id = rust_context_id(id);
                let directory = module_root.join(&rust_id);
                if !directory.is_dir() {
                    issues.push(format!(
                        "[{id}] thiếu Rust bounded-context folder server/src/modules/{rust_id}"
                    ));
                    continue;
                }
                for layer in ["mod.rs", "domain.rs", "application", "persistence.rs"] {
                    let exists = if layer == "application" {
                        directory.join("application.rs").is_file()
                            || directory.join("application/mod.rs").is_file()
                    } else {
                        directory.join(layer).is_file()
                    };
                    if !exists {
                        issues.push(format!(
                            "[{id}] thiếu lớp Rust {layer} trong server/src/modules/{rust_id}/"
                        ));
                    }
                }
                let declaration = format!("pub mod {rust_id};");
                if !source.lines().any(|line| line.trim() == declaration) {
                    issues.push(format!(
                        "[{id}] facade chưa được đăng ký trong server/src/modules/mod.rs"
                    ));
                }
            }
            match fs::read_dir(&module_root) {
                Ok(entries) => {
                    for entry in entries
                        .flatten()
                        .filter(|entry| entry.file_type().is_ok_and(|file_type| file_type.is_dir()))
                    {
                        let folder = entry.file_name().to_string_lossy().into_owned();
                        // events/ contains submodules for the shared events.rs
                        // dispatcher; it is not a catalog bounded context.
                        if folder != "events" && !expected_contexts.contains(&folder) {
                            issues.push(format!(
                                "Rust bounded context {folder} chưa có catalog definitions/modules/{}.json",
                                catalog_context_id(&folder)
                            ));
                        }
                    }
                }
                Err(error) => issues.push(format!(
                    "Không liệt kê được server/src/modules để kiểm tra context mồ côi: {error}"
                )),
            }
        }
        Err(error) => issues.push(format!(
            "Không đọc được server/src/modules/mod.rs để kiểm tra đăng ký bounded context: {error}"
        )),
    }
    for id in &registry.order {
        let module = &registry.modules[id];
        if !module.jobs.is_empty() {
            issues.push(format!(
                "[{id}] scheduled jobs must be implemented in the Rust bounded context, not the module catalog"
            ));
        }
        let allowed = registry
            .closure(&module.depends)
            .unwrap_or_default()
            .into_iter()
            .collect::<HashSet<_>>();
        for entity in &module.entities {
            let qname = format!("{}.{}", module.id, entity.name);
            for field in &entity.fields {
                if let Some(reference) = field.reference.as_deref() {
                    let Some((ref_module, _)) = reference.split_once('.') else {
                        issues.push(format!(
                            "[{id}] {qname}.{}: ref không hợp lệ {reference}",
                            field.name
                        ));
                        continue;
                    };
                    if !registry.entities.contains_key(reference) {
                        issues.push(format!(
                            "[{id}] {qname}.{}: ref tới {reference} không tồn tại",
                            field.name
                        ));
                    } else if ref_module != id && !allowed.contains(ref_module) {
                        issues.push(format!(
                            "[{id}] {qname}.{}: ref tới {reference} nhưng chưa khai báo depends",
                            field.name
                        ));
                    }
                }
            }
            let field_names = entity
                .fields
                .iter()
                .map(|field| field.name.as_str())
                .collect::<HashSet<_>>();
            for computed in entity.computed.keys() {
                if !field_names.contains(computed.as_str()) {
                    issues.push(format!(
                        "[{id}] {qname}: computed {computed} không phải trường"
                    ));
                }
            }
            for (field, source) in &entity.computed {
                if let Err(error) = expr::validate_expr(source) {
                    issues.push(format!(
                        "[{id}] {qname}.{field}: biểu thức không hợp lệ: {error}"
                    ));
                }
            }
        }
        for seed in &module.seeds {
            let qname = if seed.entity.contains('.') {
                seed.entity.clone()
            } else {
                format!("{id}.{}", seed.entity)
            };
            if !registry.entities.contains_key(&qname) {
                issues.push(format!("[{id}] seed: entity {} không tồn tại", seed.entity));
            }
        }
        for (index, rule) in module.rules.iter().enumerate() {
            let tag = format!("rule#{} on {}", index, rule.on);
            for (label, value) in [
                ("when", &rule.when),
                ("where", &rule.where_),
                ("map", &rule.map),
                ("match", &rule.match_),
                ("set", &rule.set),
                ("inc", &rule.inc),
            ] {
                if let Some(value) = value {
                    lint_expressions(value, &format!("[{id}] {tag}.{label}"), &mut issues);
                }
            }
            if !registry.events.contains(&rule.on) {
                issues.push(format!("[{id}] {tag}: sự kiện không tồn tại"));
                continue;
            }
            let target_name = registry.qualify(id, &rule.entity);
            let Some(target) = registry.entities.get(&target_name) else {
                issues.push(format!(
                    "[{id}] {tag}: entity đích {target_name} không tồn tại"
                ));
                continue;
            };
            if let Some(lookups) = &rule.lookup {
                for (name, lookup) in lookups {
                    let lookup_name = registry.qualify(id, &lookup.entity);
                    let Some(lookup_entity) = registry.entities.get(&lookup_name) else {
                        issues.push(format!(
                            "[{id}] {tag}: lookup {name} trỏ tới entity {lookup_name} không tồn tại"
                        ));
                        continue;
                    };
                    if let Value::Object(match_fields) = &lookup.match_ {
                        for field in match_fields.keys() {
                            if field != "id" && lookup_entity.field(field).is_none() {
                                issues.push(format!("[{id}] {tag}: lookup {name} dùng trường {field} không tồn tại trên {lookup_name}"));
                            }
                        }
                    }
                }
            }
            let keys = [&rule.map, &rule.match_, &rule.set, &rule.inc];
            let valid_fields = target
                .fields
                .iter()
                .map(|field| field.name.as_str())
                .collect::<HashSet<_>>();
            for object in keys.into_iter().flatten().filter_map(Value::as_object) {
                for key in object.keys() {
                    if key != "id" && !valid_fields.contains(key.as_str()) {
                        issues.push(format!(
                            "[{id}] {tag}: {key} không phải trường của {target_name}"
                        ));
                    }
                }
            }
            if let Some(Value::Object(increments)) = &rule.inc {
                for field in increments.keys() {
                    if target.field(field).is_some_and(|definition| {
                        !matches!(definition.ty.as_str(), "number" | "money")
                    }) {
                        issues.push(format!("[{id}] {tag}: chỉ được cộng dồn trường số/tiền, nhưng {target_name}.{field} không phải trường số"));
                    }
                }
            }
            if rule.do_ == "create" {
                let provided = rule
                    .map
                    .as_ref()
                    .and_then(Value::as_object)
                    .map(|o| o.keys().map(String::as_str).collect::<HashSet<_>>())
                    .unwrap_or_default();
                for field in target.fields.iter().filter(|field| field.required) {
                    if !provided.contains(field.name.as_str()) {
                        issues.push(format!(
                            "[{id}] {tag}: create {target_name} thiếu map trường bắt buộc {}",
                            field.name
                        ));
                    }
                }
            }
            if matches!(rule.do_.as_str(), "update" | "upsert" | "action") && rule.match_.is_none()
            {
                issues.push(format!("[{id}] {tag}: {} cần match", rule.do_));
            }
            if rule.do_ == "action" {
                let action = rule.action.as_deref().unwrap_or_default();
                if !target
                    .states
                    .as_ref()
                    .is_some_and(|states| states.actions.contains_key(action))
                {
                    issues.push(format!(
                        "[{id}] {tag}: action {action} không tồn tại trên {target_name}"
                    ));
                }
            }
            if let Some(action) = rule.then_action.as_deref() {
                if !target
                    .states
                    .as_ref()
                    .is_some_and(|states| states.actions.contains_key(action))
                {
                    issues.push(format!(
                        "[{id}] {tag}: thenAction {action} không tồn tại trên {target_name}"
                    ));
                }
            }
        }
    }
    for vertical in verticals {
        let vertical_modules: HashSet<String> = registry
            .closure(&vertical.modules)
            .unwrap_or_default()
            .into_iter()
            .collect();
        for module in &vertical.modules {
            if !registry.modules.contains_key(module) {
                issues.push(format!(
                    "[vertical:{}] module {module} không tồn tại",
                    vertical.id
                ));
            }
        }
        for qname in vertical
            .terminology
            .keys()
            .chain(vertical.custom_fields.keys())
        {
            if !registry.entities.contains_key(qname) {
                issues.push(format!(
                    "[vertical:{}] entity {qname} không tồn tại",
                    vertical.id
                ));
            }
        }
        for qname in &vertical.summary_entities {
            match registry.entities.get(qname) {
                None => issues.push(format!(
                    "[vertical:{}] summary entity {qname} khÃ´ng tá»“n táº¡i",
                    vertical.id
                )),
                Some(entity) if !vertical_modules.contains(&entity.module) => issues.push(format!(
                    "[vertical:{}] summary entity {qname} khÃ´ng thuá»™c gÃ³i module Ä‘Ã£ báº­t",
                    vertical.id
                )),
                Some(_) => {}
            }
        }
    }
    let _ = modules;
    issues
}

fn run_lint() -> Result<(), String> {
    let (modules, verticals, registry) = load()?;
    let issues = lint(&modules, &verticals, &registry);
    println!(
        "Modules: {} | Entities: {} | Events: {} | Verticals: {}",
        registry.modules.len(),
        registry.entities.len(),
        registry.events.len(),
        verticals.len()
    );
    if issues.is_empty() {
        println!("OK - không có vấn đề.");
        Ok(())
    } else {
        Err(format!(
            "{} vấn đề:\n- {}",
            issues.len(),
            issues.join("\n- ")
        ))
    }
}

fn write(relative: &str, content: &str) -> Result<(), String> {
    let path = root().join(relative);
    fs::write(&path, content).map_err(|error| format!("{}: {error}", path.display()))
}

fn run_docs() -> Result<(), String> {
    let (modules, verticals, registry) = load()?;
    let issues = lint(&modules, &verticals, &registry);
    if !issues.is_empty() {
        return Err(format!("Catalog có lỗi:\n- {}", issues.join("\n- ")));
    }
    let header = "> Tệp này được sinh tự động bởi `npm run docs`. Đừng sửa tay.\n\n";
    let mut md = format!(
        "# Danh mục module\n\n{header}Tổng: **{} module**, **{} loại dữ liệu**, **{} sự kiện**.\n\n",
        registry.modules.len(),
        registry.entities.len(),
        registry.events.len()
    );
    md.push_str("| Module | Nhóm | Phụ thuộc cứng |\n|---|---|---|\n");
    for id in &registry.order {
        let module = &registry.modules[id];
        let category = CATEGORIES
            .iter()
            .find(|(key, _)| *key == module.category)
            .map(|(_, label)| *label)
            .unwrap_or(&module.category);
        let deps = if module.depends.is_empty() {
            "—".to_string()
        } else {
            module
                .depends
                .iter()
                .map(|dependency| format!("`{dependency}`"))
                .collect::<Vec<_>>()
                .join(", ")
        };
        md.push_str(&format!(
            "| [`{}`](#{}) — {} | {} | {} |\n",
            module.id, module.id, module.name, category, deps
        ));
    }
    for (category, label) in CATEGORIES {
        let modules = registry
            .order
            .iter()
            .filter(|id| registry.modules[*id].category == category)
            .collect::<Vec<_>>();
        if modules.is_empty() {
            continue;
        }
        md.push_str(&format!("\n## {label}\n"));
        for id in modules {
            let module = &registry.modules[id];
            md.push_str(&format!("\n### {}\n**{}** — {}\n\n| Dữ liệu | Trạng thái → hành động (mỗi hành động phát một sự kiện) |\n|---|---|\n", module.id, module.name, module.description));
            for entity in &module.entities {
                let actions = entity
                    .states
                    .as_ref()
                    .map(|states| {
                        let mut text = format!("`{}` → ", states.initial);
                        text.push_str(
                            &states
                                .actions
                                .iter()
                                .map(|(name, transition)| {
                                    format!(
                                        "**{name}** ({}→{})",
                                        transition.from.join("/"),
                                        transition.to
                                    )
                                })
                                .collect::<Vec<_>>()
                                .join(", "),
                        );
                        text
                    })
                    .unwrap_or_else(|| "—".into());
                md.push_str(&format!(
                    "| `{}` {} | {} |\n",
                    entity.name, entity.label, actions
                ));
            }
            if !module.rules.is_empty() {
                md.push_str("\n**Phản ứng với module khác:**\n\n");
                for rule in &module.rules {
                    md.push_str(&format!(
                        "- `{}` → {} `{}`{}\n",
                        rule.on,
                        rule.do_,
                        rule.entity,
                        rule.note
                            .as_deref()
                            .map(|note| format!(" — {note}"))
                            .unwrap_or_default()
                    ));
                }
            }
        }
    }
    write("docs/MODULE-CATALOG.md", &md)?;

    let mut edges = BTreeMap::<(String, String), usize>::new();
    for module in &modules {
        for rule in &module.rules {
            let source = rule.on.split('.').next().unwrap_or_default();
            if source != module.id {
                *edges
                    .entry((source.to_string(), module.id.clone()))
                    .or_default() += 1;
            }
        }
    }
    let distinct = edges
        .keys()
        .flat_map(|(source, target)| [source.clone(), target.clone()])
        .collect::<HashSet<_>>()
        .len();
    let mut im = format!(
        "# Bản đồ tích hợp giữa các module\n\n{header}Mỗi mũi tên là một hoặc nhiều **luật tích hợp**: module nguồn phát sự kiện, module đích tự phản ứng. Nếu module đích chưa bật cho tenant, luật tự bỏ qua; bật thêm module thì luồng tự nối vào, không cần cấu hình.\n\n**{} luật** nối **{} module**.\n\n```mermaid\nflowchart LR\n",
        edges.values().sum::<usize>(),
        distinct
    );
    for ((source, target), count) in &edges {
        im.push_str(&format!(
            "  {}[\"{}\"] -->|{}| {}[\"{}\"]\n",
            source.replace('-', "_"),
            source,
            count,
            target.replace('-', "_"),
            target
        ));
    }
    im.push_str("```\n\n## Chi tiết từng luật\n\n| Sự kiện nguồn | Module phản ứng | Hành động | Ý nghĩa |\n|---|---|---|---|\n");
    let mut inbound = BTreeMap::<String, usize>::new();
    for ((_, target), count) in &edges {
        *inbound.entry(target.clone()).or_default() += count;
    }
    for module in &modules {
        for rule in &module.rules {
            if rule.on.split('.').next() == Some(module.id.as_str()) {
                continue;
            }
            im.push_str(&format!(
                "| `{}` | `{}` | {} `{}`{} | {} |\n",
                rule.on,
                module.id,
                rule.do_,
                rule.entity,
                rule.then_action
                    .as_deref()
                    .map(|action| format!(" → {action}"))
                    .unwrap_or_default(),
                rule.note.as_deref().unwrap_or("")
            ));
        }
    }
    let mut hubs = inbound.into_iter().collect::<Vec<_>>();
    hubs.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    im.push_str("\n## Module trung tâm (nhận nhiều luồng nhất)\n\n");
    for (id, count) in hubs.into_iter().take(5) {
        im.push_str(&format!("- `{id}`: {count} luồng vào\n"));
    }
    write("docs/INTEGRATION-MAP.md", &im)?;

    let mut vm = format!(
        "# Gói ngành\n\n{header}Mỗi gói ngành chỉ là **cấu hình** (module nào bật, thuật ngữ, trường mở rộng, vai trò, KPI), không nhân bản mã nguồn. Khi tạo tenant với `vertical`, hệ thống tự áp dụng cả gói.\n\n**{} ngành**:\n\n",
        verticals.len()
    );
    for vertical in &verticals {
        let closure = registry.closure(&vertical.modules)?;
        vm.push_str(&format!(
            "## {} (`{}`)\n{}\n\n",
            vertical.name, vertical.id, vertical.description
        ));
        vm.push_str(&format!(
            "- **Module ({}):** {}\n",
            closure.len(),
            closure
                .iter()
                .map(|id| format!("`{id}`"))
                .collect::<Vec<_>>()
                .join(", ")
        ));
        vm.push_str(&format!(
            "- **Thuật ngữ:** {}\n",
            vertical
                .terminology
                .iter()
                .map(|(key, value)| format!("`{key}` = {value}"))
                .collect::<Vec<_>>()
                .join("; ")
        ));
        vm.push_str(&format!(
            "- **Trường mở rộng:** {}\n",
            vertical
                .custom_fields
                .iter()
                .map(|(qname, fields)| format!(
                    "`{qname}`: {}",
                    fields
                        .iter()
                        .map(|field| field.name.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ))
                .collect::<Vec<_>>()
                .join("; ")
        ));
        vm.push_str(&format!(
            "- **Vai trò riêng:** {}\n",
            vertical
                .roles
                .values()
                .map(|role| role.name.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        ));
        vm.push_str(&format!(
            "- **Dashboard summary entities:** {}\n",
            vertical.summary_entities.join(", ")
        ));
        vm.push_str(&format!("- **KPI:** {}\n\n", vertical.kpis.join("; ")));
    }
    write("docs/VERTICALS.md", &vm)?;
    let openapi = openapi::build(&registry);
    write(
        "docs/openapi.json",
        &(serde_json::to_string_pretty(&openapi).map_err(|error| error.to_string())? + "\n"),
    )?;
    println!(
        "Đã sinh docs: {} module, {} cặp liên kết, {} ngành.",
        registry.modules.len(),
        edges.len(),
        verticals.len()
    );
    Ok(())
}

fn run_new_module(args: &[String]) -> Result<(), String> {
    let id = args.first().ok_or("Thiếu id module")?;
    let name = args.get(1).ok_or("Thiếu tên module")?;
    let category = args.get(2).map(String::as_str).unwrap_or("operations");
    let dependencies = args.get(3).map(String::as_str).unwrap_or("master-data");
    let description = args
        .get(4)
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("Thiếu mô tả phạm vi nghiệp vụ và tích hợp cho module")?;
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || !id.chars().next().is_some_and(|c| c.is_ascii_lowercase())
    {
        return Err("Id cần dạng kebab-case bắt đầu bằng chữ thường".into());
    }
    if !CATEGORIES.iter().any(|(known, _)| *known == category) {
        return Err(format!("Nhóm module không hợp lệ: {category}"));
    }
    let target = root()
        .join("definitions/modules")
        .join(format!("{id}.json"));
    if target.exists() {
        return Err(format!("Module {id} đã tồn tại"));
    }
    let rust_id = id.replace('-', "_");
    let rust_target = root().join("server/src/modules").join(&rust_id);
    if rust_target.exists() {
        return Err(format!("Rust context {rust_id} đã tồn tại"));
    }
    let depends = dependencies
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let definition = json!({
        "id": id, "name": name, "description": description,
        "category": category, "version": "0.1.0", "depends": depends, "core": false,
        "entities": [{ "name": "item", "label": "Mục", "fields": [
            { "name": "name", "type": "string", "required": true },
            { "name": "party", "type": "ref", "required": false, "ref": "master-data.party" },
            { "name": "amount", "type": "money", "required": false },
            { "name": "status", "type": "enum", "required": false, "options": ["draft", "confirmed"] }
        ], "states": { "field": "status", "initial": "draft", "actions": { "confirmed": { "from": ["draft"], "to": "confirmed" } } }, "computed": {}, "constraints": [] }],
        "rules": [], "seeds": [], "publishes": [], "jobs": []
    });
    fs::create_dir_all(target.parent().expect("catalog target has a parent"))
        .map_err(|error| error.to_string())?;
    fs::write(
        &target,
        serde_json::to_string_pretty(&definition).map_err(|error| error.to_string())? + "\n",
    )
    .map_err(|error| error.to_string())?;
    fs::create_dir_all(&rust_target).map_err(|error| error.to_string())?;
    let rust_files: [(&str, String); 4] = [
        (
            "mod.rs",
            "//! Generated bounded context facade; replace this scaffold with the module contract.\nmod application;\nmod domain;\nmod persistence;\npub use application::prepare_document;\npub use domain::{validate, validate_action, validate_remove, validate_update};\npub use persistence::validate_persistence;\n".into(),
        ),
        (
            "domain.rs",
            r#"//! Pure business invariants and lifecycle policy.
use serde_json::Value;

pub fn validate(entity: &str, _document: &Value) -> Vec<String> {
    vec![format!("{entity}: implement domain validation before enabling this module")]
}

pub fn validate_update(entity: &str, _current: &Value, _patch: &Value) -> Vec<String> {
    vec![format!("{entity}: implement update policy before enabling this module")]
}

pub fn validate_remove(entity: &str, _document: &Value) -> Vec<String> {
    vec![format!("{entity}: implement retention policy before enabling this module")]
}

pub fn validate_action(entity: &str, action: &str, _document: &Value) -> Vec<String> {
    vec![format!("{entity}.{action}: implement transition policy before enabling this module")]
}
"#.into(),
        ),
        (
            "application.rs",
            r#"//! Use-case preparation and orchestration for this context.
use serde_json::{Map, Value};

pub fn prepare_document(entity: &str, _document: &mut Map<String, Value>) -> Vec<String> {
    vec![format!("{entity}: implement application preparation before enabling this module")]
}
"#.into(),
        ),
        (
            "persistence.rs",
            r#"//! Tenant-scoped cross-record checks and concurrency controls.
use crate::{db::Tx, error::R, kernel::Tenant};
use serde_json::Value;

pub async fn validate_persistence(
    _tx: &Tx<'_>,
    _tenant: &Tenant,
    entity: &str,
    action: &str,
    _document: &Value,
) -> R<Vec<String>> {
    Ok(vec![format!("{entity}.{action}: implement tenant persistence checks before enabling this module")])
}
"#.into(),
        ),
    ];
    for (file, contents) in rust_files {
        fs::write(rust_target.join(file), contents).map_err(|error| error.to_string())?;
    }
    println!(
        "Đã tạo definitions/modules/{id}.json và server/src/modules/{rust_id}/. Tiếp theo: đăng ký facade và dispatch trong modules/mod.rs, thay các hàm khởi tạo, chạy catalog lint và cargo check."
    );
    Ok(())
}

fn main() {
    let mut args = std::env::args().skip(1);
    let command = args.next().unwrap_or_else(|| "lint".into());
    let result = match command.as_str() {
        "lint" => run_lint(),
        "docs" => run_docs(),
        "export" => run_lint().map(|()| {
            println!("Catalog JSON đã là định dạng runtime; không cần bước biên dịch riêng.")
        }),
        "new" => run_new_module(&args.collect::<Vec<_>>()),
        _ => Err(format!(
            "Lệnh không hợp lệ: {command}. Dùng lint|docs|export|new."
        )),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
