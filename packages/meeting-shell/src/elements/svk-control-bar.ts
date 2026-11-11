import { LitElement, html, nothing, type TemplateResult } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { LABELS } from "../copy.js";
import type { DeviceKind, PerKind } from "../copy.js";
import {
  cameraIcon,
  cameraOffIcon,
  endMeetingIcon,
  exitFullScreenIcon,
  fullScreenIcon,
  leaveIcon,
  microphoneIcon,
  microphoneOffIcon,
  peopleIcon,
  shareScreenIcon,
  showControlsIcon,
  soundIcon,
} from "../icons.js";
import { NO_DEVICES, type DeviceLists, type DeviceOption } from "../media/deviceStore.js";
import { NO_PROBLEMS, describedBy, deviceMessages, type DeviceProblems } from "./device-messages.js";
import { uniqueId } from "./ids.js";
import type { SvkToggle } from "./svk-toggle.js";

const ALL_OFF: PerKind<boolean> = Object.freeze({ camera: false, microphone: false });
const NO_CURRENT_DEVICE: PerKind<string | null> = Object.freeze({ camera: null, microphone: null });
const MESSAGE_ORDER: readonly DeviceKind[] = ["microphone", "camera"];

/** The in-meeting toolbar. */
export class SvkControlBar extends LitElement {
  static override properties = {
    media: { attribute: false },
    busy: { attribute: false },
    screenOn: { attribute: false },
    screenBusy: { attribute: false },
    shareOnStage: { attribute: false },
    presentation: { attribute: false },
    controlsRevealed: { attribute: false },
    problems: { attribute: false },
    devices: { attribute: false },
    currentDevice: { attribute: false },
    currentSpeaker: { attribute: false },
    soundBlocked: { attribute: false },
    leaving: { attribute: false },
    participantCount: { attribute: false },
    participantsOpen: { attribute: false },
    participantsId: { attribute: false },
    canEndMeeting: { attribute: false },
    canShareScreen: { attribute: false },
    onToggle: { attribute: false },
    onToggleScreen: { attribute: false },
    onTogglePresentation: { attribute: false },
    onToggleShowControls: { attribute: false },
    onRetry: { attribute: false },
    onDismissDevice: { attribute: false },
    onSelectDevice: { attribute: false },
    onSelectSpeaker: { attribute: false },
    onOpenDevices: { attribute: false },
    onToggleParticipants: { attribute: false },
    onTurnOnSound: { attribute: false },
    onLeave: { attribute: false },
    onEndMeeting: { attribute: false },
  };

  /** Confirmed engine state only; never flipped before the engine reports the change. */
  declare media: PerKind<boolean>;
  declare busy: PerKind<boolean>;
  /** Whether the participant is sharing their screen, as the engine confirms it. */
  declare screenOn: boolean;
  /** Whether starting or stopping the screen share is in flight. */
  declare screenBusy: boolean;
  /** Whether any share tile is on stage (local or remote). */
  declare shareOnStage: boolean;
  /** Whether presentation mode is active. */
  declare presentation: boolean;
  /** Whether Show controls or hover has revealed the essential set. */
  declare controlsRevealed: boolean;
  declare problems: DeviceProblems;
  declare devices: DeviceLists;
  /** The device each menu marks as current; `null` marks the first one. */
  declare currentDevice: PerKind<string | null>;
  /** The speaker marked current. `null` marks the first listed speaker. */
  declare currentSpeaker: string | null;
  declare soundBlocked: boolean;
  declare leaving: boolean;
  declare participantCount: number;
  declare participantsOpen: boolean;
  /** ID of the Participants complementary region, referenced while it is open. */
  declare participantsId: string;
  declare canEndMeeting: boolean;
  /** Whether to show the Share screen toggle (hosts only). */
  declare canShareScreen: boolean;
  declare onToggle: ((kind: DeviceKind) => void) | null;
  declare onToggleScreen: (() => void) | null;
  declare onTogglePresentation: (() => void) | null;
  declare onToggleShowControls: (() => void) | null;
  declare onRetry: ((kind: DeviceKind) => void) | null;
  /** Called when a device message is dismissed, with whether its Dismiss button had focus. */
  declare onDismissDevice: ((kind: DeviceKind, hadFocus: boolean) => void) | null;
  declare onSelectDevice: ((kind: DeviceKind, option: DeviceOption) => void) | null;
  declare onSelectSpeaker: ((option: DeviceOption) => void) | null;
  /** Refreshes device lists before a device menu opens. */
  declare onOpenDevices: (() => void | Promise<void>) | null;
  declare onToggleParticipants: (() => void) | null;
  declare onTurnOnSound: (() => void) | null;
  declare onLeave: (() => void) | null;
  declare onEndMeeting: (() => void) | null;

