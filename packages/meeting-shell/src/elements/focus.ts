/**
 * Whether the shell may move focus now without pulling it away from the host page: nothing is focused, or focus is
 * already inside the shell.
 */
export function mayTakeFocus(element: Element): boolean {
  const active = element.ownerDocument.activeElement;
  const shell = element.closest("strevokit-meeting") ?? element;
  return active === null || active === element.ownerDocument.body || shell.contains(active);
}
