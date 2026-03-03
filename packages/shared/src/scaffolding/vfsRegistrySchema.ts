interface DbQueryClient {
  query(
    text: string,
    params?: readonly unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export async function hasVfsRegistryOrganizationId(
  client: DbQueryClient
): Promise<boolean> {
  try {
    await client.query(`SELECT organization_id FROM vfs_registry LIMIT 0`);
    return true;
  } catch {
    return false;
  }
}