  readonly #id = uniqueId("svk-controls");

  constructor() {
    super();
    this.media = ALL_OFF;
    this.busy = ALL_OFF;
    this.screenOn = false;
    this.screenBusy = false;
    this.shareOnStage = false;
    this.presentation = false;
    this.controlsRevealed = false;
    this.problems = NO_PROBLEMS;
    this.devices = NO_DEVICES;
    this.currentDevice = NO_CURRENT_DEVICE;
    this.currentSpeaker = null;
    this.soundBlocked = false;
    this.leaving = false;
    this.participantCount = 0;
    this.participantsOpen = false;
    this.participantsId = "";
    this.canEndMeeting = false;
    this.canShareScreen = false;
    this.onToggle = null;
    this.onToggleScreen = null;
    this.onTogglePresentation = null;
    this.onToggleShowControls = null;
    this.onRetry = null;
    this.onDismissDevice = null;
    this.onSelectDevice = null;
    this.onSelectSpeaker = null;
    this.onOpenDevices = null;
    this.onToggleParticipants = null;
    this.onTurnOnSound = null;
    this.onLeave = null;
    this.onEndMeeting = null;
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.classList.add("svk-contents");
  }

  /** Moves focus to the Microphone toggle once it has rendered. */
  async focusMicrophone(): Promise<void> {
    await this.updateComplete;
    const toggle = this.querySelector<SvkToggle>("svk-toggle");
    await toggle?.updateComplete;
    toggle?.focus();
  }

  /** Moves focus to the `kind` toggle once it has rendered. */
  async focusDevice(kind: DeviceKind): Promise<void> {
    await this.updateComplete;
    const toggle = this.querySelector<SvkToggle>(`svk-toggle[data-kind="${kind}"]`);
    await toggle?.updateComplete;
    toggle?.focus();
  }

  /** Moves focus to the Share screen toggle once it has rendered. */
  async focusShareScreen(): Promise<void> {
    await this.updateComplete;
    const toggle = this.querySelector<SvkToggle>('svk-toggle[data-kind="screen"]');
    await toggle?.updateComplete;
    toggle?.focus();
  }

  /** Moves focus to the Participants button. */
  focusParticipants(): void {
    this.querySelector<HTMLButtonElement>(".svk-participants-trigger")?.focus();
  }

  /** Moves focus to the End meeting button. */
  focusEndMeeting(): void {
    this.querySelector<HTMLButtonElement>(".svk-end-meeting-trigger")?.focus();
  }

