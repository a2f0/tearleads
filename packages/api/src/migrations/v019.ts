import type { Pool } from 'pg';
import type { Migration } from './types.js';

/**
 * v019: Add organization-scoped billing tables for RevenueCat integration
 *
 * Creates:
 * - organization_billing_accounts: 1:1 billing account metadata per organization
 * - revenuecat_webhook_events: idempotent webhook event log and payload archive
 */
export const v019: Migration = {
  version: 19,
  description: 'Add organization billing and RevenueCat webhook event tables',
  up: async (pool: Pool) => {
    await pool.query('BEGIN');
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS "organization_billing_accounts" (
          "organization_id" TEXT PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
          "revenuecat_app_user_id" TEXT NOT NULL UNIQUE,
          "entitlement_status" TEXT NOT NULL DEFAULT 'inactive' CHECK ("entitlement_status" IN ('inactive', 'trialing', 'active', 'grace_period', 'expired')),
          "active_product_id" TEXT,
          "period_ends_at" TIMESTAMPTZ,
          "will_renew" BOOLEAN,
          "last_webhook_event_id" TEXT,
          "last_webhook_at" TIMESTAMPTZ,
          "created_at" TIMESTAMPTZ NOT NULL,
          "updated_at" TIMESTAMPTZ NOT NULL
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "organization_billing_entitlement_idx"
        ON "organization_billing_accounts" ("entitlement_status")
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "organization_billing_period_end_idx"
        ON "organization_billing_accounts" ("period_ends_at")
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS "revenuecat_webhook_events" (
          "id" TEXT PRIMARY KEY,
          "event_id" TEXT NOT NULL UNIQUE,
          "event_type" TEXT NOT NULL,
          "organization_id" TEXT REFERENCES "organizations"("id") ON DELETE SET NULL,
          "revenuecat_app_user_id" TEXT NOT NULL,
          "payload" JSONB NOT NULL,
          "received_at" TIMESTAMPTZ NOT NULL,
          "processed_at" TIMESTAMPTZ,
          "processing_error" TEXT
        )
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "revenuecat_events_org_idx"
        ON "revenuecat_webhook_events" ("organization_id")
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "revenuecat_events_app_user_idx"
        ON "revenuecat_webhook_events" ("revenuecat_app_user_id")
      `);

      await pool.query(`
        CREATE INDEX IF NOT EXISTS "revenuecat_events_received_idx"
        ON "revenuecat_webhook_events" ("received_at" DESC)
      `);

      await pool.query(`
        INSERT INTO organization_billing_accounts (
          organization_id,
          revenuecat_app_user_id,
          entitlement_status,
          created_at,
          updated_at
        )
        SELECT
          o.id,
          'org:' || o.id,
          'inactive',
          COALESCE(o.created_at, NOW()),
          NOW()
        FROM organizations o
        ON CONFLICT (organization_id) DO NOTHING
      `);

      await pool.query('COMMIT');
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  }
};
