use super::shared::*;

impl Kernel {
    #[async_recursion]
    pub(crate) async fn remove_in(
        &self,
        tx: &Tx<'_>,
        actor: &Actor,
        t: &Tenant,
        ent: &Ent,
        id: &str,
        opts: &Opts,
    ) -> R<()> {
        let qname = ent.qname();
        if ent.def.system_managed && !matches!(actor, Actor::System) {
            return Err(ApiError::validation(
                &qname,
                vec!["Bản ghi này chỉ được xóa từ luồng nghiệp vụ Rust của hệ thống".into()],
            ));
        }
        // Serialize deletion with updates, actions and child-record creation.
        let uid = Uuid::parse_str(id).map_err(|_| ApiError::not_found(format!("{qname} {id}")))?;
        let row = tx
            .query_opt(
                &format!(
                    "SELECT id FROM {} WHERE tenant_id = $1 AND id = $2 FOR UPDATE",
                    crate::schema::quote(&ent.def.table())
                ),
                &[&t.id, &uid],
            )
            .await?;
        if row.is_none() {
            return Err(ApiError::not_found(format!("{qname} {id}")));
        }
        let cur = self
            .get_row(tx, t, &qname, id)
            .await?
            .ok_or_else(|| ApiError::not_found(format!("Không tìm thấy {qname} {id}")))?;
        let domain_errors = crate::modules::validate_remove(&qname, &Value::Object(cur.clone()));
        if !domain_errors.is_empty() {
            return Err(ApiError::validation(&qname, domain_errors));
        }
        let persistence_errors = crate::modules::validate_persistence(
            tx,
            t,
            &qname,
            "removed",
            &Value::Object(cur.clone()),
        )
        .await?;
        if !persistence_errors.is_empty() {
            return Err(ApiError::validation(&qname, persistence_errors));
        }
        let uid = Uuid::parse_str(id).map_err(|_| ApiError::not_found("id không hợp lệ"))?;
        // Khóa ngoại của PostgreSQL chặn xóa bản ghi đang được tham chiếu (lỗi 23503 -> 409 REFERENCED).
        // Savepoint để lỗi khóa ngoại không làm giao dịch ở trạng thái hỏng.
        let sp = tx.savepoint().await?;
        match tx
            .execute(&self.sql_for(&qname).delete, &[&t.id, &uid])
            .await
        {
            Ok(_) => tx.release(&sp).await?,
            Err(e) => {
                tx.rollback_to(&sp).await?;
                return Err(e);
            }
        }
        // Trường mở rộng kiểu ref nằm trong jsonb nên không có khóa ngoại: kiểm tra thêm ở tầng ứng dụng
        for (rq, fields) in &t.extensions {
            for f in fields
                .iter()
                .filter(|f| f.ty == "ref" && f.reference.as_deref() == Some(qname.as_str()))
            {
                let Some(d) = self.reg.entity(rq) else {
                    continue;
                };
                let sql = format!(
                    "SELECT 1 FROM {} WHERE tenant_id = $1 AND custom->>$2 = $3 LIMIT 1",
                    crate::schema::quote(&d.table())
                );
                if tx.query_opt(&sql, &[&t.id, &f.name, &id]).await?.is_some() {
                    return Err(ApiError::new(
                        409,
                        "REFERENCED",
                        "Không thể xóa: bản ghi đang được dùng ở nơi khác",
                    ));
                }
            }
        }
        self.audit(tx, t, actor, "delete", &format!("{qname}#{id}"), None)
            .await?;
        self.emit(tx, t, &format!("{qname}.deleted"), Value::Object(cur), opts)
            .await?;
        Ok(())
    }
}
