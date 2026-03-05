//! Native Postgres adapter implementations for API v2 data-access traits.

mod admin_read_adapter;
mod gateway;

pub use admin_read_adapter::PostgresAdminReadAdapter;
pub use gateway::{
    AdminGroupDetailRecord, AdminGroupMemberRecord, AdminGroupSummaryRecord,
    AdminOrganizationRecord, AdminScopeOrganizationRecord, AdminUserAccountingRecord,
    AdminUserRecord, PostgresAdminGateway, PostgresColumnRecord, PostgresRowsPageRecord,
    PostgresTableRecord,
};
