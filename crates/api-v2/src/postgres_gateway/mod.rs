mod billing;
mod error;
pub(crate) mod groups;
mod introspection;
mod organizations;
mod users;

use std::env;

use deadpool_postgres::{Manager, ManagerConfig, Pool, RecyclingMethod};
use tearleads_data_access_postgres::{
    AdminGroupDetailRecord, AdminGroupSummaryRecord, AdminOrganizationRecord,
    AdminOrganizationUserRecord, AdminScopeOrganizationRecord, AdminUserRecord,
    PostgresAdminGateway, PostgresColumnRecord, PostgresRowsPageRecord, PostgresTableRecord,
};
use tearleads_data_access_traits::{
    AdminCreateGroupInput, AdminCreateOrganizationInput, AdminUpdateGroupInput,
    AdminUpdateOrganizationInput, AdminUpdateUserInput, BoxFuture, DataAccessError,
    PostgresConnectionInfo, PostgresRowsQuery,
};

/// Concrete [`PostgresAdminGateway`] backed by `tokio-postgres` + `deadpool`.
#[derive(Clone)]
pub struct TokioPostgresGateway {
    pool: Pool,
    host: Option<String>,
    port: Option<u16>,
    database: Option<String>,
    user: Option<String>,
}

impl TokioPostgresGateway {
    /// Reads Postgres connection config from environment variables and builds
    /// a connection pool.
    ///
    /// When `POSTGRES_HOST` is not set, falls back to dev defaults matching the
    /// v1 API behaviour (`localhost:5432/tearleads_development` with the current
    /// OS user).
    ///
    /// Returns `None` only when the connection pool fails to build.
    pub fn from_env() -> Option<Self> {
        let (host, is_dev_default) = match env::var("POSTGRES_HOST") {
            Ok(h) => (h, false),
            Err(_) => {
                let default_host = if cfg!(target_os = "linux") {
                    "/var/run/postgresql"
                } else {
                    "localhost"
                };
                (default_host.to_string(), true)
            }
        };

        let port_str = env::var("POSTGRES_PORT").unwrap_or_else(|_| "5432".to_string());
        let port: u16 = port_str.parse().unwrap_or(5432);

        let user = env::var("POSTGRES_USER").unwrap_or_else(|_| {
            if is_dev_default {
                env::var("USER")
                    .or_else(|_| env::var("LOGNAME"))
                    .unwrap_or_else(|_| "postgres".to_string())
            } else {
                "postgres".to_string()
            }
        });

        let password = env::var("POSTGRES_PASSWORD").unwrap_or_default();

        let database = env::var("POSTGRES_DATABASE").unwrap_or_else(|_| {
            if is_dev_default {
                "tearleads_development".to_string()
            } else {
                "postgres".to_string()
            }
        });

        if is_dev_default {
            tracing::info!(
                "POSTGRES_HOST not set — using dev defaults ({host}:{port}/{database} as {user})"
            );
        }

        let mut pg_config = tokio_postgres::Config::new();
        pg_config
            .host(&host)
            .port(port)
            .user(&user)
            .password(&password)
            .dbname(&database);

        let mgr = Manager::from_config(
            pg_config,
            tokio_postgres::NoTls,
            ManagerConfig {
                recycling_method: RecyclingMethod::Fast,
            },
        );

        let pool = match Pool::builder(mgr).max_size(8).build() {
            Ok(pool) => pool,
            Err(err) => {
                tracing::error!("failed to build postgres pool: {err}");
                return None;
            }
        };

        Some(Self {
            pool,
            host: Some(host),
            port: Some(port),
            database: Some(database),
            user: Some(user),
        })
    }
}

impl PostgresAdminGateway for TokioPostgresGateway {
    fn connection_info(&self) -> PostgresConnectionInfo {
        PostgresConnectionInfo {
            host: self.host.clone(),
            port: self.port,
            database: self.database.clone(),
            user: self.user.clone(),
        }
    }

    fn fetch_server_version(&self) -> BoxFuture<'_, Result<Option<String>, DataAccessError>> {
        self.fetch_server_version_impl()
    }

    fn list_scope_organizations(
        &self,
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>> {
        self.list_scope_organizations_impl()
    }

    fn list_scope_organizations_by_ids(
        &self,
        organization_ids: &[String],
    ) -> BoxFuture<'_, Result<Vec<AdminScopeOrganizationRecord>, DataAccessError>> {
        self.list_scope_organizations_by_ids_impl(organization_ids)
    }

    fn list_groups(
        &self,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminGroupSummaryRecord>, DataAccessError>> {
        self.list_groups_impl(organization_ids)
    }

    fn get_group(
        &self,
        group_id: &str,
    ) -> BoxFuture<'_, Result<AdminGroupDetailRecord, DataAccessError>> {
        self.get_group_impl(group_id)
    }

    fn create_group(
        &self,
        input: AdminCreateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetailRecord, DataAccessError>> {
        self.create_group_impl(input)
    }

    fn update_group(
        &self,
        group_id: &str,
        input: AdminUpdateGroupInput,
    ) -> BoxFuture<'_, Result<AdminGroupDetailRecord, DataAccessError>> {
        self.update_group_impl(group_id, input)
    }

    fn delete_group(&self, group_id: &str) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        self.delete_group_impl(group_id)
    }

    fn add_group_member(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        self.add_group_member_impl(group_id, user_id)
    }

    fn remove_group_member(
        &self,
        group_id: &str,
        user_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        self.remove_group_member_impl(group_id, user_id)
    }

    fn list_organizations(
        &self,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationRecord>, DataAccessError>> {
        self.list_organizations_impl(organization_ids)
    }

    fn create_organization(
        &self,
        input: AdminCreateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationRecord, DataAccessError>> {
        self.create_organization_impl(input)
    }

    fn update_organization(
        &self,
        organization_id: &str,
        input: AdminUpdateOrganizationInput,
    ) -> BoxFuture<'_, Result<AdminOrganizationRecord, DataAccessError>> {
        self.update_organization_impl(organization_id, input)
    }

    fn delete_organization(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        self.delete_organization_impl(organization_id)
    }

    fn get_organization_users(
        &self,
        organization_id: &str,
    ) -> BoxFuture<'_, Result<Vec<AdminOrganizationUserRecord>, DataAccessError>> {
        self.get_organization_users_impl(organization_id)
    }

    fn list_users(
        &self,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Vec<AdminUserRecord>, DataAccessError>> {
        self.list_users_impl(organization_ids)
    }

    fn get_user(
        &self,
        user_id: &str,
        organization_ids: Option<&[String]>,
    ) -> BoxFuture<'_, Result<Option<AdminUserRecord>, DataAccessError>> {
        self.get_user_impl(user_id, organization_ids)
    }

    fn update_user(
        &self,
        user_id: &str,
        input: AdminUpdateUserInput,
    ) -> BoxFuture<'_, Result<AdminUserRecord, DataAccessError>> {
        self.update_user_impl(user_id, input)
    }

    fn list_tables(&self) -> BoxFuture<'_, Result<Vec<PostgresTableRecord>, DataAccessError>> {
        self.list_tables_impl()
    }

    fn table_exists(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<bool, DataAccessError>> {
        self.table_exists_impl(schema, table)
    }

    fn list_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> BoxFuture<'_, Result<Vec<PostgresColumnRecord>, DataAccessError>> {
        self.list_columns_impl(schema, table)
    }

    fn list_rows(
        &self,
        query: &PostgresRowsQuery,
    ) -> BoxFuture<'_, Result<PostgresRowsPageRecord, DataAccessError>> {
        self.list_rows_impl(query)
    }
}
