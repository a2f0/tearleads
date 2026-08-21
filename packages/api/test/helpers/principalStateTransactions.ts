import type { ApiDatabase } from "@symcrypt/api-shared/postgres";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../src/access/write/principalMemberEnvelopes";

export function replacePrincipalMemberEnvelopesInTestTransaction(
  input: Parameters<
    typeof replaceCurrentPrincipalMemberEnvelopesInTransaction
  >[0],
  database: ApiDatabase,
): ReturnType<typeof replaceCurrentPrincipalMemberEnvelopesInTransaction> {
  return database.transaction((tx) =>
    replaceCurrentPrincipalMemberEnvelopesInTransaction(input, tx),
  );
}
