import type { IConfiguration } from "dependency-cruiser";
import { packageSourceRoot, testFilePattern } from "./dependencySourceRoots";

const appSourceRoot = packageSourceRoot.app;

export const appDependencyRules = [
  {
    name: "app-window-core-is-app-agnostic",
    severity: "error",
    comment:
      "The window core (components/window/) owns window state, chrome, and geometry, and knows nothing about apps. It may import only itself, components/shared/, and utils/. App behavior such as mini-app routes and the mini-app error boundary reaches a window through slots like Window's ContentBoundary (filled by mini-apps/MiniAppWindow.tsx).",
    from: {
      path: `${appSourceRoot}components/window/`,
      pathNot: testFilePattern.source,
    },
    to: {
      path: "^packages/",
      pathNot: [
        `${appSourceRoot}components/window/`,
        `${appSourceRoot}components/shared/`,
        `${appSourceRoot}utils/`,
      ],
    },
  },
  {
    name: "app-document-types-do-not-import-mini-apps",
    severity: "error",
    comment:
      "Document types are shared building blocks for mini-apps; mini-apps should import from document-types, not the reverse. Lift shared UI down into document-types/ and have the mini-app consume it.",
    from: {
      path: `${appSourceRoot}document-types/`,
      pathNot: testFilePattern.source,
    },
    to: {
      path: `${appSourceRoot}mini-apps/`,
    },
  },
  {
    name: "app-mini-apps-do-not-cross-import",
    severity: "error",
    comment:
      "A mini-app must not reach into another mini-app's internals. Lift the shared building block into mini-apps/shared/ or hand data across the mini-app bus. The `$1` back-reference allows same-app and mini-apps/shared/ imports; shared/ may only import shared/, never a product mini-app.",
    from: {
      path: `${appSourceRoot}mini-apps/([^/]+)/`,
      pathNot: testFilePattern.source,
    },
    to: {
      path: `${appSourceRoot}mini-apps/[^/]+/`,
      pathNot: [
        `${appSourceRoot}mini-apps/$1/`,
        `${appSourceRoot}mini-apps/shared/`,
      ],
    },
  },
] satisfies NonNullable<IConfiguration["forbidden"]>;
