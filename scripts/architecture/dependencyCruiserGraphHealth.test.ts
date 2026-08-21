import { describe, expect, test } from "bun:test";

import { findDependencyCruiserGraphHealthViolations } from "./dependencyCruiserGraphHealth";

const healthyGraph = {
  modules: [
    {
      dependencies: [
        {
          dependencyTypes: ["npm", "import"],
          matchesDoNotFollow: true,
          module: "@noble/post-quantum/ml-kem.js",
          resolved: "node_modules/@noble/post-quantum/ml-kem.js",
        },
      ],
      source: "packages/crypto/src/encapsulation/generateKeyPair.ts",
    },
    {
      dependencies: [
        {
          dependencyTypes: ["undetermined", "import"],
          module: "@symcrypt/encoding",
          resolved: "packages/encoding/src/index.ts",
        },
      ],
      source: "packages/crypto/src/keying/accessEvent.ts",
    },
    {
      dependencies: [],
      source: "packages/encoding/src/index.ts",
    },
  ],
};

describe("findDependencyCruiserGraphHealthViolations", () => {
  test("rejects an invalid graph result", () => {
    expect(
      findDependencyCruiserGraphHealthViolations(undefined, [
        "packages/crypto/src",
      ]),
    ).toEqual(["dependency-cruiser returned an invalid or empty graph"]);
  });

  test("accepts complete source, npm, and workspace coverage", () => {
    expect(
      findDependencyCruiserGraphHealthViolations(healthyGraph, [
        "packages/crypto/src",
        "packages/encoding/src",
      ]),
    ).toEqual([]);
  });

  test("reports missing package and sentinel edges", () => {
    expect(
      findDependencyCruiserGraphHealthViolations({ modules: [] }, [
        "packages/crypto/src",
      ]),
    ).toEqual([
      "packages/crypto/src: no modules were cruised",
      "packages/crypto/src/encapsulation/generateKeyPair.ts: expected terminal npm edge to @noble/post-quantum/ml-kem.js",
      "packages/crypto/src/keying/accessEvent.ts: expected workspace edge to packages/encoding/src/index.ts",
    ]);
  });

  test("requires npm dependencies to remain terminal graph nodes", () => {
    const nonTerminalGraph = {
      modules: healthyGraph.modules.map((module) =>
        module.source === "packages/crypto/src/encapsulation/generateKeyPair.ts"
          ? {
              ...module,
              dependencies: module.dependencies.map((dependency) => ({
                ...dependency,
                matchesDoNotFollow: false,
              })),
            }
          : module,
      ),
    };

    expect(
      findDependencyCruiserGraphHealthViolations(nonTerminalGraph, [
        "packages/crypto/src",
        "packages/encoding/src",
      ]),
    ).toContain(
      "packages/crypto/src/encapsulation/generateKeyPair.ts: expected terminal npm edge to @noble/post-quantum/ml-kem.js",
    );
  });

  test("rejects client-sdk build output in the source graph", () => {
    const graph = {
      modules: [
        ...healthyGraph.modules,
        {
          dependencies: [],
          source: "packages/client-sdk/dist/index.js",
        },
      ],
    };

    expect(
      findDependencyCruiserGraphHealthViolations(graph, [
        "packages/crypto/src",
        "packages/encoding/src",
      ]),
    ).toContain(
      "packages/client-sdk/dist/index.js: client-sdk imports must resolve to source, not build output",
    );
  });
});
