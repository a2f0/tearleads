export const ORGANIZATION_PURGE_BATCH_SIZE = 500;

export function organizationPurgeBatches<T>(
  values: readonly T[],
): readonly (readonly T[])[] {
  const batches: T[][] = [];
  for (
    let offset = 0;
    offset < values.length;
    offset += ORGANIZATION_PURGE_BATCH_SIZE
  ) {
    batches.push(values.slice(offset, offset + ORGANIZATION_PURGE_BATCH_SIZE));
  }
  return batches;
}
