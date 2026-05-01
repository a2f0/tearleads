import type { IConfiguration } from "dependency-cruiser";

const dependencyCruiserConfig = {
  forbidden: [
    {
      name: "access-shared-internal-is-layer-neutral",
      severity: "error",
      comment:
        "Access shared internals are consumed by read and write APIs, so they must not depend back on either side.",
      from: {
        path: "^packages/api/src/access/shared/internal/",
      },
      to: {
        path: "^packages/api/src/access/(read|write)/",
      },
    },
    {
      name: "access-read-internal-does-not-depend-on-write",
      severity: "error",
      comment:
        "Read internals must not depend on write APIs or write internals.",
      from: {
        path: "^packages/api/src/access/read/internal/",
      },
      to: {
        path: "^packages/api/src/access/write/",
      },
    },
  ],
  options: {
    includeOnly: "^packages/api/src/access/",
  },
} satisfies IConfiguration;

export default dependencyCruiserConfig;
