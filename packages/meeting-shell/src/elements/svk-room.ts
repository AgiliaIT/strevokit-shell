import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { ANNOUNCEMENTS, FULL_SCREEN_REFUSAL, LABELS } from "../copy.js";
import type { DeviceKind, PerKind } from "../copy.js";
import type { ParticipantView } from "../engine/meetingStore.js";
import { NO_DEVICES, type DeviceLists, type DeviceOption } from "../media/deviceStore.js";
import { RemoteAudio, type RemoteAudioSource } from "../media/remote-audio.js";
import { NO_PROBLEMS, type DeviceProblems } from "./device-messages.js";
import { mayTakeFocus } from "./focus.js";
import { uniqueId } from "./ids.js";
import type { SvkAnnouncer } from "./svk-announcer.js";
import type { SvkControlBar } from "./svk-control-bar.js";
import type { MeetingMessageView } from "./svk-meeting-message.js";

const ALL_OFF: PerKind<boolean> = Object.freeze({ camera: false, microphone: false });
const NO_CURRENT_DEVICE: PerKind<string | null> = Object.freeze({ camera: null, microphone: null });
/** Hide revealed controls shortly after the pointer leaves the room. */
const CONTROLS_HIDE_MS = 500;

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
    currentSpeaker: { attribute: false },
    leaving: { attribute: false },
    message: { attribute: false },
    onToggle: { attribute: false },
    onRetry: { attribute: false },
    onDismissDevice: { attribute: false },
    onSelectDevice: { attribute: false },
    onSelectSpeaker: { attribute: false },
    onOpenDevices: { attribute: false },
    onLeave: { attribute: false },
    onDismissMessage: { attribute: false },
    canEndMeeting: { attribute: false },
    onEndMeeting: { attribute: false },
    canShareScreen: { attribute: false },
    onToggleScreen: { attribute: false },
    soundBlocked: { state: true },
    participantsOpen: { state: true },
    presentation: { state: true },
    controlsPinned: { state: true },
    controlsHover: { state: true },
    fullscreenRefused: { state: true },
  };

  declare participants: readonly ParticipantView[];
  declare media: PerKind<boolean>;
  declare busy: PerKind<boolean>;
  declare screenOn: boolean;
  declare screenBusy: boolean;
  declare problems: DeviceProblems;
  declare devices: DeviceLists;
  declare currentDevice: PerKind<string | null>;
  /** The speaker marked current. `null` marks the first listed speaker. */
  declare currentSpeaker: string | null;
  declare leaving: boolean;
  /** The connection banner or notice shown above the tiles, if any. */
  declare message: MeetingMessageView | null;
  declare onToggle: ((kind: DeviceKind) => void) | null;
  declare onRetry: ((kind: DeviceKind) => void) | null;
  /** Called when a device message is dismissed, with whether its Dismiss button had focus. */
  declare onDismissDevice: ((kind: DeviceKind, hadFocus: boolean) => void) | null;
  declare onSelectDevice: ((kind: DeviceKind, option: DeviceOption) => void) | null;
  declare onSelectSpeaker: ((option: DeviceOption) => void) | null;
  /** Refreshes device lists before a device menu opens. */
  declare onOpenDevices: (() => void | Promise<void>) | null;
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
  declare protected presentation: boolean;
  /** Show controls sticky reveal. */
  declare protected controlsPinned: boolean;
  declare protected controlsHover: boolean;
  declare protected fullscreenRefused: boolean;

  readonly #participantsId = uniqueId("svk-participants");
  readonly #audio = new RemoteAudio((blocked) => {
    this.soundBlocked = blocked;
  });
  #panelOpenBefore: boolean | null = null;
  #hideControlsTimer: ReturnType<typeof setTimeout> | null = null;
  #ignoreHoverTimer: ReturnType<typeof setTimeout> | null = null;
  #shareWasOnStage = false;
  /** After entry, ignore room hover briefly so the activating click does not reveal chrome. */
  #ignoreRoomHover = false;

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
    this.currentSpeaker = null;
    this.leaving = false;
    this.message = null;
    this.onToggle = null;
    this.onRetry = null;
    this.onDismissDevice = null;
    this.onSelectDevice = null;
    this.onSelectSpeaker = null;
    this.onOpenDevices = null;
    this.onLeave = null;
    this.onDismissMessage = null;
    this.canEndMeeting = false;
    this.onEndMeeting = null;
    this.canShareScreen = false;
    this.onToggleScreen = null;
    this.soundBlocked = false;
    this.participantsOpen = false;
    this.presentation = false;
    this.controlsPinned = false;
    this.controlsHover = false;
    this.fullscreenRefused = false;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-contents");
    this.ownerDocument.addEventListener("keydown", this.#onKeyDown);
    this.ownerDocument.addEventListener("fullscreenchange", this.#onFullscreenChange);
    // Playback stopped on disconnect; the next update starts it again.
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.ownerDocument.removeEventListener("keydown", this.#onKeyDown);
    this.ownerDocument.removeEventListener("fullscreenchange", this.#onFullscreenChange);
    this.#clearHideControlsTimer();
    this.#clearIgnoreHoverTimer();
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

    const shareOnStage = this.#shareOnStage();
    if (this.#shareWasOnStage && !shareOnStage && this.presentation) {
      this.#leavePresentation({ announce: true, restorePanel: true, exitBrowserFullscreen: true });
    }
    this.#shareWasOnStage = shareOnStage;
  }

  /** `1`, `2`, or `many` for the gallery. A share omits the attribute so these rules cannot letterbox it. */
  #galleryCount(): "1" | "2" | "many" {
    const count = this.participants.length;
    if (count === 2) return "2";
    if (count >= 3) return "many";
    return "1";
  }

  /** Share tiles while anyone is sharing; otherwise one camera tile per participant. */
  #tiles(): readonly TileEntry[] {
    const sharing = this.participants.filter((participant) => participant.screenStream !== null);
    if (sharing.length > 0) {
      return sharing.map(
        (participant): TileEntry => ({ key: `${participant.key}:screen`, participant, variant: "screen" }),
      );
    }
    return this.participants.map((participant): TileEntry => ({ key: participant.key, participant, variant: "camera" }));
  }

  #shareOnStage(): boolean {
    return this.participants.some((participant) => participant.screenStream !== null);
  }

  protected override render(): TemplateResult {
    const tiles = this.#tiles();
    const share = tiles.some((tile) => tile.variant === "screen");
    const controlsRevealed = this.controlsPinned || this.controlsHover;
    return html`<section
      class="svk-room"
      aria-label=${LABELS.meetingRegion}
      data-presentation=${this.presentation ? "true" : nothing}
      data-controls-revealed=${this.presentation && controlsRevealed ? "true" : nothing}
      @pointerenter=${this.#onRoomPointerEnter}
      @pointerleave=${this.#onRoomPointerLeave}
    >
      <h2 class="svk-visually-hidden">${LABELS.meetingHeading}</h2>
      <div class="svk-layout">
        <div class="svk-stage">
          <svk-meeting-message .message=${this.message} .onDismiss=${this.#dismissMessage}></svk-meeting-message>
          ${this.fullscreenRefused
            ? html`<p class="svk-fullscreen-refusal">${FULL_SCREEN_REFUSAL}</p>`
            : nothing}
          <ul
            class="svk-tiles"
            aria-label=${LABELS.tiles}
            data-count=${share ? nothing : this.#galleryCount()}
            data-layout=${share ? "share" : nothing}
          >
            ${repeat(
              tiles,
              (tile) => tile.key,
              (tile) =>
                html`<svk-video-tile .participant=${tile.participant} .variant=${tile.variant}></svk-video-tile>`,
            )}
          </ul>
        </div>
        ${this.participantsOpen
          ? html`<svk-participant-list
              .participants=${this.participants}
              .panelId=${this.#participantsId}
              .onClose=${this.#closeParticipants}
            ></svk-participant-list>`
          : nothing}
      </div>
      <svk-control-bar
        .media=${this.media}
        .busy=${this.busy}
        .screenOn=${this.screenOn}
        .screenBusy=${this.screenBusy}
        .shareOnStage=${share}
        .presentation=${this.presentation}
        .controlsRevealed=${controlsRevealed}
        .canShareScreen=${this.canShareScreen}
        .onToggleScreen=${this.onToggleScreen}
        .onTogglePresentation=${this.#togglePresentation}
        .onToggleShowControls=${this.#toggleShowControls}
        .problems=${this.problems}
        .devices=${this.devices}
        .currentDevice=${this.currentDevice}
        .currentSpeaker=${this.currentSpeaker}
        .soundBlocked=${this.soundBlocked}
        .leaving=${this.leaving}
        .participantCount=${this.participants.length}
        .participantsOpen=${this.participantsOpen}
        .participantsId=${this.#participantsId}
        .onToggle=${this.onToggle}
        .onRetry=${this.onRetry}
        .onDismissDevice=${this.onDismissDevice}
        .onSelectDevice=${this.onSelectDevice}
        .onSelectSpeaker=${this.onSelectSpeaker}
        .onOpenDevices=${this.onOpenDevices}
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

  #meetingElement(): HTMLElement | null {
    return this.closest("strevokit-meeting");
  }

  #announce(text: string): void {
    this.#meetingElement()?.querySelector<SvkAnnouncer>("svk-announcer")?.announce(text);
  }

  #toggleParticipants = (): void => {
    this.participantsOpen = !this.participantsOpen;
  };

  /** Closes the participants panel and returns focus to its trigger. */
  #closeParticipants = (): void => {
    if (!this.participantsOpen) return;
    this.participantsOpen = false;
    this.#controlBar()?.focusParticipants();
  };

  #toggleShowControls = (): void => {
    this.controlsPinned = !this.controlsPinned;
    if (this.controlsPinned) this.#clearHideControlsTimer();
  };

  #togglePresentation = (): void => {
    if (this.presentation) {
      this.#leavePresentation({ announce: true, restorePanel: true, exitBrowserFullscreen: true });
      return;
    }
    void this.#enterPresentation();
  };

  async #enterPresentation(): Promise<void> {
    if (!this.#shareOnStage() || this.presentation) return;
    this.#panelOpenBefore = this.participantsOpen;
    this.presentation = true;
    this.controlsPinned = false;
    this.controlsHover = false;
    this.#armIgnoreRoomHover();
    this.fullscreenRefused = false;
    this.#announce(ANNOUNCEMENTS.fullScreenOn);

    const meeting = this.#meetingElement();
    const request = meeting && typeof meeting.requestFullscreen === "function" ? meeting.requestFullscreen.bind(meeting) : null;
    if (!request) {
      this.fullscreenRefused = true;
      return;
    }
    try {
      await request();
    } catch {
      if (this.presentation) this.fullscreenRefused = true;
      return;
    }
    if (!this.presentation) {
      if (meeting && this.ownerDocument.fullscreenElement === meeting) {
        const exit = this.ownerDocument.exitFullscreen?.bind(this.ownerDocument);
        if (typeof exit === "function") void exit().catch(() => {});
      }
    }
  }

  #leavePresentation(options: {
    readonly announce: boolean;
    readonly restorePanel: boolean;
    readonly exitBrowserFullscreen?: boolean;
  }): void {
    if (!this.presentation) return;
    const meeting = this.#meetingElement();
    if (options.exitBrowserFullscreen && meeting && this.ownerDocument.fullscreenElement === meeting) {
      const exit = this.ownerDocument.exitFullscreen?.bind(this.ownerDocument);
      if (typeof exit === "function") void exit().catch(() => {});
    }
    this.presentation = false;
    this.controlsPinned = false;
    this.controlsHover = false;
    this.#ignoreRoomHover = false;
    this.fullscreenRefused = false;
    this.#clearHideControlsTimer();
    this.#clearIgnoreHoverTimer();
    if (options.restorePanel && this.#panelOpenBefore !== null) {
      this.participantsOpen = this.#panelOpenBefore;
    }
    this.#panelOpenBefore = null;
    if (options.announce) this.#announce(ANNOUNCEMENTS.fullScreenOff);
  }

  #onRoomPointerEnter = (): void => {
    if (!this.presentation || this.#ignoreRoomHover) return;
    this.#clearHideControlsTimer();
    this.controlsHover = true;
  };

  #onRoomPointerLeave = (): void => {
    if (!this.presentation) return;
    this.#ignoreRoomHover = false;
    this.#clearIgnoreHoverTimer();
    if (this.controlsPinned) return;
    this.#clearHideControlsTimer();
    this.#hideControlsTimer = setTimeout(() => {
      this.#hideControlsTimer = null;
      if (!this.controlsPinned) this.controlsHover = false;
      this.requestUpdate();
    }, CONTROLS_HIDE_MS);
  };

  #armIgnoreRoomHover(): void {
    this.#ignoreRoomHover = true;
    this.#clearIgnoreHoverTimer();
    this.#ignoreHoverTimer = setTimeout(() => {
      this.#ignoreHoverTimer = null;
      this.#ignoreRoomHover = false;
    }, 0);
  }

  #clearHideControlsTimer(): void {
    if (this.#hideControlsTimer !== null) {
      clearTimeout(this.#hideControlsTimer);
      this.#hideControlsTimer = null;
    }
  }

  #clearIgnoreHoverTimer(): void {
    if (this.#ignoreHoverTimer !== null) {
      clearTimeout(this.#ignoreHoverTimer);
      this.#ignoreHoverTimer = null;
    }
  }

  /**
   * Escape closes the participant list first. When the panel is closed, Escape leaves presentation unless the
   * meeting is browser-fullscreen (the browser owns that Escape; `fullscreenchange` leaves presentation).
   */
  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || event.defaultPrevented || !mayTakeFocus(this)) return;
    if (this.participantsOpen) {
      event.preventDefault();
      this.#closeParticipants();
      return;
    }
    if (!this.presentation) return;
    const meeting = this.#meetingElement();
    if (meeting && this.ownerDocument.fullscreenElement === meeting) {
      // Let the browser exit fullscreen; `#onFullscreenChange` leaves presentation.
      return;
    }
    event.preventDefault();
    this.#leavePresentation({ announce: true, restorePanel: true });
  };

  #onFullscreenChange = (): void => {
    if (!this.presentation) return;
    const meeting = this.#meetingElement();
    if (!meeting) return;
    if (this.ownerDocument.fullscreenElement !== meeting) {
      this.#leavePresentation({ announce: true, restorePanel: true });
    }
  };

  /** Sends meeting audio to `deviceId`, starting during this call. */
  setSpeaker(deviceId: string): Promise<void> {
    return this.#audio.setSink(deviceId);
  }

  #turnOnSound = (): void => this.#audio.retry();
  #dismissMessage = (hadFocus: boolean): void => this.onDismissMessage?.(hadFocus);
}
