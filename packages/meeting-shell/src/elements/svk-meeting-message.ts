import { LitElement, html, nothing, type TemplateResult } from "lit";
import { LABELS } from "../copy.js";
import { warningIcon } from "../icons.js";

/** The one meeting-level message: the connection banner, or a dismissible notice. */
export type MeetingMessageView =
  | { readonly type: "banner"; readonly tone: "warning" | "danger"; readonly text: string }
  | { readonly type: "notice"; readonly text: string };

/**
 * A strip above the tiles with an icon and the message text. It has no live-region role: the shell's announcer reads
 * the message out, so screen readers don't read it twice. A notice has a Dismiss button.
 */
export class SvkMeetingMessage extends LitElement {
  static override properties = {
    message: { attribute: false },
    onDismiss: { attribute: false },
  };

  declare message: MeetingMessageView | null;
  /** Called when Dismiss is pressed, with whether the button had focus. */
  declare onDismiss: ((hadFocus: boolean) => void) | null;

  constructor() {
    super();
    this.message = null;
    this.onDismiss = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-contents");
  }

  protected override render(): TemplateResult | typeof nothing {
    const message = this.message;
    if (!message) return nothing;
    const tone = message.type === "banner" ? message.tone : "warning";
    return html`<div class="svk-meeting-message" data-type=${message.type} data-tone=${tone}>
      ${warningIcon()}
      <p class="svk-meeting-message-text">${message.text}</p>
      ${message.type === "notice"
        ? html`<button
            type="button"
            class="svk-button svk-button-small"
            aria-label=${LABELS.dismissMessage}
            @click=${this.#dismiss}
          >
            ${LABELS.dismiss}
          </button>`
        : nothing}
    </div>`;
  }

  #dismiss = (event: Event): void => {
    const button = event.currentTarget as HTMLElement;
    const root = button.getRootNode() as Document | ShadowRoot;
    this.onDismiss?.(root.activeElement === button);
  };
}
