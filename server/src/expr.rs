//! Bộ tính biểu thức nhỏ, an toàn (không eval) cho trường computed và luật tích hợp.
//! Cú pháp: số, + - * / ( ), đường dẫn ($.a.b | $$.a | a.b), sum(mảng, biểu_thức), floor, ceil, round, abs, min, max.
//!   $.x  -> trường của đối tượng hiện tại (bản ghi, hoặc phần tử khi forEach)
//!   $$.x -> trường của payload sự kiện gốc
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::{Decimal, RoundingStrategy};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

pub struct Scope<'a> {
    pub this: &'a Value,
    pub event: &'a Value,
}

pub fn get_path<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    if path.is_empty() {
        return Some(v);
    }
    let mut cur = v;
    for k in path.split('.') {
        cur = cur.get(k)?;
        if cur.is_null() {
            return None;
        }
    }
    Some(cur)
}

pub fn resolve_path<'a>(p: &str, s: &Scope<'a>) -> Option<&'a Value> {
    if p == "$" {
        return Some(s.this);
    }
    if p == "$$" {
        return Some(s.event);
    }
    if let Some(r) = p.strip_prefix("$$.") {
        return get_path(s.event, r);
    }
    if let Some(r) = p.strip_prefix("$.") {
        return get_path(s.this, r);
    }
    get_path(s.this, p)
}

#[derive(Debug, Clone)]
enum Node {
    Num(Decimal),
    Path(String),
    Bin(char, Box<Node>, Box<Node>),
    Neg(Box<Node>),
    Call(String, Vec<Node>),
}

fn tokenize(src: &str) -> Result<Vec<String>, String> {
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < chars.len() {
        let c = chars[i];
        if c.is_whitespace() {
            i += 1;
        } else if c.is_ascii_digit() {
            let s = i;
            while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                i += 1;
            }
            out.push(chars[s..i].iter().collect());
        } else if c == '$' || c.is_ascii_alphabetic() || c == '_' {
            let s = i;
            if c == '$' {
                i += 1;
                if i < chars.len() && chars[i] == '$' {
                    i += 1;
                }
            }
            while i < chars.len()
                && (chars[i].is_ascii_alphanumeric()
                    || chars[i] == '_'
                    || (chars[i] == '.'
                        && i + 1 < chars.len()
                        && (chars[i + 1].is_ascii_alphanumeric() || chars[i + 1] == '_')))
            {
                i += 1;
            }
            out.push(chars[s..i].iter().collect());
        } else if "+-*/(),".contains(c) {
            out.push(c.to_string());
            i += 1;
        } else {
            return Err(format!("Biểu thức không hợp lệ: \"{src}\""));
        }
    }
    Ok(out)
}

struct Parser<'a> {
    toks: &'a [String],
    i: usize,
    src: &'a str,
}

impl Parser<'_> {
    fn peek(&self) -> Option<&str> {
        self.toks.get(self.i).map(|s| s.as_str())
    }
    fn next(&mut self) -> Option<String> {
        let t = self.toks.get(self.i).cloned();
        self.i += 1;
        t
    }
    fn expr(&mut self) -> Result<Node, String> {
        let mut l = self.term()?;
        while matches!(self.peek(), Some("+") | Some("-")) {
            let op = self.next().unwrap().chars().next().unwrap();
            l = Node::Bin(op, Box::new(l), Box::new(self.term()?));
        }
        Ok(l)
    }
    fn term(&mut self) -> Result<Node, String> {
        let mut l = self.factor()?;
        while matches!(self.peek(), Some("*") | Some("/")) {
            let op = self.next().unwrap().chars().next().unwrap();
            l = Node::Bin(op, Box::new(l), Box::new(self.factor()?));
        }
        Ok(l)
    }
    fn factor(&mut self) -> Result<Node, String> {
        let tk = self
            .next()
            .ok_or_else(|| format!("Biểu thức thiếu toán hạng: \"{}\"", self.src))?;
        if tk == "-" {
            return Ok(Node::Neg(Box::new(self.factor()?)));
        }
        if tk == "(" {
            let e = self.expr()?;
            if self.next().as_deref() != Some(")") {
                return Err(format!("Thiếu \")\" trong: \"{}\"", self.src));
            }
            return Ok(e);
        }
        if tk.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return tk
                .parse::<Decimal>()
                .map(Node::Num)
                .map_err(|_| format!("Số không hợp lệ: {tk}"));
        }
        let is_ident = tk
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_');
        if is_ident && self.peek() == Some("(") {
            self.next();
            let mut args = Vec::new();
            if self.peek() != Some(")") {
                args.push(self.expr()?);
                while self.peek() == Some(",") {
                    self.next();
                    args.push(self.expr()?);
                }
            }
            if self.next().as_deref() != Some(")") {
                return Err(format!("Thiếu \")\" sau hàm {tk} trong: \"{}\"", self.src));
            }
            return Ok(Node::Call(tk, args));
        }
        if tk.starts_with('$') || is_ident {
            return Ok(Node::Path(tk));
        }
        Err(format!("Token lạ \"{tk}\" trong: \"{}\"", self.src))
    }
}

