// The launcher can start collapsed or as a closed bottom sheet. Open it before
// looking for the monitor, and leave an already open monitor alone while polling.
export const openSystemMonitorExpression = `(() => {
  if (document.querySelector('.system-monitor')) return;
  const monitor = document.querySelector('[aria-label="System Monitor"], a[href="/app/system-monitor"]');
  if (monitor) {
    monitor.click();
    return;
  }
  document.querySelector('[aria-label="Menu"][aria-expanded="false"]')?.click();
})()`;
