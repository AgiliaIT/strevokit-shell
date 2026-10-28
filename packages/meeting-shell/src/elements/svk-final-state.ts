import { LitElement, html, nothing, type TemplateResult } from "lit";
import { LABELS, finalState } from "../copy.js";
import type { MeetingShellCloseReason } from "../types.js";
import { mayTakeFocus } from "./focus.js";

/** The terminal screen. Its heading takes focus so keyboard and screen reader users land on the outcome. */
export class SvkFinalState extends LitElement {
  static override properties = {
    reason: { attribute: false },
    code: { attribute: false },
  };

  declare reason: MeetingShellCloseReason;
  /** The engine error code behind a failed join, when known. */
  declare code: string | undefined;

  constructor() {
    super();
    this.reason = "left";
    this.code = undefined;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-contents");
  }

  protected override firstUpdated(): void {
    if (mayTakeFocus(this)) this.querySelector<HTMLElement>(".svk-heading")?.focus();
  }

  protected override render(): TemplateResult {
    const copy = finalState(this.reason, this.code);
    return html`<section class="svk-final" aria-label=${LABELS.meetingRegion}>
      <h2 class="svk-heading" tabindex="-1">${copy.heading}</h2>
      ${copy.body ? html`<p class="svk-final-body">${copy.body}</p>` : nothing}
    </section>`;
  }
}
