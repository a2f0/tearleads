mod delete_tuple;
mod read_tuple;
mod write_tuple;

pub use delete_tuple::delete_tuple;
pub use read_tuple::read_tuple;
pub use write_tuple::write_tuple;

use axum::http::StatusCode;
use protocol::Namespace;

fn parse_namespace(s: &str) -> Result<Namespace, (StatusCode, String)> {
    s.parse::<Namespace>()
        .map_err(|e| (StatusCode::BAD_REQUEST, e))
}
