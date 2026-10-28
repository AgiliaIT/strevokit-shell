import { LitElement, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";

const REPEAT_WINDOW_MS = 500;

/**
 * The shell's one visually hidden `role="status"` region. `announce()` reads a short message out politely; a message
 * repeated within 500 ms is dropped. Each message is a new element, so screen readers read it again even when the
 * text matches an earlier one. Messages announced before the region next renders are read together, in order.
 */
export class SvkAnnouncer extends LitElement {
  #current: { readonly id: number; readonly texts: readonly string[] } | null = null;
  #rendered = true;
  #last = { text: "", at: -Infinity, id: 0 };

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-contents");
  }

  announce(text: string): void {
    const now = Date.now();
    if (text === "" || (text === this.#last.text && now - this.#last.at < REPEAT_WINDOW_MS)) return;
    const id = this.#last.id + 1;
    this.#last = { text, at: now, id };
    const earlier = !this.#rendered && this.#current ? this.#current.texts : [];
    this.#current = { id, texts: [...earlier, text] };
    this.#rendered = false;
    this.requestUpdate();
  }

  protected override updated(): void {
    this.#rendered = true;
  }

  protected override render() {
    const current = this.#current;
    return html`<div class="svk-visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      ${current
        ? keyed(current.id, html`${current.texts.map((text) => html`<p class="svk-announcement">${text}</p>`)}`)
        : nothing}
    </div>`;
  }
}
