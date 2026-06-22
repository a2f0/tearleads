/**
 * @template T
 * @param {unknown} value
 * @returns {T}
 */
export function unsafeCoerce(value) {
  return /** @type {T} */ (value);
}
