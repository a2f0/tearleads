import { createTestExecSql } from "@tearleads/test-utils";

export async function withTestExecSql<T>(
  name: string,
  operation: (
    execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  ) => Promise<T>,
): Promise<T> {
  const { close, execSql } = await createTestExecSql(name);
  try {
    return await operation(execSql);
  } finally {
    close();
  }
}
