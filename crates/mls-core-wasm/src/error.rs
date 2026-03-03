use core::fmt::{Display, Formatter};

/// MLS primitive operation error.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MlsError {
    /// Input payload failed validation.
    InvalidInput(String),
    /// State payload is malformed.
    InvalidState(String),
    /// Required group member or secret was not found.
    NotFound(String),
    /// Cryptographic verification or operation failed.
    Crypto(String),
    /// Serialization or deserialization failed.
    Serialization(String),
}

impl Display for MlsError {
    fn fmt(&self, f: &mut Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::InvalidInput(message)
            | Self::InvalidState(message)
            | Self::NotFound(message)
            | Self::Crypto(message)
            | Self::Serialization(message) => f.write_str(message),
        }
    }
}

impl From<serde_json::Error> for MlsError {
    fn from(error: serde_json::Error) -> Self {
        Self::Serialization(format!("JSON serialization error: {error}"))
    }
}
