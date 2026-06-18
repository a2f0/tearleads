import type { AppNavigationMode } from "./AppNavigationMode";

/**
 * Manual override for the navigation mode. `null` defers to automatic
 * viewport/pointer detection; an explicit mode forces that layout.
 */
export type NavigationModeOverride = AppNavigationMode | null;

const OVERRIDE_CYCLE: readonly NavigationModeOverride[] = [
  null,
  "windowed",
  "routed",
];

const OVERRIDE_LABEL = {
  auto: "Auto",
  windowed: "Windowed",
  routed: "Routed",
} satisfies Record<"auto" | AppNavigationMode, string>;

function nextOverride(current: NavigationModeOverride): NavigationModeOverride {
  const index = OVERRIDE_CYCLE.indexOf(current);
  return OVERRIDE_CYCLE[(index + 1) % OVERRIDE_CYCLE.length] ?? null;
}

/**
 * Footer control for manually cycling the navigation mode
 * (auto → windowed → routed) while testing responsive layouts. Shows the
 * resolved mode when on "auto" so it's clear which layout detection picked.
 */
export function NavigationModeToggle({
  override,
  resolvedMode,
  onChange,
}: {
  override: NavigationModeOverride;
  resolvedMode: AppNavigationMode;
  onChange: (next: NavigationModeOverride) => void;
}) {
  const key = override ?? "auto";
  const label =
    override === null
      ? `${OVERRIDE_LABEL.auto} (${OVERRIDE_LABEL[resolvedMode]})`
      : OVERRIDE_LABEL[key];

  return (
    <button
      aria-label={`Navigation mode: ${label}. Click to change.`}
      className="tearleads-action-button nav-mode-toggle"
      title="Toggle navigation mode (auto / windowed / routed)"
      type="button"
      onClick={() => onChange(nextOverride(override))}
    >
      {label}
    </button>
  );
}
