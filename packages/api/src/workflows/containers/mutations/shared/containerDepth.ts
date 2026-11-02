import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { containers } from "@tearleads/api-shared/schema";
import { MAX_CONTAINER_PATH_LENGTH } from "@tearleads/validators/util";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { intExpression, uuidValue } from "../../../../utils/sqlDialect";
import { ContainerMutationError, containerPathTooDeep } from "../errors";

const subtreeHeightRowSchema = z.object({
  height: z
    .number()
    .refine((height) => Number.isSafeInteger(height) && height >= 0),
});

export function assertContainerDepth(depth: number): void {
  if (
    !Number.isSafeInteger(depth) ||
    depth < 0 ||
    depth >= MAX_CONTAINER_PATH_LENGTH
  )
    throw containerPathTooDeep();
}

/** Called inside the organization-locked mutation transaction, before any move. */
export async function assertContainerMoveDepth(
  executor: DatabaseTransaction,
  containerId: string,
  destinationDepth: number,
): Promise<void> {
  assertContainerDepth(destinationDepth + 1);
  const result = await executor.execute(sql`
    with recursive subtree as (
      select ${containers.id} as id, ${intExpression(sql`0`)} as height
      from ${containers}
      where ${containers.id} = ${uuidValue(containerId)}
      union all
      select child.id, subtree.height + 1
      from ${containers} child
      inner join subtree on child.parent_id = subtree.id
      where subtree.height < ${MAX_CONTAINER_PATH_LENGTH}
    )
    select max(height) as height from subtree
  `);
  const row = subtreeHeightRowSchema.safeParse(result.rows[0]);
  if (!row.success)
    throw new ContainerMutationError(
      "Container subtree depth is unavailable",
      409,
    );
  assertContainerDepth(destinationDepth + 1 + row.data.height);
}
