/** Live placement evidence belongs to one organization; purge pins are terminal. */
export function documentHeadMatchesOrganization(
  head: {
    readonly organizationId: string | null;
    readonly accessEpoch: number;
    readonly accessStateHash?: string | undefined;
  },
  organizationId: string | undefined,
): boolean {
  const terminalPurge =
    head.organizationId === null &&
    !head.accessStateHash &&
    head.accessEpoch === Number.MAX_SAFE_INTEGER;
  return (
    terminalPurge ||
    Boolean(organizationId && head.organizationId === organizationId)
  );
}
