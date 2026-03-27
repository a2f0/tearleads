// Electrobun re-exports `three` from its TS entrypoint, but the installed
// package here does not expose declarations TS can resolve in this workspace.
declare module "three";
