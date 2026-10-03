pub mod api;
pub mod boundary;
pub mod comparison;
pub mod composition;
pub mod error;
pub mod evaluation;
pub mod harmonic;
pub mod harmony;
pub mod harmony_context;
pub mod meter;
pub mod member_transform;
pub mod midi;
pub mod model;
pub mod operations;
pub mod paired_pitch;
pub mod partition;
pub mod performance;
pub mod pitch_relations;
pub mod scene;
mod scene_relations;
pub mod segmental;
pub mod structure;
#[cfg(test)]
mod tests;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn execute_json(input: &str) -> String {
    api::execute_json(input)
}
