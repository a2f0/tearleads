/** Joins the truthy class names, or `undefined` when there are none. */
export function classNames(
  ...values: Array<string | false | null | undefined>
): string | undefined {
  const result = values.filter((value) => Boolean(value)).join(" ");

  return result.length > 0 ? result : undefined;
}
