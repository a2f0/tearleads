export function classNames(
  ...values: Array<string | false | null | undefined>
): string | undefined {
  const result = values.filter(Boolean).join(" ");

  return result || undefined;
}
