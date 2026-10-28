import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { LABELS, shownText } from "../copy.js";
import type { CatalogueCopy, DeviceKind, PerKind } from "../copy.js";
import { cameraIcon, cameraOffIcon, microphoneIcon, microphoneOffIcon } from "../icons.js";
import { createAudioLevelMeter, isSpeaking, type AudioLevelMeter } from "../media/audioLevel.js";
import { NO_DEVICES, type DeviceLists } from "../media/deviceStore.js";
import { NO_PROBLEMS, describedBy, deviceMessages, type DeviceProblems } from "./device-messages.js";
import { uniqueId } from "./ids.js";
import type { SvkToggle } from "./svk-toggle.js";
import { streamVideo } from "./svk-video-tile.js";

const NO_STREAMS: PerKind<MediaStream | null> = Object.freeze({ camera: null, microphone: null });
const NO_CURRENT_DEVICE: PerKind<string | null> = Object.freeze({ camera: null, microphone: null });
const NOT_PRESSED: PerKind<boolean> = Object.freeze({ camera: false, microphone: false });
const MESSAGE_ORDER: readonly DeviceKind[] = ["camera", "microphone"];

/** The pre-join screen: self-preview, microphone indicator, device toggles, and the Join button. */
export class SvkPrejoin extends LitElement {
  static override properties = {
    streams: { attribute: false },
    pressed: { attribute: false },
    busy: { attribute: false },
    problems: { attribute: false },
    devices: { attribute: false },
    currentDevice: { attribute: false },
    joining: { attribute: false },
    canJoin: { attribute: false },
    joinError: { attribute: false },
    onToggle: { attribute: false },
    onRetry: { attribute: false },
    onDismissDevice: { attribute: false },
    onSelectDevice: { attribute: false },
    onJoin: { attribute: false },
  };

  declare streams: PerKind<MediaStream | null>;
  declare pressed: PerKind<boolean>;
  /** Devices being tried again; their toggles ignore presses until the attempt settles. */
  declare busy: PerKind<boolean>;
  declare problems: DeviceProblems;
  declare devices: DeviceLists;
  /** The device shown as selected in each list; `null` selects the first. */
  declare currentDevice: PerKind<string | null>;
  declare joining: boolean;
  /** False until the meeting session is ready to join. */
  declare canJoin: boolean;
  /** Why the last join attempt failed, while the participant can try again. */
  declare joinError: CatalogueCopy | null;
  declare onToggle: ((kind: DeviceKind) => void) | null;
  declare onRetry: ((kind: DeviceKind) => void) | null;
  /** Called when a device message is dismissed, with whether its Dismiss button had focus. */
  declare onDismissDevice: ((kind: DeviceKind, hadFocus: boolean) => void) | null;
  declare onSelectDevice: ((kind: DeviceKind, deviceId: string) => void) | null;
  declare onJoin: (() => void) | null;

  readonly #id = uniqueId("svk-prejoin");
  #meter: AudioLevelMeter | null = null;
  #meterStream: MediaStream | null = null;
  #level = 0;

  constructor() {
    super();
    this.streams = NO_STREAMS;
    this.pressed = NOT_PRESSED;
    this.busy = NOT_PRESSED;
    this.problems = NO_PROBLEMS;
    this.devices = NO_DEVICES;
    this.currentDevice = NO_CURRENT_DEVICE;
    this.joining = false;
    this.canJoin = false;
    this.joinError = null;
    this.onToggle = null;
    this.onRetry = null;
    this.onDismissDevice = null;
    this.onSelectDevice = null;
    this.onJoin = null;
  }

  /** Moves focus to the `kind` toggle once it has rendered. */
  async focusDevice(kind: DeviceKind): Promise<void> {
    await this.updateComplete;
    const toggle = this.querySelector<SvkToggle>(`svk-toggle[data-kind="${kind}"]`);
    await toggle?.updateComplete;
    toggle?.focus();
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
    this.#closeMeter();
  }

