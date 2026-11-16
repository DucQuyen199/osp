use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

/// Lỗi nghiệp vụ có mã HTTP. Mọi lớp trong kernel trả về kiểu này.
#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: u16,
    pub code: String,
    pub message: String,
    pub details: Option<Value>,
}

pub type R<T> = Result<T, ApiError>;

impl ApiError {
    pub fn new(status: u16, code: &str, message: impl Into<String>) -> Self {
        Self {
            status,
            code: code.to_string(),
            message: message.into(),
            details: None,
        }
    }
    pub fn with_details(mut self, d: Value) -> Self {
        self.details = Some(d);
        self
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(404, "NOT_FOUND", message)
    }
    pub fn validation(prefix: &str, errors: Vec<String>) -> Self {
        Self::new(
            422,
            "VALIDATION",
            format!("{prefix}: {}", errors.join("; ")),
        )
        .with_details(json!(errors))
    }
    pub fn forbidden(perm: &str) -> Self {
        Self::new(403, "FORBIDDEN", format!("Không đủ quyền: {perm}"))
    }
    pub fn internal(e: impl std::fmt::Display) -> Self {
        tracing::error!(error = %e, "lỗi nội bộ");
        Self::new(500, "INTERNAL", "Lỗi hệ thống")
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl From<tokio_postgres::Error> for ApiError {
    fn from(e: tokio_postgres::Error) -> Self {
        if let Some(db) = e.as_db_error() {
            // Ánh xạ lỗi ràng buộc của PostgreSQL sang lỗi nghiệp vụ có nghĩa
            match db.code().code() {
                // ON DELETE RESTRICT: PostgreSQL 18 báo 23001 (restrict_violation); bản cũ hơn báo 23503
                "23001" => {
                    return Self::new(
                        409,
                        "REFERENCED",
                        "Không thể xóa: bản ghi đang được dùng ở nơi khác",
                    );
                }
                "23503" => {
                    let msg = db.message();
                    return if msg.contains("is still referenced")
                        || msg.contains("update or delete")
                    {
                        Self::new(
                            409,
                            "REFERENCED",
                            "Không thể xóa: bản ghi đang được dùng ở nơi khác",
                        )
                    } else {
                        Self::new(
                            422,
                            "VALIDATION",
                            "Tham chiếu tới bản ghi không tồn tại hoặc thuộc doanh nghiệp khác",
                        )
                    };
                }
                "23505" => return Self::new(409, "CONFLICT", "Dữ liệu bị trùng"),
                "23514" => {
                    return Self::new(
                        422,
                        "VALIDATION",
                        format!(
                            "Giá trị vi phạm ràng buộc: {}",
                            db.constraint().unwrap_or("")
                        ),
                    );
                }
                "23502" => return Self::new(422, "VALIDATION", "Thiếu trường bắt buộc"),
                _ => {}
            }
            return Self::internal(format!(
                "{} [{}] {} at {:?}",
                db.message(),
                db.code().code(),
                db.detail().unwrap_or(""),
                db.position()
            ));
        }
        Self::internal(e)
    }
}

impl From<deadpool_postgres::PoolError> for ApiError {
    fn from(e: deadpool_postgres::PoolError) -> Self {
        Self::internal(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let mut err = json!({ "code": self.code, "message": self.message });
        if let Some(d) = self.details {
            err["details"] = d;
        }
        let mut response = (status, axum::Json(json!({ "error": err }))).into_response();
        response.headers_mut().insert(
            axum::http::header::CACHE_CONTROL,
            axum::http::HeaderValue::from_static("no-store"),
        );
        if status == StatusCode::TOO_MANY_REQUESTS {
            response.headers_mut().insert(
                axum::http::header::RETRY_AFTER,
                axum::http::HeaderValue::from_static("60"),
            );
        }
        response
    }
}
