import type { IConfiguration } from "dependency-cruiser";
import { packageSourceRoot, testFilePattern } from "./dependencySourceRoots";

const appSourceRoot = packageSourceRoot.app;

// The window core's app-agnostic closure: the window directory plus the menu,
// resize, and context primitives it renders with.
const windowCorePrimitives = [
  `${appSourceRoot}components/shared/(Menu|MenuItem|SidebarResize|useContextMenuState|useMenuKeyboard)\\.(tsx?|css)$`,
  `${appSourceRoot}utils/createRequiredContext\\.ts$`,
];

export const appDependencyRules = [
  {
    name: "app-window-core-is-app-agnostic",
    severity: "error",
    comment:
      "The window core (components/window/) owns window state, chrome, and geometry, and knows nothing about apps. It may import only itself and its menu/resize/context primitives. App behavior such as mini-app routes and the mini-app error boundary reaches a window through slots like Window's ContentBoundary (filled by mini-apps/MiniAppWindow.tsx).",
    from: {
      path: `${appSourceRoot}components/window/`,
      pathNot: testFilePattern.source,
    },
    to: {
      path: "^packages/",
      pathNot: [`${appSourceRoot}components/window/`, ...windowCorePrimitives],
    },
  },
  {
    name: "app-window-core-primitives-are-app-agnostic",
    severity: "error",
    comment:
      "The menu, resize, and context primitives the window core renders with must stay app-agnostic too, so the whole closure can move into a package. App-specific behavior (e.g. diagnostics breadcrumbs) wraps them instead; see components/shared/DiagnosticMenuItem.tsx.",
    from: {
      path: windowCorePrimitives,
      pathNot: testFilePattern.source,
    },
    to: {
      path: "^packages/",
      pathNot: windowCorePrimitives,
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
