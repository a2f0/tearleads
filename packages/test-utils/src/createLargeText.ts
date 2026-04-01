export function createLargeText(targetLength: number): string {
  const seed = Array.from({ length: 95 }, (_, index) =>
    String.fromCharCode(32 + index),
  ).join("");

  return seed
    .repeat(Math.ceil(targetLength / seed.length))
    .slice(0, targetLength);
}
