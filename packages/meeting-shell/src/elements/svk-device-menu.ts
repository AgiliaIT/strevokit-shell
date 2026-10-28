import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { repeat } from "lit/directives/repeat.js";
import { checkIcon, chevronIcon } from "../icons.js";
import type { DeviceOption } from "../media/deviceStore.js";
import { uniqueId } from "./ids.js";

/** A menu button listing the devices of one kind as radio items. */
export class SvkDeviceMenu extends LitElement {
  static override properties = {
    label: { attribute: false },
    options: { attribute: false },
    currentId: { attribute: false },
    onSelect: { attribute: false },
    open: { state: true },
    focusIndex: { state: true },
  };

  /** Accessible name of the menu button and the menu, for example "Choose camera". */
  declare label: string;
  declare options: readonly DeviceOption[];
  /** The device marked as current; `null` marks the first option. */
  declare currentId: string | null;
  declare onSelect: ((option: DeviceOption) => void) | null;
  declare protected open: boolean;
  declare protected focusIndex: number;

  readonly #menuId = uniqueId("svk-menu");

  constructor() {
    super();
    this.label = "";
    this.options = [];
    this.currentId = null;
    this.onSelect = null;
    this.open = false;
    this.focusIndex = 0;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-contents");
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ownerDocument.removeEventListener("pointerdown", this.#onDocumentPointerDown);
    this.open = false;
  }

  protected override willUpdate(): void {
    if (this.options.length === 0) this.open = false;
    this.focusIndex = Math.min(this.focusIndex, Math.max(0, this.options.length - 1));
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has("open")) {
      if (this.open) this.ownerDocument.addEventListener("pointerdown", this.#onDocumentPointerDown);
      else this.ownerDocument.removeEventListener("pointerdown", this.#onDocumentPointerDown);
    }
    if (this.open && (changed.has("open") || changed.has("focusIndex"))) this.#items()[this.focusIndex]?.focus();
  }

  protected override render(): TemplateResult {
    const checkedIndex = this.#checkedIndex();
    return html`<div class="svk-menu">
      <button
        type="button"
        class="svk-button svk-menu-button"
        aria-label=${this.label}
        title=${this.label}
        aria-haspopup="menu"
        aria-expanded=${this.open ? "true" : "false"}
        aria-controls=${ifDefined(this.open ? this.#menuId : undefined)}
        ?disabled=${this.options.length === 0}
        @click=${this.#onTriggerClick}
        @keydown=${this.#onTriggerKeyDown}
      >
        ${chevronIcon()}
      </button>
      ${this.open
        ? html`<div class="svk-menu-list" id=${this.#menuId} role="menu" aria-label=${this.label}>
            ${repeat(
              this.options,
              (option) => option.deviceId,
              (option, index) =>
                html`<button
                  type="button"
                  role="menuitemradio"
                  class="svk-menu-item"
                  aria-checked=${index === checkedIndex ? "true" : "false"}
                  tabindex=${index === this.focusIndex ? "0" : "-1"}
                  @click=${this.#onItemClick}
                  @keydown=${this.#onItemKeyDown}
                ><span class="svk-menu-check">${index === checkedIndex ? checkIcon() : nothing}</span><span
                    class="svk-menu-label"
                    >${option.label}</span
                  ></button>`,
            )}
          </div>`
        : nothing}
    </div>`;
  }

  #checkedIndex(): number {
    return Math.max(
      0,
      this.options.findIndex((option) => option.deviceId === this.currentId),
    );
  }

  #items(): HTMLButtonElement[] {
    return [...this.querySelectorAll<HTMLButtonElement>(".svk-menu-item")];
  }

  #trigger(): HTMLButtonElement | null {
    return this.querySelector<HTMLButtonElement>(".svk-menu-button");
  }

  #openAt(index: number): void {
    if (this.options.length === 0) return;
    this.focusIndex = index;
    this.open = true;
  }

  #close(returnFocus: boolean): void {
    this.open = false;
    if (returnFocus) this.#trigger()?.focus();
  }

  #onTriggerClick = (): void => {
    if (this.open) this.#close(false);
    else this.#openAt(this.#checkedIndex());
  };

  #onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    this.#openAt(event.key === "ArrowUp" ? this.options.length - 1 : this.#checkedIndex());
  };

  #onItemClick = (event: MouseEvent): void => {
    const index = this.#items().indexOf(event.currentTarget as HTMLButtonElement);
    const option = this.options[index];
    this.#close(true);
    if (option && index !== this.#checkedIndex()) this.onSelect?.(option);
  };

  #onItemKeyDown = (event: KeyboardEvent): void => {
    const index = this.#items().indexOf(event.currentTarget as HTMLButtonElement);
    const last = this.options.length - 1;
    const moves: Readonly<Record<string, number>> = {
      ArrowDown: index === last ? 0 : index + 1,
      ArrowUp: index === 0 ? last : index - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      this.focusIndex = next;
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.#close(true);
    } else if (event.key === "Tab") {
      this.open = false;
    }
  };

  /** A press anywhere outside the menu closes it; `composedPath` keeps this right inside a host's shadow root. */
  #onDocumentPointerDown = (event: PointerEvent): void => {
    if (!event.composedPath().includes(this)) this.open = false;
  };
}
