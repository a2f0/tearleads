import { saveDeveloperMode } from "../../src/providers/developer-mode/DeveloperModeProvider";

export function enableSystemMonitorDeveloperMode(): void {
  saveDeveloperMode("enabled");
}
