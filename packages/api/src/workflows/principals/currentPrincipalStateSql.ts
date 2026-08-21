import { principalStates } from "@symcrypt/api-shared/schema";
import { type SQL, sql } from "drizzle-orm";

export function currentPrincipalStateHashSql(input: {
  readonly principalId: SQL;
  readonly principalType: SQL;
}): SQL {
  return sql`(
    select ${principalStates.stateHash}
    from ${principalStates}
    where ${principalStates.principalType} = ${input.principalType}
      and ${principalStates.principalId} = ${input.principalId}
    order by ${principalStates.version} desc
    limit 1
  )`;
}
