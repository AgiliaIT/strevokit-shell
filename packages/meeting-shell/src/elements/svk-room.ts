import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { LABELS } from "../copy.js";
import type { DeviceKind, PerKind } from "../copy.js";
import type { ParticipantView } from "../engine/meetingStore.js";
import { NO_DEVICES, type DeviceLists, type DeviceOption } from "../media/deviceStore.js";
import { RemoteAudio, type RemoteAudioSource } from "../media/remote-audio.js";
import { NO_PROBLEMS, type DeviceProblems } from "./device-messages.js";
import { mayTakeFocus } from "./focus.js";
import { uniqueId } from "./ids.js";
import type { SvkControlBar } from "./svk-control-bar.js";
import type { MeetingMessageView } from "./svk-meeting-message.js";

const ALL_OFF: PerKind<boolean> = Object.freeze({ camera: false, microphone: false });
const NO_CURRENT_DEVICE: PerKind<string | null> = Object.freeze({ camera: null, microphone: null });
const MAX_LAYOUT_COUNT = 9;

interface TileEntry {
  readonly key: string;
  readonly participant: ParticipantView;
  readonly variant: "camera" | "screen";
}

/** The in-meeting screen: video tiles, remote audio, the participant list, and the controls. */
export class SvkRoom extends LitElement {
  static override properties = {
    participants: { attribute: false },
    media: { attribute: false },
    busy: { attribute: false },
    screenOn: { attribute: false },
    screenBusy: { attribute: false },
    problems: { attribute: false },
    devices: { attribute: false },
    currentDevice: { attribute: false },
    leaving: { attribute: false },
    message: { attribute: false },
    onToggle: { attribute: false },
    onRetry: { attribute: false },
    onDismissDevice: { attribute: false },
    onSelectDevice: { attribute: false },
    onLeave: { attribute: false },
    onDismissMessage: { attribute: false },
    canEndMeeting: { attribute: false },
    onEndMeeting: { attribute: false },
    canShareScreen: { attribute: false },
    onToggleScreen: { attribute: false },
    soundBlocked: { state: true },
    participantsOpen: { state: true },
  };

  declare participants: readonly ParticipantView[];
  declare media: PerKind<boolean>;
  declare busy: PerKind<boolean>;
  declare screenOn: boolean;
  declare screenBusy: boolean;
  declare problems: DeviceProblems;
  declare devices: DeviceLists;
  declare currentDevice: PerKind<string | null>;
  declare leaving: boolean;
  /** The connection banner or notice shown above the tiles, if any. */
  declare message: MeetingMessageView | null;
  declare onToggle: ((kind: DeviceKind) => void) | null;
  declare onRetry: ((kind: DeviceKind) => void) | null;
  /** Called when a device message is dismissed, with whether its Dismiss button had focus. */
  declare onDismissDevice: ((kind: DeviceKind, hadFocus: boolean) => void) | null;
  declare onSelectDevice: ((kind: DeviceKind, option: DeviceOption) => void) | null;
  declare onLeave: (() => void) | null;
  /** Called when the participant dismisses a notice, with whether its Dismiss button had focus. */
  declare onDismissMessage: ((hadFocus: boolean) => void) | null;
  declare canEndMeeting: boolean;
  declare onEndMeeting: (() => void) | null;
  /** Whether to show the Share screen toggle (hosts only). */
  declare canShareScreen: boolean;
  declare onToggleScreen: (() => void) | null;
  declare protected soundBlocked: boolean;
  declare protected participantsOpen: boolean;

