import { LitElement, html, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { LABELS } from "../copy.js";
import type { ConnectionView, ParticipantView } from "../engine/meetingStore.js";
import { cameraIcon, cameraOffIcon, closeIcon, microphoneIcon, microphoneOffIcon } from "../icons.js";
import { initials } from "./svk-video-tile.js";

const CONNECTION_TEXT: Readonly<Record<ConnectionView, string>> = {
  connected: LABELS.connected,
  connecting: LABELS.connecting,
  interrupted: LABELS.interrupted,
};

/** The accessible text of one participant entry. */
export function participantSummary(participant: ParticipantView): string {
  const name = participant.isSelf ? `${participant.name} ${LABELS.you}` : participant.name;
  const role = participant.role === "host" ? LABELS.host : LABELS.participant;
  const microphone = `microphone ${participant.microphoneOn ? "on" : "off"}`;
  const camera = `camera ${participant.cameraOn ? "on" : "off"}`;
  return `${name}, ${role}, ${CONNECTION_TEXT[participant.connection]}, ${microphone}, ${camera}`;
}

function mediaState(label: string, on: boolean, icon: TemplateResult): TemplateResult {
  return html`<span class="svk-media-state" data-state=${on ? "on" : "off"}>
    ${icon}<span class="svk-text">${`${label} ${on ? LABELS.on : LABELS.off}`.toLowerCase()}</span>
  </span>`;
}

/** The in-meeting Participants complementary region. Escape handling and focus return belong to the trigger's owner. */
export class SvkParticipantList extends LitElement {
  static override properties = {
    participants: { attribute: false },
    panelId: { attribute: false },
    onClose: { attribute: false },
  };

  declare participants: readonly ParticipantView[];
  declare panelId: string;
  /** Closes the panel the same way Escape does. */
  declare onClose: (() => void) | null;

  constructor() {
    super();
    this.participants = [];
    this.panelId = "";
    this.onClose = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-contents");
  }

  protected override render(): TemplateResult {
    return html`<aside class="svk-participants" id=${this.panelId} aria-label=${LABELS.participantsDialog}>
      <div class="svk-participants-header">
        <h3 class="svk-participants-heading">${LABELS.participantsDialog}</h3>
        <button
          type="button"
          class="svk-button svk-participants-close"
          title=${LABELS.closeParticipants}
          @click=${this.#close}
        >
          ${closeIcon()}<span class="svk-label">${LABELS.closeParticipants}</span>
        </button>
      </div>
      <ul class="svk-participant-list">
        ${repeat(
          this.participants,
          (participant) => participant.key,
          (participant) => html`<li class="svk-participant" aria-label=${participantSummary(participant)}>
            <span class="svk-participant-avatar" aria-hidden="true">
              <span class="svk-initials" aria-hidden="true">${initials(participant.name)}</span>
            </span>
            <span class="svk-participant-body">
              <span class="svk-participant-name" title=${participant.name}
                >${participant.name}${participant.isSelf ? ` ${LABELS.you}` : ""}</span
              >
              <span class="svk-participant-meta">
                <span class="svk-text">${participant.role === "host" ? LABELS.host : LABELS.participant}</span>
                <span class="svk-text" data-connection=${participant.connection}
                  >${CONNECTION_TEXT[participant.connection]}</span
                >
              </span>
              <span class="svk-participant-media">
                ${mediaState(
                  LABELS.microphone,
                  participant.microphoneOn,
                  participant.microphoneOn ? microphoneIcon() : microphoneOffIcon(),
                )}
                ${mediaState(
                  LABELS.camera,
                  participant.cameraOn,
                  participant.cameraOn ? cameraIcon() : cameraOffIcon(),
                )}
              </span>
            </span>
          </li>`,
        )}
      </ul>
    </aside>`;
  }

  #close = (): void => {
    this.onClose?.();
  };
}