  protected override updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    const stream = this.streams.microphone;
    if (stream === this.#meterStream && (this.#meter !== null || stream === null)) return;
    this.#closeMeter();
    this.#meterStream = stream;
    if (!stream) return;
    this.#meter = createAudioLevelMeter(stream, (level) => {
      this.#level = level;
      this.requestUpdate();
    });
  }

  protected override render(): TemplateResult {
    const joinDisabled = this.joining || !this.canJoin;
    return html`<section class="svk-prejoin" aria-label=${LABELS.setupRegion}>
      <h2 class="svk-heading">${LABELS.readyToJoin}</h2>
      <div class="svk-preview">
        ${this.streams.camera
          ? streamVideo(this.streams.camera, true)
          : html`<div class="svk-preview-off">
              ${cameraOffIcon()}<span class="svk-text">${LABELS.cameraOff}</span>
            </div>`}
        ${this.streams.microphone ? this.#renderMeter() : nothing}
      </div>
      <div class="svk-prejoin-toggles">
        <svk-toggle
          data-kind="camera"
          .label=${LABELS.camera}
          .pressed=${this.pressed.camera}
          .busy=${this.busy.camera}
          .describedBy=${describedBy(this.#id, this.problems, "camera")}
          .iconOn=${cameraIcon()}
          .iconOff=${cameraOffIcon()}
          .onPress=${this.#toggleCamera}
        ></svk-toggle>
        <svk-toggle
          data-kind="microphone"
          .label=${LABELS.microphone}
          .pressed=${this.pressed.microphone}
          .busy=${this.busy.microphone}
          .describedBy=${describedBy(this.#id, this.problems, "microphone")}
          .iconOn=${microphoneIcon()}
          .iconOff=${microphoneOffIcon()}
          .onPress=${this.#toggleMicrophone}
        ></svk-toggle>
      </div>
      ${deviceMessages(this.#id, this.problems, MESSAGE_ORDER, this.#retry, this.#dismissDevice)}
      <div class="svk-fields">${this.#renderSelect("camera")}${this.#renderSelect("microphone")}</div>
      <div class="svk-join-error" role="alert">${this.#renderJoinError(joinDisabled)}</div>
      <button
        type="button"
        class="svk-button svk-button-primary svk-join"
        aria-busy=${this.joining ? "true" : "false"}
        aria-disabled=${joinDisabled ? "true" : "false"}
        @click=${this.#join}
      >
        ${this.joining ? LABELS.joining : LABELS.join}
      </button>
    </section>`;
  }

  #renderSelect(kind: DeviceKind): TemplateResult | typeof nothing {
    const options = this.devices[kind];
    if (options.length === 0) return nothing;
    const id = `${this.#id}-${kind}-device`;
    const current = this.currentDevice[kind] ?? options[0]?.deviceId;
    return html`<label class="svk-field" for=${id}>
      <span class="svk-text">${kind === "camera" ? LABELS.cameraDevice : LABELS.microphoneDevice}</span>
      <select id=${id} class="svk-select" @change=${kind === "camera" ? this.#selectCamera : this.#selectMicrophone}>
        ${repeat(
          options,
          (option) => option.deviceId,
          (option) =>
            html`<option
              class="svk-option"
              value=${option.deviceId}
              .selected=${option.deviceId === current}
              .textContent=${option.label}
            ></option>`,
        )}
      </select>
    </label>`;
  }

  /** The alert stays in the page, so a message added to it after a failed join is announced. */
  #renderJoinError(joinDisabled: boolean): TemplateResult | typeof nothing {
    if (!this.joinError) return nothing;
    return html`<p class="svk-join-error-text">${shownText(this.joinError)}</p>
      ${this.joinError.retry
        ? html`<button
            type="button"
            class="svk-button svk-button-small"
            aria-disabled=${joinDisabled ? "true" : "false"}
            @click=${this.#join}
          >
            ${LABELS.tryAgain}
          </button>`
        : nothing}`;
  }

  #renderMeter(): TemplateResult {
    const level = this.#meter ? this.#level : 0;
    return html`<div class="svk-meter-row">
      <div class="svk-meter" aria-hidden="true">
        <div class="svk-meter-fill" style=${styleMap({ transform: `scaleX(${level.toFixed(2)})` })}></div>
      </div>
      ${isSpeaking(level) ? html`<span class="svk-meter-text">${LABELS.pickingUpSound}</span>` : nothing}
    </div>`;
  }

  #closeMeter(): void {
    this.#meter?.close();
    this.#meter = null;
    this.#meterStream = null;
    this.#level = 0;
  }

  #selectCamera = (event: Event): void => {
    this.onSelectDevice?.("camera", (event.target as HTMLSelectElement).value);
  };

  #selectMicrophone = (event: Event): void => {
    this.onSelectDevice?.("microphone", (event.target as HTMLSelectElement).value);
  };

  #toggleCamera = (): void => this.onToggle?.("camera");
  #toggleMicrophone = (): void => this.onToggle?.("microphone");
  #retry = (kind: DeviceKind): void => this.onRetry?.(kind);
  #dismissDevice = (kind: DeviceKind, hadFocus: boolean): void => this.onDismissDevice?.(kind, hadFocus);

  #join = (): void => {
    if (!this.joining && this.canJoin) this.onJoin?.();
  };
}
