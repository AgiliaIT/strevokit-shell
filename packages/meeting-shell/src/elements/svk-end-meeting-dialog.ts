import { LitElement, html, type TemplateResult } from "lit";
import { END_MEETING_DIALOG } from "../copy.js";
import { uniqueId } from "./ids.js";

/** Confirmation dialog for host ending the meeting for everyone. */
export class SvkEndMeetingDialog extends LitElement {
  static override properties = {
    busy: { type: Boolean },
    onConfirm: { attribute: false },
    onCancel: { attribute: false },
  };

  declare busy: boolean;
  declare onConfirm: (() => void) | null;
  declare onCancel: (() => void) | null;

  readonly #headingId = uniqueId("svk-end-meeting-title");
  readonly #bodyId = uniqueId("svk-end-meeting-body");

  constructor() {
    super();
    this.busy = false;
    this.onConfirm = null;
    this.onCancel = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-contents");
  }

  override firstUpdated(): void {
    const dialog = this.querySelector<HTMLDialogElement>("dialog");
    if (dialog) {
      if (typeof dialog.showModal === "function") {
        try {
          dialog.showModal();
        } catch {
          dialog.setAttribute("open", "");
        }
      } else {
        dialog.setAttribute("open", "");
      }
    }
    this.focusCancel();
  }

  focusCancel(): void {
    this.querySelector<HTMLButtonElement>(".svk-end-meeting-cancel")?.focus();
  }

  protected override render(): TemplateResult {
    return html`<dialog
      class="svk-end-meeting-dialog"
      aria-labelledby=${this.#headingId}
      aria-describedby=${this.#bodyId}
      @cancel=${this.#onNativeCancel}
      @keydown=${this.#onKeyDown}
    >
      <h2 id=${this.#headingId} class="svk-dialog-heading">${END_MEETING_DIALOG.heading}</h2>
      <p id=${this.#bodyId} class="svk-dialog-body">${END_MEETING_DIALOG.body}</p>
      <div class="svk-dialog-actions">
        <button
          type="button"
          class="svk-button svk-end-meeting-cancel"
          @click=${this.#cancel}
        >
          ${END_MEETING_DIALOG.cancel}
        </button>
        <button
          type="button"
          class="svk-button svk-button-danger svk-end-meeting-confirm"
          aria-busy=${this.busy ? "true" : "false"}
          @click=${this.#confirm}
        >
          ${END_MEETING_DIALOG.confirm}
        </button>
      </div>
    </dialog>`;
  }

  #confirm = (): void => {
    if (this.busy) return;
    this.onConfirm?.();
    this.dispatchEvent(new CustomEvent("svk-confirm", { bubbles: true }));
  };

  #cancel = (): void => {
    this.onCancel?.();
    this.dispatchEvent(new CustomEvent("svk-cancel", { bubbles: true }));
  };

  #onNativeCancel = (event: Event): void => {
    event.preventDefault();
    this.#cancel();
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      this.#cancel();
    }
  };
}
