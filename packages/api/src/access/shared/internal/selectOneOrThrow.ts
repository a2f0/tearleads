export async function selectOneOrThrow<Row>(
  query: PromiseLike<readonly Row[]>,
  missingMessage: string,
): Promise<Row> {
  const [row] = await query;
  if (!row) {
    throw new Error(missingMessage);
  }
  return row;
}
