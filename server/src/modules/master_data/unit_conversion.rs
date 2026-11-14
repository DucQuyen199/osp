//! Resolve tenant-owned alternate units for transactional line snapshots.
use crate::{db::Tx, error::R, kernel::Tenant, money};
use rust_decimal::Decimal;
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct UnitSnapshot {
    pub unit_id: Option<Uuid>,
    pub unit_name: Option<String>,
    pub base_unit_id: Option<Uuid>,
    pub ratio: Decimal,
}

impl UnitSnapshot {
    pub fn base_quantity(&self, quantity: Decimal) -> Option<Decimal> {
        quantity.checked_mul(self.ratio)
    }
}

/// Resolve a line unit and prove it converts directly to the product's base unit.
/// `None` selects the product base unit; products without a configured base unit
/// retain their legacy unitless behavior.
pub async fn resolve(
    tx: &Tx<'_>,
    tenant: &Tenant,
    product_id: Uuid,
    selected_unit: Option<Uuid>,
) -> R<Result<UnitSnapshot, String>> {
    let base_unit = tx
        .query_opt(
            "SELECT uom FROM master_data__product WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &product_id],
        )
        .await?
        .and_then(|row| row.get::<_, Option<Uuid>>(0));
    let Some(unit_id) = selected_unit.or(base_unit) else {
        return Ok(Ok(UnitSnapshot {
            unit_id: None,
            unit_name: None,
            base_unit_id: None,
            ratio: Decimal::ONE,
        }));
    };
    let unit = tx
        .query_opt(
            "SELECT name, base_uom, ratio::text FROM master_data__uom WHERE tenant_id = $1 AND id = $2 FOR SHARE",
            &[&tenant.id, &unit_id],
        )
        .await?;
    let Some(unit) = unit else {
        return Ok(Err("Selected unit must belong to this tenant".into()));
    };
    let name: String = unit.get(0);
    let parent: Option<Uuid> = unit.get(1);
    let ratio_text: Option<String> = unit.get(2);
    let Some(base_unit) = base_unit else {
        return Ok(Err(
            "Product needs a base inventory unit before an alternate unit can be used".into(),
        ));
    };
    if unit_id == base_unit {
        if parent.is_some() {
            return Ok(Err("Product inventory unit must be a base unit".into()));
        }
        return Ok(Ok(UnitSnapshot {
            unit_id: Some(unit_id),
            unit_name: Some(name),
            base_unit_id: Some(base_unit),
            ratio: Decimal::ONE,
        }));
    }
    if parent != Some(base_unit) {
        return Ok(Err(
            "Selected unit must convert directly to the product base unit".into(),
        ));
    }
    let Some(ratio) = ratio_text
        .as_deref()
        .and_then(money::decimal_str)
        .filter(|ratio| *ratio > Decimal::ZERO)
    else {
        return Ok(Err("Selected unit has an invalid conversion ratio".into()));
    };
    Ok(Ok(UnitSnapshot {
        unit_id: Some(unit_id),
        unit_name: Some(name),
        base_unit_id: Some(base_unit),
        ratio,
    }))
}