  protected override render(): TemplateResult {
    const participants = LABELS.participants(this.participantCount);
    const chromeHidden = this.presentation && !this.controlsRevealed;
    const fullScreenLabel = this.presentation ? LABELS.exitFullScreen : LABELS.fullScreen;
    return html`<div class="svk-controls">
      ${deviceMessages(this.#id, this.problems, MESSAGE_ORDER, this.#retry, this.#dismissDevice)}
      <div class="svk-toolbar" role="toolbar" aria-label=${LABELS.controls}>
        <div class="svk-control-group svk-toolbar-standard" ?hidden=${chromeHidden}>
          <svk-toggle
            data-kind="microphone"
            .label=${LABELS.microphone}
            .pressed=${this.media.microphone}
            .busy=${this.busy.microphone}
            .describedBy=${describedBy(this.#id, this.problems, "microphone")}
            .iconOn=${microphoneIcon()}
            .iconOff=${microphoneOffIcon()}
            .onPress=${this.#toggleMicrophone}
          ></svk-toggle>
          ${this.presentation
            ? nothing
            : html`<svk-device-menu
                .label=${LABELS.chooseMicrophone}
                .options=${this.devices.microphone}
                .currentId=${this.currentDevice.microphone}
                .selectChecked=${true}
                .onSelect=${this.#selectMicrophone}
                .onOpen=${this.onOpenDevices}
              ></svk-device-menu>`}
        </div>
        ${this.devices.speaker.length > 0 && !this.presentation
          ? html`<svk-device-menu
              class="svk-toolbar-standard"
              .label=${LABELS.chooseSpeaker}
              .caption=${LABELS.speaker}
              .icon=${soundIcon()}
              .options=${this.devices.speaker}
              .currentId=${this.currentSpeaker}
              .selectChecked=${true}
              .onSelect=${this.#selectSpeaker}
              .onOpen=${this.onOpenDevices}
            ></svk-device-menu>`
          : nothing}
        <div class="svk-control-group svk-toolbar-standard" ?hidden=${chromeHidden}>
          <svk-toggle
            data-kind="camera"
            .label=${LABELS.camera}
            .pressed=${this.media.camera}
            .busy=${this.busy.camera}
            .describedBy=${describedBy(this.#id, this.problems, "camera")}
            .iconOn=${cameraIcon()}
            .iconOff=${cameraOffIcon()}
            .onPress=${this.#toggleCamera}
          ></svk-toggle>
          ${this.presentation
            ? nothing
            : html`<svk-device-menu
                .label=${LABELS.chooseCamera}
                .options=${this.devices.camera}
                .currentId=${this.currentDevice.camera}
                .selectChecked=${true}
                .onSelect=${this.#selectCamera}
                .onOpen=${this.onOpenDevices}
              ></svk-device-menu>`}
        </div>
        ${this.canShareScreen
          ? html`<svk-toggle
              class="svk-toolbar-standard"
              data-kind="screen"
              ?hidden=${chromeHidden}
              .label=${LABELS.shareScreen}
              .pressed=${this.screenOn}
              .busy=${this.screenBusy}
              .iconOn=${shareScreenIcon()}
              .iconOff=${shareScreenIcon()}
              .onPress=${this.#toggleScreen}
            ></svk-toggle>`
          : nothing}
        ${this.shareOnStage
          ? html`<button
              type="button"
              class="svk-button svk-fullscreen-trigger"
              title=${fullScreenLabel}
              aria-label=${fullScreenLabel}
              @click=${this.#togglePresentation}
            >
              ${this.presentation ? exitFullScreenIcon() : fullScreenIcon()}<span class="svk-label"
                >${fullScreenLabel}</span
              >
            </button>`
          : nothing}
        ${this.presentation
          ? html`<button
              type="button"
              class="svk-button svk-show-controls-trigger"
              title=${LABELS.showControls}
              aria-label=${LABELS.showControls}
              aria-pressed=${this.controlsRevealed ? "true" : "false"}
              @click=${this.#toggleShowControls}
            >
              ${showControlsIcon()}<span class="svk-label">${LABELS.showControls}</span>
            </button>`
          : nothing}
        <button
          type="button"
          class="svk-button svk-participants-trigger svk-toolbar-standard"
          ?hidden=${chromeHidden}
          aria-expanded=${this.participantsOpen ? "true" : "false"}
          aria-controls=${ifDefined(this.participantsOpen ? this.participantsId : undefined)}
          title=${participants}
          @click=${this.#toggleParticipants}
        >
          ${peopleIcon()}<span class="svk-label">${participants}</span
          ><span class="svk-count" aria-hidden="true">${this.participantCount}</span>
        </button>
        ${this.soundBlocked && !this.presentation
          ? html`<button type="button" class="svk-button svk-button-accent" @click=${this.#turnOnSound}>
              ${soundIcon()}<span class="svk-text">${LABELS.turnOnSound}</span>
            </button>`
          : nothing}
        <button
          type="button"
          class="svk-button svk-button-danger svk-toolbar-standard"
          ?hidden=${chromeHidden}
          aria-busy=${this.leaving ? "true" : "false"}
          title=${LABELS.leave}
          @click=${this.#leave}
        >
          ${leaveIcon()}<span class="svk-label">${LABELS.leave}</span>
        </button>
        ${this.canEndMeeting && !this.presentation
          ? html`<button
              type="button"
              class="svk-button svk-button-danger svk-end-meeting-trigger"
              title=${LABELS.endMeeting}
              @click=${this.#endMeeting}
            >
              ${endMeetingIcon()}<span class="svk-label">${LABELS.endMeeting}</span>
            </button>`
          : nothing}
      </div>
    </div>`;
  }

  #toggleMicrophone = (): void => this.onToggle?.("microphone");
  #toggleCamera = (): void => this.onToggle?.("camera");
  #toggleScreen = (): void => this.onToggleScreen?.();
  #togglePresentation = (): void => this.onTogglePresentation?.();
  #toggleShowControls = (): void => this.onToggleShowControls?.();
  #retry = (kind: DeviceKind): void => this.onRetry?.(kind);
  #dismissDevice = (kind: DeviceKind, hadFocus: boolean): void => this.onDismissDevice?.(kind, hadFocus);
  #selectMicrophone = (option: DeviceOption): void => this.onSelectDevice?.("microphone", option);
  #selectCamera = (option: DeviceOption): void => this.onSelectDevice?.("camera", option);
  #selectSpeaker = (option: DeviceOption): void => this.onSelectSpeaker?.(option);
  #toggleParticipants = (): void => this.onToggleParticipants?.();
  #turnOnSound = (): void => this.onTurnOnSound?.();

  #leave = (): void => {
    if (!this.leaving) this.onLeave?.();
  };

  #endMeeting = (): void => {
    this.onEndMeeting?.();
  };
}
