import { expect, test } from "bun:test";
import { createSyncResponse } from "../operation/openApiTestFixtures";
import { DocumentSyncResponseSchema } from "./documentSyncSchema";

const HISTORICAL_BUNDLE_ISSUE =
  "content-key bundles must be distinct epochs older than contentKeyBundle";

function responseWithBundleEpochs(
  currentEpoch: number,
  historicalEpochs: readonly number[],
) {
  const response = createSyncResponse();
  return {
    ...response,
    contentKeyBundle: {
      ...response.contentKeyBundle,
      contentKeyEpoch: currentEpoch,
    },
    contentKeyBundles: historicalEpochs.map((contentKeyEpoch) => ({
      ...response.contentKeyBundle,
      contentKeyEpoch,
    })),
  };
}

function issues(input: unknown) {
  const result = DocumentSyncResponseSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map(({ message, path }) => ({ message, path }));
}

test("contentKeyBundles carries distinct epochs older than the current bundle", () => {
  expect(issues(responseWithBundleEpochs(3, []))).toEqual([]);
  expect(issues(responseWithBundleEpochs(3, [1, 2]))).toEqual([]);
  expect(issues(responseWithBundleEpochs(3, [2, 1]))).toEqual([]);
});

test("contentKeyBundles rejects a repeat of the current epoch's bundle", () => {
  expect(issues(responseWithBundleEpochs(3, [1, 3]))).toEqual([
    {
      message: HISTORICAL_BUNDLE_ISSUE,
      path: ["contentKeyBundles", 1, "contentKeyEpoch"],
    },
  ]);
});

test("contentKeyBundles rejects a repeated historical epoch", () => {
  expect(issues(responseWithBundleEpochs(3, [1, 2, 1]))).toEqual([
    {
      message: HISTORICAL_BUNDLE_ISSUE,
      path: ["contentKeyBundles", 2, "contentKeyEpoch"],
    },
  ]);
});

test("contentKeyBundles rejects an epoch newer than the current bundle", () => {
  expect(issues(responseWithBundleEpochs(3, [4]))).toEqual([
    {
      message: HISTORICAL_BUNDLE_ISSUE,
      path: ["contentKeyBundles", 0, "contentKeyEpoch"],
    },
  ]);
});

test("malformed bundle fields fail without reaching the epoch rule", () => {
  const response = createSyncResponse();
  for (const input of [
    { ...response, contentKeyBundle: undefined },
    { ...response, contentKeyBundles: 5 },
    { ...response, contentKeyBundles: [null] },
  ]) {
    const messages = issues(input).map(({ message }) => message);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages).not.toContain(HISTORICAL_BUNDLE_ISSUE);
  }
});