  readonly #participantsId = uniqueId("svk-participants");
  readonly #audio = new RemoteAudio((blocked) => {
    this.soundBlocked = blocked;
  });

  constructor() {
    super();
    this.participants = [];
    this.media = ALL_OFF;
    this.busy = ALL_OFF;
    this.screenOn = false;
    this.screenBusy = false;
    this.problems = NO_PROBLEMS;
    this.devices = NO_DEVICES;
    this.currentDevice = NO_CURRENT_DEVICE;
    this.leaving = false;
    this.message = null;
    this.onToggle = null;
    this.onRetry = null;
    this.onDismissDevice = null;
    this.onSelectDevice = null;
    this.onLeave = null;
    this.onDismissMessage = null;
    this.canEndMeeting = false;
    this.onEndMeeting = null;
    this.canShareScreen = false;
    this.onToggleScreen = null;
    this.soundBlocked = false;
    this.participantsOpen = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-contents");
    this.ownerDocument.addEventListener("keydown", this.#onKeyDown);
    // Playback stopped on disconnect; the next update starts it again.
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ownerDocument.removeEventListener("keydown", this.#onKeyDown);
    this.#audio.dispose();
    this.soundBlocked = false;
  }

  /** Moves focus to the Microphone toggle once the controls have rendered. */
  async focusMicrophone(): Promise<void> {
    await this.updateComplete;
    await this.#controlBar()?.focusMicrophone();
  }

  /** Moves focus to the `kind` toggle once the controls have rendered. */
  async focusDevice(kind: DeviceKind): Promise<void> {
    await this.updateComplete;
    await this.#controlBar()?.focusDevice(kind);
  }

  /** Moves focus to the Share screen toggle once the controls have rendered. */
  async focusShareScreen(): Promise<void> {
    await this.updateComplete;
    await this.#controlBar()?.focusShareScreen();
  }

  /** Moves focus to the End meeting button once the controls have rendered. */
  async focusEndMeeting(): Promise<void> {
    await this.updateComplete;
    this.#controlBar()?.focusEndMeeting();
  }

  protected override updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    if (!this.isConnected) return;
    this.#audio.sync(
      this.participants.flatMap((participant): RemoteAudioSource[] =>
        !participant.isSelf && participant.audioStream ? [{ key: participant.key, stream: participant.audioStream }] : [],
      ),
    );
  }

  /** One camera tile per participant, then a Shared screen tile for each participant who is sharing. */
  #tiles(): readonly TileEntry[] {
    const sharing = this.participants.filter((participant) => participant.screenStream !== null);
    return [
      ...this.participants.map((participant): TileEntry => ({ key: participant.key, participant, variant: "camera" })),
      ...sharing.map((participant): TileEntry => ({ key: `${participant.key}:screen`, participant, variant: "screen" })),
    ];
  }

  protected override render(): TemplateResult {
    const tiles = this.#tiles();
    const spotlight = tiles.some((tile) => tile.variant === "screen");
    return html`<section class="svk-room" aria-label=${LABELS.meetingRegion}>
      <h2 class="svk-visually-hidden">${LABELS.meetingHeading}</h2>
      <div class="svk-stage">
        <svk-meeting-message .message=${this.message} .onDismiss=${this.#dismissMessage}></svk-meeting-message>
        <ul
          class="svk-tiles"
          aria-label=${LABELS.tiles}
          data-count=${Math.min(tiles.length, MAX_LAYOUT_COUNT)}
          data-layout=${spotlight ? "spotlight" : nothing}
        >
          ${repeat(
            tiles,
            (tile) => tile.key,
            (tile) =>
              html`<svk-video-tile .participant=${tile.participant} .variant=${tile.variant}></svk-video-tile>`,
          )}
        </ul>
        ${this.participantsOpen
          ? html`<svk-participant-list
              .participants=${this.participants}
              .dialogId=${this.#participantsId}
            ></svk-participant-list>`
          : nothing}
      </div>
      <svk-control-bar
        .media=${this.media}
        .busy=${this.busy}
        .screenOn=${this.screenOn}
        .screenBusy=${this.screenBusy}
        .canShareScreen=${this.canShareScreen}
        .onToggleScreen=${this.onToggleScreen}
        .problems=${this.problems}
        .devices=${this.devices}
        .currentDevice=${this.currentDevice}
        .soundBlocked=${this.soundBlocked}
        .leaving=${this.leaving}
        .participantCount=${this.participants.length}
        .participantsOpen=${this.participantsOpen}
        .participantsId=${this.#participantsId}
        .onToggle=${this.onToggle}
        .onRetry=${this.onRetry}
        .onDismissDevice=${this.onDismissDevice}
        .onSelectDevice=${this.onSelectDevice}
        .onToggleParticipants=${this.#toggleParticipants}
        .onTurnOnSound=${this.#turnOnSound}
        .onLeave=${this.onLeave}
        .canEndMeeting=${this.canEndMeeting}
        .onEndMeeting=${this.onEndMeeting}
      ></svk-control-bar>
    </section>`;
  }

  #controlBar(): SvkControlBar | null {
    return this.querySelector<SvkControlBar>("svk-control-bar");
  }

  #toggleParticipants = (): void => {
    this.participantsOpen = !this.participantsOpen;
  };

  /** Escape closes the participant list and returns focus to its trigger, unless focus is out in the host page. */
  #onKeyDown = (event: KeyboardEvent): void => {
    if (!this.participantsOpen || event.key !== "Escape" || event.defaultPrevented || !mayTakeFocus(this)) return;
    event.preventDefault();
    this.participantsOpen = false;
    this.#controlBar()?.focusParticipants();
  };

  #turnOnSound = (): void => this.#audio.retry();
  #dismissMessage = (hadFocus: boolean): void => this.onDismissMessage?.(hadFocus);
}
