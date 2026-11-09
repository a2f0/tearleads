import { expect, test } from "bun:test";
import {
  createContentKeyBundleResponse,
  createSyncResponse,
} from "../operation/openApiTestFixtures";
import { DocumentSyncResponseSchema } from "./documentSyncSchema";

const HISTORICAL_BUNDLE_ISSUE = "content-key bundles must be distinct epochs";

function responseWithBundleEpochs(historicalEpochs: readonly number[]) {
  return {
    ...createSyncResponse(),
    contentKeyBundles: historicalEpochs.map((contentKeyEpoch) => ({
      ...createContentKeyBundleResponse(),
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

test("contentKeyBundles carries distinct epochs", () => {
  expect(issues(responseWithBundleEpochs([]))).toEqual([]);
  expect(issues(responseWithBundleEpochs([1, 2]))).toEqual([]);
  expect(issues(responseWithBundleEpochs([2, 1]))).toEqual([]);
});

test("contentKeyBundles rejects a repeated epoch", () => {
  expect(issues(responseWithBundleEpochs([1, 2, 1]))).toEqual([
    {
      message: HISTORICAL_BUNDLE_ISSUE,
      path: ["contentKeyBundles", 2, "contentKeyEpoch"],
    },
  ]);
});

test("malformed bundle fields fail without reaching the epoch rule", () => {
  const response = createSyncResponse();
  for (const input of [
    { ...response, contentKeyBundles: 5 },
    { ...response, contentKeyBundles: [null] },
  ]) {
    const messages = issues(input).map(({ message }) => message);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages).not.toContain(HISTORICAL_BUNDLE_ISSUE);
  }
});
