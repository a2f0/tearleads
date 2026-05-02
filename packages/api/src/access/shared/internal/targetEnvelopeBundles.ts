export function targetEnvelopeBundlesEqual<T>(
  left: readonly T[],
  right: readonly T[],
  sort: (targets: readonly T[]) => readonly T[],
  equals: (left: T, right: T) => boolean,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const sortedLeft = sort(left);
  const sortedRight = sort(right);

  return sortedLeft.every((leftTarget, index) => {
    const rightTarget = sortedRight[index];
    return rightTarget !== undefined && equals(leftTarget, rightTarget);
  });
}
