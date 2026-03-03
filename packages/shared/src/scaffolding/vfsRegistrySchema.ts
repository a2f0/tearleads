interface DbQueryClient {
  query(
    text: string,
    params?: readonly unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function hasVfsRegistryOrganizationId(
  client: DbQueryClient
): Promise<boolean> {
  const result = await client.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'vfs_registry'
        AND column_name = 'organization_id'
      LIMIT 1`
  );
  return result.rows.length > 0;
}
