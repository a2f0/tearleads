import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  MlsKeyPackage,
  MlsKeyPackagesResponse,
  UploadMlsKeyPackagesResponse
} from '@tearleads/shared';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import {
  parseUploadKeyPackagesPayload,
  toSafeCipherSuite
} from '../../routes/mls/shared.js';
import { requireMlsClaims } from './mlsDirectAuth.js';

type UserIdRequest = { userId: string };
type MlsIdRequest = { id: string };
type UploadInsertRow = {
  id: string;
  key_package_data: string;
  key_package_ref: string;
  cipher_suite: number;
  created_at: Date | string;
};

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function parseJsonBody(json: string): unknown {
  const normalized = json.trim().length > 0 ? json : '{}';
  try {
    return JSON.parse(normalized);
  } catch {
    throw new ConnectError('Invalid JSON body', Code.InvalidArgument);
  }
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

export async function uploadKeyPackagesDirect(
  request: { json: string },
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireMlsClaims(
    '/mls/key-packages',
    context.requestHeader
  );
  const payload = parseUploadKeyPackagesPayload(parseJsonBody(request.json));
  if (!payload) {
    throw new ConnectError(
      'Invalid key packages payload',
      Code.InvalidArgument
    );
  }

  try {
    const pool = await getPostgresPool();
    const ids = payload.keyPackages.map(() => randomUUID());
    const keyPackageData = payload.keyPackages.map(
      (keyPackage) => keyPackage.keyPackageData
    );
    const keyPackageRef = payload.keyPackages.map(
      (keyPackage) => keyPackage.keyPackageRef
    );
    const cipherSuites = payload.keyPackages.map(
      (keyPackage) => keyPackage.cipherSuite
    );

    const result = await pool.query<UploadInsertRow>(
      `WITH payload AS (
         SELECT *
           FROM unnest(
             $1::uuid[],
             $2::text[],
             $3::text[],
             $4::integer[]
           ) AS t(id, key_package_data, key_package_ref, cipher_suite)
       )
       INSERT INTO mls_key_packages (
         id,
         user_id,
         key_package_data,
         key_package_ref,
         cipher_suite,
         created_at
       )
       SELECT
         payload.id,
         $5,
         payload.key_package_data,
         payload.key_package_ref,
         payload.cipher_suite,
         NOW()
       FROM payload
       ON CONFLICT (key_package_ref) DO NOTHING
       RETURNING id, key_package_data, key_package_ref, cipher_suite, created_at`,
      [ids, keyPackageData, keyPackageRef, cipherSuites, claims.sub]
    );

    const uploadedPackages: MlsKeyPackage[] = result.rows.map((row) => ({
      id: row.id,
      userId: claims.sub,
      keyPackageData: row.key_package_data,
      keyPackageRef: row.key_package_ref,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: toIsoString(row.created_at),
      consumed: false
    }));

    const response: UploadMlsKeyPackagesResponse = {
      keyPackages: uploadedPackages
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to upload key packages:', error);
    throw new ConnectError('Failed to upload key packages', Code.Internal);
  }
}

export async function getMyKeyPackagesDirect(
  _request: object,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireMlsClaims(
    '/mls/key-packages/me',
    context.requestHeader
  );

  try {
    const pool = await getPool('read');
    const result = await pool.query<{
      id: string;
      key_package_data: string;
      key_package_ref: string;
      cipher_suite: number;
      created_at: Date | string;
      consumed_at: Date | string | null;
    }>(
      `SELECT id, key_package_data, key_package_ref, cipher_suite, created_at, consumed_at
       FROM mls_key_packages
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [claims.sub]
    );

    const keyPackages: MlsKeyPackage[] = result.rows.map((row) => ({
      id: row.id,
      userId: claims.sub,
      keyPackageData: row.key_package_data,
      keyPackageRef: row.key_package_ref,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: toIsoString(row.created_at),
      consumed: row.consumed_at !== null
    }));

    const response: MlsKeyPackagesResponse = { keyPackages };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to get key packages:', error);
    throw new ConnectError('Failed to get key packages', Code.Internal);
  }
}

export async function getUserKeyPackagesDirect(
  request: UserIdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireMlsClaims(
    `/mls/key-packages/${encoded(request.userId)}`,
    context.requestHeader
  );

  try {
    const pool = await getPool('read');
    const sharedOrganizationResult = await pool.query(
      `SELECT 1
         FROM user_organizations requestor_uo
         INNER JOIN user_organizations target_uo
           ON target_uo.organization_id = requestor_uo.organization_id
        WHERE requestor_uo.user_id = $1
          AND target_uo.user_id = $2
        LIMIT 1`,
      [claims.sub, request.userId]
    );

    if (sharedOrganizationResult.rows.length === 0) {
      throw new ConnectError('User not found', Code.NotFound);
    }

    const result = await pool.query<{
      id: string;
      key_package_data: string;
      key_package_ref: string;
      cipher_suite: number;
      created_at: Date | string;
    }>(
      `SELECT id, key_package_data, key_package_ref, cipher_suite, created_at
       FROM mls_key_packages
       WHERE user_id = $1 AND consumed_at IS NULL
       ORDER BY created_at ASC
       LIMIT 10`,
      [request.userId]
    );

    const keyPackages: MlsKeyPackage[] = result.rows.map((row) => ({
      id: row.id,
      userId: request.userId,
      keyPackageData: row.key_package_data,
      keyPackageRef: row.key_package_ref,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: toIsoString(row.created_at),
      consumed: false
    }));

    const response: MlsKeyPackagesResponse = { keyPackages };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to get key packages:', error);
    throw new ConnectError('Failed to get key packages', Code.Internal);
  }
}

export async function deleteKeyPackageDirect(
  request: MlsIdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const claims = await requireMlsClaims(
    `/mls/key-packages/${encoded(request.id)}`,
    context.requestHeader
  );

  try {
    const pool = await getPostgresPool();
    const result = await pool.query(
      `DELETE FROM mls_key_packages
       WHERE id = $1 AND user_id = $2 AND consumed_at IS NULL`,
      [request.id, claims.sub]
    );

    if (result.rowCount === 0) {
      throw new ConnectError(
        'Key package not found or already consumed',
        Code.NotFound
      );
    }

    return { json: '{}' };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to delete key package:', error);
    throw new ConnectError('Failed to delete key package', Code.Internal);
  }
}
