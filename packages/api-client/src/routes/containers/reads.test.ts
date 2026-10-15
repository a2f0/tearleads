import { expect, test } from "bun:test";
import {
  containerDocumentLanes,
  containerKekLog,
  containerParentLanes,
} from "./reads";

const emptyPage = {
  hasMore: false,
  items: [],
  nextWatermark: null,
  tombstones: [],
};

test("container read client metadata derives from shared operations", () => {
  expect(containerKekLog.method).toBe("GET");
  expect(
    containerKekLog.path("container/1", {
      afterKeyEpoch: 1,
      keyringForEpoch: 2,
    }),
  ).toBe("/containers/container%2F1/kek-log?keyringForEpoch=2&afterKeyEpoch=1");
  for (const afterKeyEpoch of [-1, 0, 1.5, Number.NaN, 65_537]) {
    expect(() =>
      containerKekLog.path("container-1", { afterKeyEpoch }),
    ).toThrow(TypeError);
  }

  expect(containerDocumentLanes.method).toBe("POST");
  expect(containerDocumentLanes.path).toBe("/containers/documents/query");

  expect(containerParentLanes.method).toBe("POST");
  expect(containerParentLanes.path).toBe("/containers/parent-lanes/query");
});

test("parent-lane responses retain their request-bound lane guard", () => {
  const request = {
    lanes: [{ laneId: "root", parentId: null, watermark: null }],
  };

  expect(
    containerParentLanes.isResponseForRequest(request, {
      results: [{ laneId: "root", page: emptyPage }],
    }),
  ).toBe(true);
  expect(
    containerParentLanes.isResponseForRequest(request, {
      results: [{ laneId: "unexpected", page: emptyPage }],
    }),
  ).toBe(false);
});
