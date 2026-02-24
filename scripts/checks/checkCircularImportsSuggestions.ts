const SHARED_PACKAGE = '@tearleads/shared';
const UI_PACKAGE = '@tearleads/ui';
const WINDOW_MANAGER_PACKAGE = '@tearleads/window-manager';
const CLIENT_PACKAGE = '@tearleads/client';
const API_PACKAGE = '@tearleads/api';

export function getSharedUiSuggestions(cycleNodes: string[]): string[] {
  const hasUi = cycleNodes.includes(UI_PACKAGE);
  const hasShared = cycleNodes.includes(SHARED_PACKAGE);
  const suggestions = [
    `Move non-visual shared code (types, validators, protocol helpers, pure utilities) into ${SHARED_PACKAGE}.`
  ];

  if (hasUi || !hasShared) {
    suggestions.push(
      `Move reusable UI code (React components, UI hooks/providers, styles) into ${UI_PACKAGE}.`
    );
  }

  if (hasUi) {
    suggestions.push(
      `Avoid routing non-UI helpers through ${UI_PACKAGE}; import those helpers from ${SHARED_PACKAGE} instead.`
    );
  }

  return suggestions;
}

export function getNoClientImportSuggestions(): string[] {
  return [
    `Move non-UI shared logic (types, validators, protocols, pure utils) into ${SHARED_PACKAGE}.`,
    `Move reusable UI components/hooks/providers into ${UI_PACKAGE}.`,
    `Move windowing primitives and window state helpers into ${WINDOW_MANAGER_PACKAGE}.`,
    `Keep ${CLIENT_PACKAGE} as an app entrypoint/composition package; other packages should not import from it.`
  ];
}

export function getNoApiImportSuggestions(): string[] {
  return [
    `Move API-consumed contracts/types/validators into ${SHARED_PACKAGE}.`,
    `Move API test-only helpers into @tearleads/db-test-utils.`,
    `Move runtime API consumer logic into @tearleads/api-client.`,
    `Keep ${API_PACKAGE} as an app entrypoint package; other packages should not import from it.`
  ];
}
