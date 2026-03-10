//! Shared helpers for v2 admin service handler methods.

use std::collections::{BTreeMap, HashMap};

use prost_types::{ListValue, Struct, Value, value::Kind as ProtobufValueKind};
use serde_json::Value as JsonValue;
use tearleads_api_domain_core::{
    normalize_required_resource_id as normalize_domain_required_resource_id,
    normalize_sort_direction as normalize_domain_sort_direction, normalize_sql_identifier,
};
use tearleads_api_v2_contracts::tearleads::v2::{
    AdminRedisStringList, AdminRedisStringMap, AdminRedisValue, admin_redis_value,
};
use tearleads_data_access_traits::{DataAccessError, DataAccessErrorKind, RedisValue};
use tonic::Status;

use crate::AdminAccessContext;

pub(crate) fn map_redis_value(value: Option<RedisValue>) -> Option<AdminRedisValue> {
    value.map(|value_variant| match value_variant {
        RedisValue::String(string_value) => AdminRedisValue {
            value: Some(admin_redis_value::Value::StringValue(string_value)),
        },
        RedisValue::List(values) => AdminRedisValue {
            value: Some(admin_redis_value::Value::ListValue(AdminRedisStringList {
                values,
            })),
        },
        RedisValue::Map(entries) => AdminRedisValue {
            value: Some(admin_redis_value::Value::MapValue(AdminRedisStringMap {
                entries: entries.into_iter().collect::<HashMap<_, _>>(),
            })),
        },
    })
}

pub(crate) fn map_data_access_error(error: DataAccessError) -> Status {
    match error.kind() {
        DataAccessErrorKind::NotFound => Status::not_found(error.message().to_string()),
        DataAccessErrorKind::PermissionDenied => {
            Status::permission_denied(error.message().to_string())
        }
        DataAccessErrorKind::InvalidInput => Status::invalid_argument(error.message().to_string()),
        DataAccessErrorKind::Unavailable => Status::unavailable("upstream store unavailable"),
        DataAccessErrorKind::Internal => Status::internal("internal data access error"),
    }
}

pub(crate) fn normalize_schema_or_table(
    field: &'static str,
    value: &str,
) -> Result<String, String> {
    normalize_sql_identifier(field, value).map_err(|error| error.message().to_string())
}

pub(crate) fn normalize_redis_key(key: &str) -> Result<String, &'static str> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("key must not be empty");
    }
    Ok(trimmed.to_string())
}

pub(crate) fn normalize_optional_organization_id(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub(crate) fn normalize_required_resource_id(
    field: &'static str,
    value: &str,
) -> Result<String, String> {
    normalize_domain_required_resource_id(field, value)
        .map_err(|error| format!("{} {}", error.field(), error.message()))
}

pub(crate) fn resolve_organization_scope_filter(
    admin_access: &AdminAccessContext,
    requested_organization_id: Option<String>,
) -> Result<Option<Vec<String>>, &'static str> {
    if admin_access.is_root_admin() {
        return Ok(requested_organization_id.map(|organization_id| vec![organization_id]));
    }

    if let Some(organization_id) = requested_organization_id {
        if !admin_access
            .organization_ids()
            .iter()
            .any(|id| id == &organization_id)
        {
            return Err("forbidden organization scope");
        }
        return Ok(Some(vec![organization_id]));
    }

    Ok(Some(admin_access.organization_ids().to_vec()))
}

pub(crate) fn normalize_sort_direction(
    value: Option<String>,
) -> Result<Option<String>, &'static str> {
    normalize_domain_sort_direction(value).map_err(|_| "sort_direction must be \"asc\" or \"desc\"")
}

pub(crate) fn normalize_rows_limit(limit: u32) -> u32 {
    if limit == 0 {
        return 50;
    }
    limit.min(1000)
}

pub(crate) fn parse_row_struct(row_json: &str) -> Result<Struct, String> {
    let parsed_value: JsonValue = serde_json::from_str(row_json).map_err(|error| {
        let mut message = String::from("invalid JSON payload: ");
        message.push_str(&error.to_string());
        message
    })?;

    let JsonValue::Object(object) = parsed_value else {
        return Err(String::from("row payload must decode to an object"));
    };

    let mut fields = BTreeMap::new();
    for (key, value) in object {
        fields.insert(key, json_value_to_protobuf_value(value)?);
    }

    Ok(Struct { fields })
}

fn json_value_to_protobuf_value(value: JsonValue) -> Result<Value, String> {
    let kind = match value {
        JsonValue::Null => ProtobufValueKind::NullValue(0),
        JsonValue::Bool(boolean) => ProtobufValueKind::BoolValue(boolean),
        JsonValue::Number(number) => {
            let mut conversion_error = String::from("number value cannot be represented as f64: ");
            conversion_error.push_str(&number.to_string());
            let as_f64 = number.as_f64().ok_or(conversion_error)?;
            ProtobufValueKind::NumberValue(as_f64)
        }
        JsonValue::String(string_value) => ProtobufValueKind::StringValue(string_value),
        JsonValue::Array(list_values) => {
            let mut values = Vec::with_capacity(list_values.len());
            for list_value in list_values {
                values.push(json_value_to_protobuf_value(list_value)?);
            }
            ProtobufValueKind::ListValue(ListValue { values })
        }
        JsonValue::Object(map_values) => {
            let mut fields = BTreeMap::new();
            for (key, map_value) in map_values {
                fields.insert(key, json_value_to_protobuf_value(map_value)?);
            }
            ProtobufValueKind::StructValue(Struct { fields })
        }
    };

    Ok(Value { kind: Some(kind) })
}
