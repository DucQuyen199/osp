//! Fixed-asset application facade. Each workflow lives in a focused use case.
mod assets;
mod depreciation;
mod events;
mod shared;

pub use assets::prepare_asset_document;
pub use depreciation::prepare_depreciation;
pub use events::handle_source_event;