static CACHE: OnceLock<Mutex<HashMap<String, Node>>> = OnceLock::new();

fn parse(src: &str) -> Result<Node, String> {
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(n) = cache.lock().unwrap().get(src) {
        return Ok(n.clone());
    }
    let toks = tokenize(src)?;
    let mut p = Parser {
        toks: &toks,
        i: 0,
        src,
    };
    let ast = p.expr()?;
    if p.i < toks.len() {
        return Err(format!("Biểu thức thừa token \"{}\": \"{src}\"", toks[p.i]));
    }
    cache.lock().unwrap().insert(src.to_string(), ast.clone());
    Ok(ast)
}

/// Validate an expression without evaluating it against sample data.
pub fn validate_expr(src: &str) -> Result<(), String> {
    fn validate_node(node: &Node) -> Result<(), String> {
        match node {
            Node::Num(_) | Node::Path(_) => Ok(()),
            Node::Neg(inner) => validate_node(inner),
            Node::Bin(_, left, right) => {
                validate_node(left)?;
                validate_node(right)
            }
            Node::Call(name, args) => {
                let valid = match name.as_str() {
                    "sum" => args.len() == 2 && matches!(args.first(), Some(Node::Path(_))),
                    "floor" | "ceil" | "round" | "abs" => args.len() == 1,
                    "min" | "max" => !args.is_empty(),
                    _ => false,
                };
                if !valid {
                    return Err(format!("Hàm hoặc số đối số không hợp lệ: {name}"));
                }
                for arg in args {
                    validate_node(arg)?;
                }
                Ok(())
            }
        }
    }

    validate_node(&parse(src)?)
}

fn to_num(v: Option<&Value>) -> Decimal {
    match v {
        Some(Value::Number(_)) => v.and_then(crate::money::decimal).unwrap_or(Decimal::ZERO),
        Some(Value::String(value)) => {
            crate::money::decimal_str(value.trim()).unwrap_or(Decimal::ZERO)
        }
        _ => Decimal::ZERO,
    }
}

fn eval(n: &Node, s: &Scope) -> Option<Decimal> {
    match n {
        Node::Num(v) => Some(*v),
        Node::Path(p) => Some(to_num(resolve_path(p, s))),
        Node::Neg(e) => eval(e, s)?.checked_mul(Decimal::NEGATIVE_ONE),
        Node::Bin(op, l, r) => {
            let (a, b) = (eval(l, s)?, eval(r, s)?);
            match op {
                '+' => a.checked_add(b),
                '-' => a.checked_sub(b),
                '*' => a.checked_mul(b),
                '/' => a.checked_div(b),
                _ => None,
            }
        }
        Node::Call(f, args) => {
            if f == "sum" {
                let (Some(Node::Path(p)), Some(inner)) = (args.first(), args.get(1)) else {
                    return None;
                };
                let arr = resolve_path(p, s)?.as_array()?;
                let mut total = Decimal::ZERO;
                for item in arr {
                    total = total.checked_add(
                        eval(
                            inner,
                            &Scope {
                                this: item,
                                event: s.event,
                            },
                        )
                        .unwrap_or(Decimal::ZERO),
                    )?;
                }
                return Some(total);
            }
            let vals: Option<Vec<Decimal>> = args.iter().map(|a| eval(a, s)).collect();
            let vals = vals?;
            let first = *vals.first()?;
            match f.as_str() {
                "floor" => Some(first.floor()),
                "ceil" => Some(first.ceil()),
                "round" => {
                    Some(first.round_dp_with_strategy(0, RoundingStrategy::MidpointAwayFromZero))
                }
                "abs" => Some(first.abs()),
                "min" => vals.into_iter().min(),
                "max" => vals.into_iter().max(),
                _ => None,
            }
        }
    }
}

/// None khi không tính được (ví dụ sum() trên trường chưa có) -> bỏ qua.
pub fn eval_expr_decimal(src: &str, s: &Scope) -> Option<Decimal> {
    let ast = parse(src).ok()?;
    eval(&ast, s)
}

/// Compatibility conversion for callers that still need a machine float.
pub fn eval_expr(src: &str, s: &Scope) -> Option<f64> {
    eval_expr_decimal(src, s)?.to_f64()
}

