import { LitElement, html, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { LABELS } from "../copy.js";
import type { ConnectionView, ParticipantView } from "../engine/meetingStore.js";
import { cameraIcon, cameraOffIcon, microphoneIcon, microphoneOffIcon } from "../icons.js";

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

/** The non-modal Participants dialog. Escape handling and focus return belong to the trigger's owner. */
export class SvkParticipantList extends LitElement {
  static override properties = {
    participants: { attribute: false },
    dialogId: { attribute: false },
  };

  declare participants: readonly ParticipantView[];
  declare dialogId: string;

  constructor() {
    super();
    this.participants = [];
    this.dialogId = "";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-contents");
  }

  protected override render(): TemplateResult {
    return html`<dialog open class="svk-participants" id=${this.dialogId} aria-label=${LABELS.participantsDialog}>
      <h3 class="svk-participants-heading">${LABELS.participantsDialog}</h3>
      <ul class="svk-participant-list">
        ${repeat(
          this.participants,
          (participant) => participant.key,
          (participant) => html`<li class="svk-participant" aria-label=${participantSummary(participant)}>
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
              ${mediaState(LABELS.camera, participant.cameraOn, participant.cameraOn ? cameraIcon() : cameraOffIcon())}
            </span>
          </li>`,
        )}
      </ul>
    </dialog>`;
  }
}
