//! Rust contract crate generated from `proto/tearleads/v2/*`.

/// Generated v2 protobuf messages and tonic client/server modules.
#[allow(missing_docs)]
#[allow(clippy::all)]
pub mod tearleads {
    /// Generated `tearleads.v2` package items.
    #[allow(missing_docs)]
    #[allow(clippy::all)]
    pub mod v2 {
        tonic::include_proto!("tearleads.v2");
    }
}

#[cfg(test)]
mod tests {
    use super::tearleads::v2::{
        AdminGetRedisKeysRequest, MlsGetGroupMessagesRequest, admin_service_client,
        mls_service_client,
    };

    #[test]
    fn generated_admin_and_mls_messages_have_expected_fields() {
        let admin = AdminGetRedisKeysRequest {
            cursor: String::from("0"),
            limit: 50,
        };
        assert_eq!(admin.cursor, "0");
        assert_eq!(admin.limit, 50);

        let mls = MlsGetGroupMessagesRequest {
            group_id: String::from("group_123"),
            cursor: String::from("cursor_1"),
            limit: 25,
        };
        assert_eq!(mls.group_id, "group_123");
        assert_eq!(mls.limit, 25);
    }

    #[test]
    fn generated_service_clients_are_exposed() {
        let _admin_client_ctor =
            admin_service_client::AdminServiceClient::<tonic::transport::Channel>::new;
        let _mls_client_ctor =
            mls_service_client::MlsServiceClient::<tonic::transport::Channel>::new;
    }
}
