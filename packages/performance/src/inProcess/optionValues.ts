/** Maximum seeded tree size accepted by realtime benchmarks (`--mode roots`). */
export const MAX_TREE_SIZE = 10_000;
/**
 * Maximum container ids accepted in a single `--mode all` hub declaration
 * (matches `MAX_WS_INTEREST_CONTAINER_IDS` in `@tearleads/validators/realtime`).
 */
export const MAX_DECLARED_IDS = 256;

/** A decimal integer flag value from `min` to `max`. */
export function integer(
  value: string,
  name: string,
  min: number,
  max: number,
): number {
  if (!/^[1-9]\d*$/.test(value) || Number(value) < min || Number(value) > max)
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return Number(value);
}

/** A comma-separated, strictly ascending list of such integers. */
export function ascendingIntegers(
  value: string,
  name: string,
  min: number,
  max: number,
): number[] {
  const values = value
    .split(",")
    .map((item) => integer(item.trim(), name, min, max));
  if (
    values.some((item, index) => index > 0 && item <= (values[index - 1] ?? 0))
  )
    throw new Error(`${name} must be strictly ascending.`);
  return values;
}
