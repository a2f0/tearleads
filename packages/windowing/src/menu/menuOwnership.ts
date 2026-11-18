import { createContext, type RefObject } from "react";

// Nested menus portal to the body. Follow their owner refs when deciding
// whether a pointer press or scroll happened outside an ancestor menu.
export const ParentMenu =
  createContext<RefObject<HTMLDivElement | null> | null>(null);

const parents = new WeakMap<Element, RefObject<HTMLDivElement | null>>();

export function registerMenuParent(
  menu: HTMLElement,
  parent: RefObject<HTMLDivElement | null>,
) {
  parents.set(menu, parent);
  return () => {
    parents.delete(menu);
  };
}

export function menuContainsTarget(
  menu: HTMLElement,
  target: EventTarget | null,
): boolean {
  if (!(target instanceof Node)) return false;
  if (menu.contains(target)) return true;
  let owner = (
    target instanceof Element ? target : target.parentElement
  )?.closest(".menu");
  while (owner) {
    owner = parents.get(owner)?.current;
    if (owner === menu) return true;
  }
  return false;
}
