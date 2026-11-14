//! SLA performance read model built from ticket state-change events.
use crate::{
    db::Tx,
    error::{ApiError, R},
    kernel::{Actor, Kernel, Tenant},
};
use serde_json::{Value, json};

impl Kernel {
    /// Summarizes first-response and resolution SLA status; includes the newest 500 tickets.
    pub async fn helpdesk_sla_report(&self, actor: &Actor, tenant: &Tenant) -> R<Value> {
        if !tenant.has_module("helpdesk") {
            return Err(ApiError::new(
                404,
                "MODULE_DISABLED",
                "Module helpdesk is not enabled for this tenant",
            ));
        }
        self.authorize(tenant, actor, "helpdesk.ticket.read")?;
        let mut conn = self.pool.get().await?;
        let tx = Tx::begin(&mut conn, &tenant.id, false).await?;
        let mut rows = tx
            .query_json(
                "WITH ticket_sla AS ( \
                   SELECT t.id, t.subject, t.status, t.priority, t.created_at, \
                     t.created_at + p.response_hours * interval '1 hour' AS response_due_at, \
                     t.created_at + p.resolve_hours * interval '1 hour' AS resolution_due_at, \
                     response.at AS first_response_at, resolution.at AS last_resolved_at, \
                     CASE WHEN p.id IS NULL THEN 'unassigned' \
                       WHEN response.at IS NULL AND now() > t.created_at + p.response_hours * interval '1 hour' THEN 'breached' \
                       WHEN response.at IS NULL THEN 'pending' \
                       WHEN response.at <= t.created_at + p.response_hours * interval '1 hour' THEN 'met' \
                       ELSE 'breached' END AS response_sla, \
                     CASE WHEN p.id IS NULL THEN 'unassigned' \
                       WHEN t.status IN ('resolved', 'closed') AND resolution.at <= t.created_at + p.resolve_hours * interval '1 hour' THEN 'met' \
                       WHEN t.status IN ('resolved', 'closed') THEN 'breached' \
                       WHEN now() > t.created_at + p.resolve_hours * interval '1 hour' THEN 'breached' \
                       ELSE 'pending' END AS resolution_sla \
                   FROM helpdesk__ticket t \
                   LEFT JOIN helpdesk__sla_policy p ON p.tenant_id = t.tenant_id AND p.id = t.sla_policy \
                   LEFT JOIN LATERAL (SELECT min(e.at) AS at FROM osp_events e \
                     WHERE e.tenant_id = t.tenant_id AND e.record_id = t.id::text \
                       AND e.type IN ('helpdesk.ticket.responded', 'helpdesk.ticket.resolved')) response ON true \
                   LEFT JOIN LATERAL (SELECT max(e.at) AS at FROM osp_events e \
                     WHERE e.tenant_id = t.tenant_id AND e.record_id = t.id::text \
                       AND e.type = 'helpdesk.ticket.resolved') resolution ON true \
                   WHERE t.tenant_id = $1 \
                 ) SELECT jsonb_build_object( \
                   'totalTickets', count(*), \
                   'responseMet', count(*) FILTER (WHERE response_sla = 'met'), \
                   'responsePending', count(*) FILTER (WHERE response_sla = 'pending'), \
                   'responseBreached', count(*) FILTER (WHERE response_sla = 'breached'), \
                   'responseUnassigned', count(*) FILTER (WHERE response_sla = 'unassigned'), \
                   'resolutionMet', count(*) FILTER (WHERE resolution_sla = 'met'), \
                   'resolutionPending', count(*) FILTER (WHERE resolution_sla = 'pending'), \
                   'resolutionBreached', count(*) FILTER (WHERE resolution_sla = 'breached'), \
                   'resolutionUnassigned', count(*) FILTER (WHERE resolution_sla = 'unassigned'), \
                   'tickets', (SELECT COALESCE(jsonb_agg(ticket), '[]'::jsonb) FROM ( \
                     SELECT jsonb_build_object('id', id, 'subject', subject, 'status', status, \
                       'priority', priority, 'createdAt', created_at, 'firstResponseAt', first_response_at, \
                       'responseDueAt', response_due_at, 'resolutionDueAt', resolution_due_at, \
                       'responseSla', response_sla, 'resolutionSla', resolution_sla) AS ticket \
                     FROM ticket_sla ORDER BY created_at DESC, id LIMIT 500 \
                   ) recent) \
                 ) FROM ticket_sla",
                &[&tenant.id],
            )
            .await?;
        Ok(rows
            .drain(..)
            .next()
            .unwrap_or_else(|| json!({ "totalTickets": 0, "tickets": [] })))
    }
}
