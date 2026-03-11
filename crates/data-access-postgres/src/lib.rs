//! Native Postgres adapter implementations for API v2 data-access traits.

mod admin_adapter;
mod gateway;

pub use admin_adapter::PostgresAdminAdapter;
pub use gateway::{
    AdminGroupDetailRecord, AdminGroupMemberRecord, AdminGroupSummaryRecord,
    AdminOrganizationRecord, AdminOrganizationUserRecord, AdminScopeOrganizationRecord,
    AdminUserAccountingRecord, AdminUserRecord, PostgresAdminGateway, PostgresColumnRecord,
    PostgresRowsPageRecord, PostgresTableRecord,
};
