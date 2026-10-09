/** Whether a theme paints light or dark surfaces. */
export type ThemeScheme = "light" | "dark";

/**
 * A color theme a host offers. The package knows themes only by id: the host
 * styles each one with a `:root[data-theme="<id>"]` block of the design tokens
 * the chrome reads (see `tokens.css`), and {@link ThemeProvider} stamps the
 * active theme's id and scheme onto `<html>`.
 */
export interface ThemeDefinition<Id extends string = string> {
  readonly id: Id;
  /** The theme's name, as the switch announces it ("Switch to Dark theme"). */
  readonly label: string;
  /**
   * Stamped as `<html data-theme-scheme>`, so rules that care only whether
   * surfaces are dark (shadow depth, native controls) cover every dark theme
   * without listing ids.
   */
  readonly scheme: ThemeScheme;
}

/**
 * The theme shown until the user picks one: a theme id, or one id per OS color
 * scheme, which the provider follows as the OS preference changes.
 */
export type DefaultTheme<Id extends string = string> =
  | Id
  | Readonly<Record<ThemeScheme, Id>>;

export function findTheme<Id extends string>(
  themes: readonly ThemeDefinition<Id>[],
  id: string | null | undefined,
): ThemeDefinition<Id> | undefined {
  return themes.find((theme) => theme.id === id);
}

export function resolveDefaultThemeId<Id extends string>(
  defaultTheme: DefaultTheme<Id>,
  osScheme: ThemeScheme,
): Id {
  return typeof defaultTheme === "string"
    ? defaultTheme
    : defaultTheme[osScheme];
}

/** The theme after `current` in the host's order, wrapping to the first. */
export function nextTheme<Id extends string>(
  themes: readonly ThemeDefinition<Id>[],
  current: ThemeDefinition<Id>,
): ThemeDefinition<Id> {
  const index = themes.indexOf(current);
  return themes[(index + 1) % themes.length] ?? current;
}
