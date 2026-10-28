/**
 * Defines `tag` once. Does nothing outside a browser (server rendering, where Lit installs a stand-in
 * `customElements` registry but there is no `window`) or when the tag is already defined, so loading the module or
 * the CDN script twice never throws.
 */
export function defineOnce(tag: string, ctor: CustomElementConstructor): void {
  if (typeof window === "undefined" || window.customElements === undefined) return;
  if (window.customElements.get(tag) !== undefined) return;
  window.customElements.define(tag, ctor);
}
