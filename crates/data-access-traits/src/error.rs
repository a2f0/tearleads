//! Error primitives shared by repository trait boundaries.

use std::{error::Error, fmt};

/// Categorizes data-access failures for transport/domain mapping.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DataAccessErrorKind {
    /// The requested entity does not exist.
    NotFound,
    /// The caller has insufficient permissions.
    PermissionDenied,
    /// Input failed validation before query execution.
    InvalidInput,
    /// The backing store is temporarily unavailable.
    Unavailable,
    /// Any unexpected internal data-access failure.
    Internal,
}

/// Concrete error value exchanged at repository boundaries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataAccessError {
    kind: DataAccessErrorKind,
    message: String,
}

impl DataAccessError {
    /// Builds a new data-access error from a category and message.
    pub fn new(kind: DataAccessErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    /// Returns the error category.
    pub fn kind(&self) -> DataAccessErrorKind {
        self.kind
    }

    /// Returns the contextual error message.
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for DataAccessError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let prefix = match self.kind {
            DataAccessErrorKind::NotFound => "not_found",
            DataAccessErrorKind::PermissionDenied => "permission_denied",
            DataAccessErrorKind::InvalidInput => "invalid_input",
            DataAccessErrorKind::Unavailable => "unavailable",
            DataAccessErrorKind::Internal => "internal",
        };
        write!(f, "{prefix}: {}", self.message)
    }
}

impl Error for DataAccessError {}

#[cfg(test)]
mod tests {
    use super::{DataAccessError, DataAccessErrorKind};

    #[test]
    fn display_includes_kind_prefix_and_message() {
        let error = DataAccessError::new(DataAccessErrorKind::Unavailable, "redis timeout");

        assert_eq!(error.to_string(), "unavailable: redis timeout");
        assert_eq!(error.kind(), DataAccessErrorKind::Unavailable);
        assert_eq!(error.message(), "redis timeout");
    }
}
