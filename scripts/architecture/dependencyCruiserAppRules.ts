import type { IConfiguration } from "dependency-cruiser";
import { packageSourceRoot, testFilePattern } from "./dependencySourceRoots";

const appSourceRoot = packageSourceRoot.app;

export const appDependencyRules = [
  {
    name: "app-shared-components-stay-below-the-shell",
    severity: "error",
    comment:
      "components/ is reusable presentation that the shells (shell/layout, shell/pane) compose. A component that needs something from a shell takes it through a context the shell provides, like components/mini-app/overlays/RoutedPaneOverlayHost.tsx.",
    from: {
      path: `${appSourceRoot}components/`,
      pathNot: testFilePattern.source,
    },
    to: {
      path: `${appSourceRoot}shell/`,
    },
  },
  {
    name: "app-shared-components-load-no-mini-app",
    severity: "error",
    comment:
      "components/ sits below the mini-apps and may use only the platform's types (mini-apps/types.ts). Anything that names or loads a specific mini-app belongs in the shell or the app itself.",
    from: {
      path: `${appSourceRoot}components/`,
      pathNot: testFilePattern.source,
    },
    to: {
      path: `${appSourceRoot}mini-apps/`,
      pathNot: `${appSourceRoot}mini-apps/types\\.ts$`,
    },
  },
  {
    name: "app-mini-app-catalog-imports-no-mini-app",
    severity: "error",
    comment:
      "mini-apps/catalog.ts holds titles, icons, and menu order so chrome that only labels or lists apps does not load them. It may import an app's icon module, never its implementation; components belong in mini-apps/registry.ts.",
    from: {
      path: `${appSourceRoot}mini-apps/catalog\\.ts$`,
    },
    to: {
      path: `${appSourceRoot}mini-apps/[^/]+/`,
      pathNot: `${appSourceRoot}mini-apps/[^/]+/icon\\.tsx?$`,
    },
  },
  {
    name: "app-mini-app-messages-are-leaf-contracts",
    severity: "error",
    comment:
      "Each mini-app's messages.ts declares the bus messages it accepts. mini-apps/types.ts unions them for the bus, so they must stay import-free type contracts rather than pull an app's implementation into the bus.",
    from: {
      path: `${appSourceRoot}mini-apps/[^/]+/messages\\.ts$`,
    },
    to: {
      path: "^packages/",
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
