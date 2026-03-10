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
        AdminGetRedisKeysRequest, AuthServiceLoginRequest, ChatServicePostCompletionsRequest,
        GetOrganizationBillingRequest, HandleWebhookRequest, MlsGetGroupMessagesRequest,
        SubscribeRequest, VfsGetSyncRequest, VfsSharesGetItemSharesRequest, admin_service_client,
        auth_service_client, billing_service_client, chat_service_client, mls_service_client,
        notification_service_client, revenuecat_service_client, vfs_service_client,
        vfs_shares_service_client,
    };

    #[test]
    fn generated_contract_messages_have_expected_fields() {
        let admin = AdminGetRedisKeysRequest {
            cursor: String::from("0"),
            limit: 50,
        };
        assert_eq!(admin.cursor, "0");
        assert_eq!(admin.limit, 50);

        let auth = AuthServiceLoginRequest {
            email: String::from("user@example.com"),
            password: String::from("password"),
        };
        assert_eq!(auth.email, "user@example.com");

        let billing = GetOrganizationBillingRequest {
            organization_id: String::from("org_123"),
        };
        assert_eq!(billing.organization_id, "org_123");

        let chat = ChatServicePostCompletionsRequest {
            json: String::from("{\"prompt\":\"hello\"}"),
        };
        assert_eq!(chat.json, "{\"prompt\":\"hello\"}");

        let mls = MlsGetGroupMessagesRequest {
            group_id: String::from("group_123"),
            cursor: String::from("cursor_1"),
            limit: 25,
        };
        assert_eq!(mls.group_id, "group_123");
        assert_eq!(mls.limit, 25);

        let notification = SubscribeRequest {
            channels: vec![String::from("updates")],
        };
        assert_eq!(notification.channels, vec![String::from("updates")]);

        let webhook = HandleWebhookRequest {
            json: String::from("{\"event\": \"test\"}"),
            signature: String::from("sig"),
        };
        assert_eq!(webhook.signature, "sig");

        let vfs = VfsGetSyncRequest {
            cursor: String::from("cursor_2"),
            limit: 100,
            root_id: String::from("root_456"),
        };
        assert_eq!(vfs.cursor, "cursor_2");
        assert_eq!(vfs.limit, 100);
        assert_eq!(vfs.root_id, "root_456");

        let shares = VfsSharesGetItemSharesRequest {
            item_id: String::from("item_1"),
        };
        assert_eq!(shares.item_id, "item_1");
    }

    #[test]
    fn generated_service_client_modules_are_exposed() {
        let admin_client_type_name =
            std::any::type_name::<admin_service_client::AdminServiceClient<()>>();
        let auth_client_type_name =
            std::any::type_name::<auth_service_client::AuthServiceClient<()>>();
        let billing_client_type_name =
            std::any::type_name::<billing_service_client::BillingServiceClient<()>>();
        let chat_client_type_name =
            std::any::type_name::<chat_service_client::ChatServiceClient<()>>();
        let mls_client_type_name =
            std::any::type_name::<mls_service_client::MlsServiceClient<()>>();
        let notification_client_type_name =
            std::any::type_name::<notification_service_client::NotificationServiceClient<()>>();
        let revenuecat_client_type_name =
            std::any::type_name::<revenuecat_service_client::RevenuecatServiceClient<()>>();
        let vfs_client_type_name =
            std::any::type_name::<vfs_service_client::VfsServiceClient<()>>();
        let vfs_shares_client_type_name =
            std::any::type_name::<vfs_shares_service_client::VfsSharesServiceClient<()>>();

        let expectations = [
            (admin_client_type_name, "AdminServiceClient"),
            (auth_client_type_name, "AuthServiceClient"),
            (billing_client_type_name, "BillingServiceClient"),
            (chat_client_type_name, "ChatServiceClient"),
            (mls_client_type_name, "MlsServiceClient"),
            (notification_client_type_name, "NotificationServiceClient"),
            (revenuecat_client_type_name, "RevenuecatServiceClient"),
            (vfs_client_type_name, "VfsServiceClient"),
            (vfs_shares_client_type_name, "VfsSharesServiceClient"),
        ];

        for (type_name, expected) in expectations {
            assert!(type_name.contains(expected));
        }
    }
}
