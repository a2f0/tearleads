/** True for the keys that activate a focused interactive element (Enter/Space). */
export function isKeyboardActivationKey(key: string): boolean {
  return key === "Enter" || key === " ";
}
