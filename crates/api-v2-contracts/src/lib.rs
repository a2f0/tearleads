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
        AdminGetRedisKeysRequest, MlsGetGroupMessagesRequest, VfsGetSyncRequest,
        admin_service_client, mls_service_client, vfs_service_client,
    };

    #[test]
    fn generated_admin_mls_and_vfs_messages_have_expected_fields() {
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

        let vfs = VfsGetSyncRequest {
            cursor: String::from("cursor_2"),
            limit: 100,
            root_id: String::from("root_456"),
        };
        assert_eq!(vfs.cursor, "cursor_2");
        assert_eq!(vfs.limit, 100);
        assert_eq!(vfs.root_id, "root_456");
    }

    #[test]
    fn generated_service_client_modules_are_exposed() {
        let admin_client_type_name =
            std::any::type_name::<admin_service_client::AdminServiceClient<()>>();
        let mls_client_type_name =
            std::any::type_name::<mls_service_client::MlsServiceClient<()>>();
        let vfs_client_type_name =
            std::any::type_name::<vfs_service_client::VfsServiceClient<()>>();

        assert!(admin_client_type_name.contains("AdminServiceClient"));
        assert!(mls_client_type_name.contains("MlsServiceClient"));
        assert!(vfs_client_type_name.contains("VfsServiceClient"));
    }
}
