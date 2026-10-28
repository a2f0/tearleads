// The launcher can start collapsed or as a closed bottom sheet. Open it before
// looking for the monitor, and leave an already open monitor alone while polling.
export const openSystemMonitorExpression = `(() => {
  if (document.querySelector('.system-monitor')) return;
  const monitor = document.querySelector('a[href="/app/system-monitor"]') ??
    Array.from(document.querySelectorAll('.menu button')).find(
      (button) => button.textContent?.trim() === 'System Monitor',
    );
  if (monitor) {
    monitor.click();
    return;
  }
  document.querySelector('[aria-label="Menu"][aria-expanded="false"]')?.click();
})()`;
