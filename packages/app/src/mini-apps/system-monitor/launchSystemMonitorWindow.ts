interface LaunchSystemMonitorWindowOptions {
  isPinned: boolean;
  openWindow: () => void;
  unpinToWindow: () => void;
}

// Every windowed entry point must clear the inline placement before opening a
// window so the monitor never renders twice on the same pane.
export function launchSystemMonitorWindow({
  isPinned,
  openWindow,
  unpinToWindow,
}: LaunchSystemMonitorWindowOptions): void {
  if (isPinned) {
    unpinToWindow();
  }
  openWindow();
}