pub fn decimal_value(value: Decimal) -> Value {
    crate::money::json_number(
        value.round_dp_with_strategy(6, RoundingStrategy::MidpointAwayFromZero),
    )
    .unwrap_or(Value::Null)
}

/// Compatibility serializer for legacy callers that produce `f64` values.
pub fn num_value(value: f64) -> Value {
    Decimal::from_f64_retain(value)
        .map(decimal_value)
        .unwrap_or(Value::Null)
}

/// Giải giá trị trong luật: "=biểu_thức" | "$.path" | "$$.path" | "$now" | hằng (đệ quy qua mảng/đối tượng).
pub fn resolve_value(v: &Value, s: &Scope) -> Value {
    match v {
        Value::String(t) => {
            if let Some(e) = t.strip_prefix('=') {
                return eval_expr_decimal(e, s)
                    .map(decimal_value)
                    .unwrap_or(Value::Null);
            }
            if t == "$now" {
                return json!(chrono::Utc::now().to_rfc3339());
            }
            if t == "$" || t == "$$" || t.starts_with("$.") || t.starts_with("$$.") {
                return resolve_path(t, s).cloned().unwrap_or(Value::Null);
            }
            v.clone()
        }
        Value::Array(a) => Value::Array(a.iter().map(|x| resolve_value(x, s)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), resolve_value(x, s)))
                .collect(),
        ),
        _ => v.clone(),
    }
}

fn norm(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => "null".to_string(),
        Some(x) => x.to_string(),
    }
}

/// Điều kiện { path: value | "$exists" | "$missing" | "$.other" } trên `this`.
pub fn matches(cond: Option<&Value>, s: &Scope) -> bool {
    let Some(Value::Object(map)) = cond else {
        return true;
    };
    for (path, expected) in map {
        let actual = get_path(s.this, path);
        match expected.as_str() {
            Some("$exists") => {
                if actual.is_none() || actual == Some(&json!("")) {
                    return false;
                }
            }
            Some("$missing") => {
                if actual.is_some() && actual != Some(&json!("")) {
                    return false;
                }
            }
            Some("$positive") => {
                if !actual
                    .and_then(crate::money::decimal)
                    .is_some_and(|value| value > Decimal::ZERO)
                {
                    return false;
                }
            }
            _ => {
                let exp = resolve_value(expected, s);
                let e = if exp.is_null() { None } else { Some(&exp) };
                if norm(actual) != norm(e) {
                    return false;
                }
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s<'a>(v: &'a Value) -> Scope<'a> {
        Scope { this: v, event: v }
    }

    #[test]
    fn arithmetic_and_sum() {
        let rec = json!({"lines":[{"qty":2,"price":10},{"qty":3,"price":5}],"gross":100,"ded":30});
        assert_eq!(eval_expr("sum(lines, qty*price)", &s(&rec)), Some(35.0));
        assert_eq!(eval_expr("gross-ded", &s(&rec)), Some(70.0));
        assert_eq!(eval_expr("floor(gross/30)", &s(&rec)), Some(3.0));
        assert_eq!(eval_expr("sum(nothing, qty)", &s(&rec)), None);
        assert_eq!(eval_expr("gross/0", &s(&rec)), None);
        assert_eq!(eval_expr("1 +", &s(&rec)), None);
        assert_eq!(eval_expr("0-$.gross", &s(&rec)), Some(-100.0));
    }

    #[test]
    fn nested_paths_and_values() {
        let ev = json!({"total": 180000, "_lookup": {"bom": {"output_qty": 4}}});
        let item = json!({"qty": 2});
        let sc = Scope {
            this: &item,
            event: &ev,
        };
        assert_eq!(
            eval_expr("$.qty*10/$$._lookup.bom.output_qty", &sc),
            Some(5.0)
        );
        assert_eq!(
            resolve_value(&json!("=floor($$.total/10000)"), &sc),
            json!(18)
        );
        assert_eq!(
            resolve_value(&json!({"a":"$.qty","b":["$$.total"]}), &sc),
            json!({"a":2,"b":[180000]})
        );
    }

    #[test]
    fn conditions() {
        let v = json!({"party":"p1","source":"ecommerce"});
        assert!(matches(Some(&json!({"party":"$exists"})), &s(&v)));
        assert!(!matches(Some(&json!({"missing":"$exists"})), &s(&v)));
        assert!(matches(Some(&json!({"missing":"$missing"})), &s(&v)));
        assert!(matches(Some(&json!({"source":"ecommerce"})), &s(&v)));
        assert!(!matches(Some(&json!({"source":"pos"})), &s(&v)));
    }
}
