const inspectCustom = Symbol.for("nodejs.util.inspect.custom");
const MAX_MARKUP = 1000;

function truncated(text: string): string {
  return text.length > MAX_MARKUP
    ? `${text.slice(0, MAX_MARKUP)}... (${text.length} chars)`
    : text;
}

/**
 * Prints happy-dom nodes as their markup. A failing assertion prints its
 * received value through this hook, and Bun's default dump of a node walks the
 * whole document graph: one CI shard printed 5.8 million lines for a failed
 * `toBeNull()` and ran into the job timeout instead of failing.
 */
export function installCompactDomInspect(): void {
  Object.defineProperty(Node.prototype, inspectCustom, {
    configurable: true,
    value(this: Node): string {
      if (this instanceof Element) return truncated(this.outerHTML);
      return truncated(`${this.nodeName} ${JSON.stringify(this.textContent)}`);
    },
  });
}
