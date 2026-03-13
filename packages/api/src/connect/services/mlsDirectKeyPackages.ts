import { randomUUID } from 'node:crypto';
import { Code, ConnectError } from '@connectrpc/connect';
import type {
  MlsBinaryKeyPackage,
  MlsBinaryKeyPackagesResponse,
  UploadMlsKeyPackagesBinaryRequest,
  UploadMlsKeyPackagesBinaryResponse
} from './mlsBinaryTypes.js';
import { getPool, getPostgresPool } from '../../lib/postgres.js';
import { requireMlsClaims } from './mlsDirectAuth.js';
import { decodeBase64ToBytes, encodeBytesToBase64 } from './mlsBinaryCodec.js';
import { toSafeCipherSuite } from './mlsDirectShared.js';

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

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return value;
}

const MAX_KEY_PACKAGES_PER_UPLOAD = 100;

function isValidUploadPayload(
  request: UploadMlsKeyPackagesBinaryRequest
): boolean {
  const { keyPackages } = request;
  if (keyPackages.length === 0 || keyPackages.length > MAX_KEY_PACKAGES_PER_UPLOAD) {
    return false;
  }

  for (const keyPackage of keyPackages) {
    if (
      keyPackage.keyPackageData.byteLength === 0 ||
      keyPackage.keyPackageRef.trim().length === 0
    ) {
      return false;
    }
  }

  return true;
}

function decodeStoredKeyPackage(
  value: string,
  fieldName: string
): Uint8Array {
  const decoded = decodeBase64ToBytes(value);
  if (!decoded) {
    throw new ConnectError(`${fieldName} is not valid base64`, Code.Internal);
  }
  return decoded;
}

export async function uploadKeyPackagesDirectTyped(
  request: UploadMlsKeyPackagesBinaryRequest,
  context: { requestHeader: Headers }
): Promise<UploadMlsKeyPackagesBinaryResponse> {
  const claims = await requireMlsClaims(
    '/mls/key-packages',
    context.requestHeader
  );
  if (!isValidUploadPayload(request)) {
    throw new ConnectError(
      'Invalid key packages payload',
      Code.InvalidArgument
    );
  }

  try {
    const pool = await getPostgresPool();
    const ids = request.keyPackages.map(() => randomUUID());
    const keyPackageData = request.keyPackages.map((keyPackage) =>
      encodeBytesToBase64(keyPackage.keyPackageData)
    );
    const keyPackageRef = request.keyPackages.map(
      (keyPackage) => keyPackage.keyPackageRef
    );
    const cipherSuites = request.keyPackages.map(
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

    const uploadedPackages: MlsBinaryKeyPackage[] = result.rows.map((row) => ({
      id: row.id,
      userId: claims.sub,
      keyPackageData: decodeStoredKeyPackage(
        row.key_package_data,
        'key_package_data'
      ),
      keyPackageRef: row.key_package_ref,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: toIsoString(row.created_at),
      consumed: false
    }));

    return { keyPackages: uploadedPackages };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to upload key packages:', error);
    throw new ConnectError('Failed to upload key packages', Code.Internal);
  }
}

export async function getMyKeyPackagesDirectTyped(
  _request: object,
  context: { requestHeader: Headers }
): Promise<MlsBinaryKeyPackagesResponse> {
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

    const keyPackages: MlsBinaryKeyPackage[] = result.rows.map((row) => ({
      id: row.id,
      userId: claims.sub,
      keyPackageData: decodeStoredKeyPackage(
        row.key_package_data,
        'key_package_data'
      ),
      keyPackageRef: row.key_package_ref,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: toIsoString(row.created_at),
      consumed: row.consumed_at !== null
    }));

    return { keyPackages };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to get key packages:', error);
    throw new ConnectError('Failed to get key packages', Code.Internal);
  }
}

export async function getUserKeyPackagesDirectTyped(
  request: UserIdRequest,
  context: { requestHeader: Headers }
): Promise<MlsBinaryKeyPackagesResponse> {
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

    const keyPackages: MlsBinaryKeyPackage[] = result.rows.map((row) => ({
      id: row.id,
      userId: request.userId,
      keyPackageData: decodeStoredKeyPackage(
        row.key_package_data,
        'key_package_data'
      ),
      keyPackageRef: row.key_package_ref,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: toIsoString(row.created_at),
      consumed: false
    }));

    return { keyPackages };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to get key packages:', error);
    throw new ConnectError('Failed to get key packages', Code.Internal);
  }
}

export async function deleteKeyPackageDirectTyped(
  request: MlsIdRequest,
  context: { requestHeader: Headers }
): Promise<Record<string, never>> {
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

    return {};
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Failed to delete key package:', error);
    throw new ConnectError('Failed to delete key package', Code.Internal);
  }
}
