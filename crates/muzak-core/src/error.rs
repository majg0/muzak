use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct CoreError {
    pub code: String,
    pub message: String,
}
pub type CoreResult<T> = Result<T, CoreError>;
pub fn invalid(message: impl Into<String>) -> CoreError {
    CoreError {
        code: "invalid-input".into(),
        message: message.into(),
    }
}
pub fn budget(message: impl Into<String>) -> CoreError {
    CoreError {
        code: "budget-exceeded".into(),
        message: message.into(),
    }
}
impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
impl std::error::Error for CoreError {}
impl From<serde_json::Error> for CoreError {
    fn from(value: serde_json::Error) -> Self {
        invalid(format!("Invalid request: {value}"))
    }
}
