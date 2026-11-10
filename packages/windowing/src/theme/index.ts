// The `@tearleads/windowing/theme` entry: the color theme alone, for a host
// that has no windows, such as a static site. It leaves out the window chrome
// and its stylesheets, which the package entry pulls in.
export { ThemeInvertIcon } from "../icons/ThemeInvertIcon";
export { ThemeProvider, useOptionalTheme, useTheme } from "./ThemeProvider";
export { ThemeSwitch } from "./ThemeSwitch";
export type { DefaultTheme, ThemeDefinition, ThemeScheme } from "./themes";
