use crate::{
    db::Tx,
    error::R,
    kernel::{Actor, Kernel, Opts, Tenant},
    money,
};
use rust_decimal::Decimal;
use serde_json::{Map, Value, json};
use uuid::Uuid;

#[path = "application/counts.rs"]
mod counts;
mod events;
#[path = "application/preparation/mod.rs"]
mod preparation;
#[path = "application/stock_moves.rs"]
mod stock_moves;
mod valuation;

pub use counts::{prepare_stock_count, validate_expiry_writeoff_quality_holds};
pub use events::{handle_source_stock_event, handle_transfer_or_count_event};
pub use preparation::{prepare_stock_move, prepare_tracked_lines};
pub use stock_moves::apply_stock_move;
