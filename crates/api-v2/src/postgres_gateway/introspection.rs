use tearleads_data_access_postgres::{PostgresColumnRecord, PostgresRowsPageRecord, PostgresTableRecord};
use tearleads_data_access_traits::{BoxFuture, DataAccessError, PostgresRowsQuery};

use super::TokioPostgresGateway;
use super::error::{pool_error, query_error};

impl TokioPostgresGateway {
    pub(super) fn list_tables_impl(
        &self,
    ) -> BoxFuture<'_, Result<Vec<PostgresTableRecord>, DataAccessError>> {
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let rows = client
                .query(
                    "SELECT
                        n.nspname AS schema,
                        c.relname AS name,
                        GREATEST(c.reltuples, 0)::bigint AS row_count,
                        pg_total_relation_size(c.oid) AS total_bytes,
                        pg_relation_size(c.oid) AS table_bytes,
                        pg_indexes_size(c.oid) AS index_bytes
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE c.relkind IN ('r', 'p')
                        AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                    ORDER BY n.nspname, c.relname",
                    &[],
                )
                .await
                .map_err(query_error)?;

            Ok(rows
                .into_iter()
                .map(|row| PostgresTableRecord {
                    schema: row.get("schema"),
                    name: row.get("name"),
                    row_count: row.get("row_count"),
                    total_bytes: row.get("total_bytes"),
                    table_bytes: row.get("table_bytes"),
                    index_bytes: row.get("index_bytes"),
                })
                .collect())
        })
    }

    pub(super) fn table_exists_impl(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        let schema = schema.to_string();
        let table = table.to_string();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let rows = client
                .query(
                    "SELECT EXISTS (
                        SELECT 1 FROM information_schema.tables
                        WHERE table_schema = $1 AND table_name = $2
                    ) AS exists",
                    &[&schema, &table],
                )
                .await
                .map_err(query_error)?;
            Ok(rows.first().map(|r| r.get("exists")).unwrap_or(false))
        })
    }

    pub(super) fn list_columns_impl(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<Vec<PostgresColumnRecord>, DataAccessError>> {
        let schema = schema.to_string();
        let table = table.to_string();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let rows = client
                .query(
                    "SELECT column_name, data_type, is_nullable, column_default, ordinal_position
                     FROM information_schema.columns
                     WHERE table_schema = $1 AND table_name = $2
                     ORDER BY ordinal_position",
                    &[&schema, &table],
                )
                .await
                .map_err(query_error)?;

            Ok(rows
                .into_iter()
                .map(|row| {
                    let nullable_str: String = row.get("is_nullable");
                    let ordinal: i32 = row.get("ordinal_position");
                    PostgresColumnRecord {
                        name: row.get("column_name"),
                        data_type: row.get("data_type"),
                        nullable: nullable_str == "YES",
                        default_value: row.get("column_default"),
                        ordinal_position: ordinal as u32,
                    }
                })
                .collect())
        })
    }

    pub(super) fn list_rows_impl(
        &self,
        query: &PostgresRowsQuery,
    ) -> BoxFuture<'_, Result<PostgresRowsPageRecord, DataAccessError>> {
        let schema = query.schema.clone();
        let table = query.table.clone();
        let limit = query.limit;
        let offset = query.offset;
        let sort_column = query.sort_column.clone();
        let sort_direction = query.sort_direction.clone();
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;

            let valid_columns = client
                .query(
                    "SELECT column_name FROM information_schema.columns
                     WHERE table_schema = $1 AND table_name = $2",
                    &[&schema, &table],
                )
                .await
                .map_err(query_error)?;

            let column_names: Vec<String> =
                valid_columns.iter().map(|r| r.get("column_name")).collect();

            if let Some(ref col) = sort_column {
                if !column_names.iter().any(|c| c == col) {
                    return Err(DataAccessError::new(
                        tearleads_data_access_traits::DataAccessErrorKind::InvalidInput,
                        format!("invalid sort column: {col}"),
                    ));
                }
            }

            let quoted_schema = quote_ident(&schema);
            let quoted_table = quote_ident(&table);

            let count_sql = format!("SELECT COUNT(*) AS count FROM {quoted_schema}.{quoted_table}");
            let count_rows = client.query(&count_sql, &[]).await.map_err(query_error)?;
            let total_count: i64 = count_rows
                .first()
                .map(|r| r.get("count"))
                .unwrap_or(0);

            let order_clause = match (&sort_column, &sort_direction) {
                (Some(col), Some(dir)) => {
                    let quoted_col = quote_ident(col);
                    let dir_upper = dir.to_uppercase();
                    let safe_dir = if dir_upper == "DESC" { "DESC" } else { "ASC" };
                    format!(" ORDER BY {quoted_col} {safe_dir}")
                }
                (Some(col), None) => {
                    let quoted_col = quote_ident(col);
                    format!(" ORDER BY {quoted_col} ASC")
                }
                _ => String::new(),
            };

            let data_sql = format!(
                "SELECT * FROM {quoted_schema}.{quoted_table}{order_clause} LIMIT $1 OFFSET $2"
            );
            let limit_i64 = limit as i64;
            let offset_i64 = offset as i64;
            let data_rows = client
                .query(&data_sql, &[&limit_i64, &offset_i64])
                .await
                .map_err(query_error)?;

            let rows_json: Vec<String> = data_rows
                .iter()
                .map(|row| row_to_json(row, &column_names))
                .collect();

            Ok(PostgresRowsPageRecord {
                rows_json,
                total_count: total_count as u64,
                limit,
                offset,
            })
        })
    }

    pub(super) fn fetch_server_version_impl(
        &self,
    ) -> BoxFuture<'_, Result<Option<String>, DataAccessError>> {
        Box::pin(async move {
            let client = self.pool.get().await.map_err(pool_error)?;
            let rows = client
                .query("SELECT version() AS version", &[])
                .await
                .map_err(query_error)?;
            Ok(rows.first().map(|r| r.get("version")))
        })
    }
}

