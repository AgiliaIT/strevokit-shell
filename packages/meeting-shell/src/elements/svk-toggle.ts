import { LitElement, html, nothing, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { LABELS } from "../copy.js";

/**
 * A native toggle button with a fixed name; the state is exposed through `aria-pressed`. Presses are ignored while
 * `busy`, without disabling the button, so focus stays put.
 */
export class SvkToggle extends LitElement {
  static override properties = {
    label: { attribute: false },
    pressed: { attribute: false },
    busy: { attribute: false },
    describedBy: { attribute: false },
    iconOn: { attribute: false },
    iconOff: { attribute: false },
    onPress: { attribute: false },
  };

  declare label: string;
  declare pressed: boolean;
  declare busy: boolean;
  /** ID of the message that explains why the device can't be used. */
  declare describedBy: string | null;
  declare iconOn: TemplateResult | null;
  declare iconOff: TemplateResult | null;
  declare onPress: (() => void) | null;

  constructor() {
    super();
    this.label = "";
    this.pressed = false;
    this.busy = false;
    this.describedBy = null;
    this.iconOn = null;
    this.iconOff = null;
    this.onPress = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-contents");
  }

  override focus(options?: FocusOptions): void {
    this.querySelector("button")?.focus(options);
  }

  protected override render(): TemplateResult {
    const icon = this.pressed ? this.iconOn : this.iconOff;
    return html`<button
      type="button"
      class="svk-button svk-toggle"
      data-state=${this.pressed ? "on" : "off"}
      aria-label=${this.label}
      aria-pressed=${this.pressed ? "true" : "false"}
      aria-busy=${this.busy ? "true" : "false"}
      aria-describedby=${ifDefined(this.describedBy ?? undefined)}
      title=${this.label}
      @click=${this.#press}
    >
      ${icon ?? nothing}
      <span class="svk-label">${this.label}</span>
      <span class="svk-state">${this.pressed ? LABELS.on : LABELS.off}</span>
    </button>`;
  }

  #press = (): void => {
    if (!this.busy) this.onPress?.();
  };
}
