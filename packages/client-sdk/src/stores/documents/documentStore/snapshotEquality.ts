import type { DocumentSnapshot } from "../types";

export function shallowEqualRecord<Value>(
  left: Readonly<Record<string, Value>>,
  right: Readonly<Record<string, Value>>,
): boolean {
  let leftKeyCount = 0;
  for (const key in left) {
    if (!Object.hasOwn(left, key)) continue;

    leftKeyCount += 1;
    if (!Object.hasOwn(right, key) || !Object.is(left[key], right[key])) {
      return false;
    }
  }

  let rightKeyCount = 0;
  for (const key in right) {
    if (Object.hasOwn(right, key)) {
      rightKeyCount += 1;
    }
  }

  return leftKeyCount === rightKeyCount;
}

export function sameValidationIssues(
  left: DocumentSnapshot["fieldValidationIssues"],
  right: DocumentSnapshot["fieldValidationIssues"],
): boolean {
  return (
    left.length === right.length &&
    left.every((issue, index) => {
      const nextIssue = right[index];
      return (
        nextIssue !== undefined &&
        issue.field === nextIssue.field &&
        issue.message === nextIssue.message &&
        Object.is(issue.value, nextIssue.value)
      );
    })
  );
}