fn quote_ident(ident: &str) -> String {
    let escaped = ident.replace('"', "\"\"");
    format!("\"{escaped}\"")
}

fn row_to_json(row: &tokio_postgres::Row, column_names: &[String]) -> String {
    let mut map = serde_json::Map::new();
    for col in row.columns() {
        let name = col.name();
        if !column_names.iter().any(|c| c == name) {
            continue;
        }
        let value = column_to_json_value(row, col);
        map.insert(name.to_string(), value);
    }
    serde_json::Value::Object(map).to_string()
}

fn column_to_json_value(
    row: &tokio_postgres::Row,
    col: &tokio_postgres::Column,
) -> serde_json::Value {
    use tokio_postgres::types::Type;

    let idx = col.name();
    match col.type_() {
        &Type::BOOL => match row.try_get::<_, Option<bool>>(idx) {
            Ok(Some(v)) => serde_json::Value::Bool(v),
            _ => serde_json::Value::Null,
        },
        &Type::INT2 => match row.try_get::<_, Option<i16>>(idx) {
            Ok(Some(v)) => serde_json::json!(v),
            _ => serde_json::Value::Null,
        },
        &Type::INT4 => match row.try_get::<_, Option<i32>>(idx) {
            Ok(Some(v)) => serde_json::json!(v),
            _ => serde_json::Value::Null,
        },
        &Type::INT8 => match row.try_get::<_, Option<i64>>(idx) {
            Ok(Some(v)) => serde_json::json!(v),
            _ => serde_json::Value::Null,
        },
        &Type::FLOAT4 => match row.try_get::<_, Option<f32>>(idx) {
            Ok(Some(v)) => serde_json::json!(v),
            _ => serde_json::Value::Null,
        },
        &Type::FLOAT8 => match row.try_get::<_, Option<f64>>(idx) {
            Ok(Some(v)) => serde_json::json!(v),
            _ => serde_json::Value::Null,
        },
        &Type::TIMESTAMPTZ => {
            match row.try_get::<_, Option<chrono::DateTime<chrono::Utc>>>(idx) {
                Ok(Some(v)) => serde_json::Value::String(v.to_rfc3339()),
                _ => serde_json::Value::Null,
            }
        }
        &Type::TIMESTAMP => {
            match row.try_get::<_, Option<chrono::NaiveDateTime>>(idx) {
                Ok(Some(v)) => serde_json::Value::String(v.to_string()),
                _ => serde_json::Value::Null,
            }
        }
        &Type::JSON | &Type::JSONB => match row.try_get::<_, Option<serde_json::Value>>(idx) {
            Ok(Some(v)) => v,
            _ => serde_json::Value::Null,
        },
        _ => match row.try_get::<_, Option<String>>(idx) {
            Ok(Some(v)) => serde_json::Value::String(v),
            _ => serde_json::Value::Null,
        },
    }
}
