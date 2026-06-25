export async function selectIds<T>(
  rows: Promise<Array<{ id: T }>>,
): Promise<T[]> {
  return (await rows).map((row) => row.id);
}
