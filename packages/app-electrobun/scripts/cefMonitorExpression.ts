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

// The first-launch probe starts on Explorer. Stay there until its creation
// form has submitted; opening System Monitor earlier hides onboarding.
export const submitFirstIdentityExpression = `(() => {
  const create = Array.from(document.querySelectorAll('button')).find(
    button => button.textContent.trim() === 'Create new identity' && button.getClientRects().length,
  );
  if (create) {
    create.click();
    return false;
  }
  const name = Array.from(document.querySelectorAll('input[autocomplete="nickname"]')).find(
    input => input.getClientRects().length && input.getAttribute('aria-label') === 'What should we call you?',
  );
  if (!name) return false;
  if (name.value !== 'Persistence Test') {
    // Use the browser's setter so React observes the input event as an edit.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(name, 'Persistence Test');
    name.dispatchEvent(new Event('input', { bubbles: true }));
    return false;
  }
  const submit = name.form?.querySelector('button[type="submit"]:enabled');
  if (!submit) return false;
  submit.click();
  return true;
})()`;
