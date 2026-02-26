import type { Pool as PgPool } from 'pg';

let poolOverride: PgPool | null = null;

export function setPoolOverrideForTesting(override: PgPool | null): void {
  poolOverride = override;
}

export function getPoolOverride(): PgPool | null {
  return poolOverride;
}
