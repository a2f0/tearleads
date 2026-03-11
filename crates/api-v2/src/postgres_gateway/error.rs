use tearleads_data_access_traits::{DataAccessError, DataAccessErrorKind};

pub(super) fn pool_error(err: deadpool_postgres::PoolError) -> DataAccessError {
    DataAccessError::new(
        DataAccessErrorKind::Unavailable,
        format!("postgres pool: {err}"),
    )
}

pub(super) fn query_error(err: tokio_postgres::Error) -> DataAccessError {
    DataAccessError::new(
        DataAccessErrorKind::Internal,
        format!("postgres query: {err}"),
    )
}
