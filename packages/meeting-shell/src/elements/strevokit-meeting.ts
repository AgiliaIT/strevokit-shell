import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import type { MeetingEngine, MeetingErrorCode, MeetingLogger, Participant } from "@strevokit/meeting-sdk";
import {
  ANNOUNCEMENTS,
  CONNECTION_BANNER,
  END_MEETING_FAILED,
  blocksDevice,
  deviceCopy,
  deviceMessage,
  deviceProblemFromCode,
  finalState,
  joinError,
  meetingErrorRoute,
  screenShareNotice,
  shownText,
} from "../copy.js";
import type { BannerVariant, CatalogueCopy, DeviceKind, DeviceProblem, PerKind } from "../copy.js";
import { DEFAULT_REALTIME_URL } from "../defaults.js";
import { defineOnce } from "../define.js";
import { ConnectionBanner, type BannerEffect } from "../errors/connectionBanner.js";
import { reportFailure, reportRecovery } from "../errors/diagnostics.js";
import { MeetingNotices } from "../errors/meetingNotices.js";
import { getEngineFactory } from "../engine/engineFactory.js";
import { MeetingStoreController } from "../engine/MeetingStoreController.js";
import { createMeetingStore, displayName, type MeetingStore } from "../engine/meetingStore.js";
import { hasDevice, permissionState, streamDeviceId, watchDevice } from "../media/capture.js";
import {
  NO_CHOICE,
  loadDeviceChoice,
  resolveDevice,
  saveDeviceChoice,
  savedDevice,
  type DeviceChoice,
  type DeviceOption,
} from "../media/deviceStore.js";
import { DevicesController } from "../media/DevicesController.js";
import { PreviewController, type KindPreview } from "../media/PreviewController.js";
import type {
  MeetingShellAppearance,
  MeetingShellCloseReason,
  MeetingShellEventMap,
} from "../types.js";
import { NO_PROBLEMS, type DeviceProblems } from "./device-messages.js";
import { mayTakeFocus } from "./focus.js";
import { SvkAnnouncer } from "./svk-announcer.js";
import { SvkControlBar } from "./svk-control-bar.js";
import { SvkDeviceMenu } from "./svk-device-menu.js";
import { SvkEndMeetingDialog } from "./svk-end-meeting-dialog.js";
import { SvkFinalState } from "./svk-final-state.js";
import { SvkMeetingMessage, type MeetingMessageView } from "./svk-meeting-message.js";
import { SvkParticipantList } from "./svk-participant-list.js";
import { SvkPrejoin } from "./svk-prejoin.js";
import { SvkRoom } from "./svk-room.js";
import { SvkToggle } from "./svk-toggle.js";
import { SvkVideoTile } from "./svk-video-tile.js";

type Phase = "idle" | "prejoin" | "joining" | "in_meeting" | "final";

interface Session {
  readonly engine: MeetingEngine;
  readonly store: MeetingStore;
  readonly unsubscribe: () => void;
}

interface Settings {
  readonly token: string;
  readonly realtimeUrl: string;
}

const APPEARANCES: readonly MeetingShellAppearance[] = ["light", "dark", "system"];
const KINDS: readonly DeviceKind[] = ["microphone", "camera"];
const ALL_ON: PerKind<boolean> = Object.freeze({ camera: true, microphone: true });
const ALL_OFF: PerKind<boolean> = Object.freeze({ camera: false, microphone: false });
/** Engine media failures explained next to the device's toggle; other failures just leave the toggle as it was. */
const MEDIA_PROBLEM_CODES: ReadonlySet<string> = new Set<MeetingErrorCode>([
  "permission_denied",
  "device_not_found",
  "device_unavailable",
  "unsupported_environment",
]);

function appearanceOf(value: unknown): MeetingShellAppearance {
  return APPEARANCES.includes(value as MeetingShellAppearance) ? (value as MeetingShellAppearance) : "system";
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "protocol_error";
}

function errorRetryable(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "retryable" in error && typeof error.retryable === "boolean") {
    return error.retryable;
  }
  return true;
}

/** The code reported for a device problem found by the shell itself rather than by an engine call. */
const PROBLEM_CODES: Record<DeviceProblem, string> = {
  permission_denied: "permission_denied",
  not_found: "device_not_found",
  in_use: "device_unavailable",
  disconnected: "device_disconnected",
  unsupported: "unsupported_environment",
};

/** The preview's problem; while a retry is in flight, the problem from before it. */
function previewProblem(preview: KindPreview): DeviceProblem | null {
  const { status } = preview;
  if (status === "idle" || status === "requesting" || status === "ready") return preview.held ?? null;
  return status;
}

function previewRetrying(preview: KindPreview): boolean {
  return preview.status === "requesting" && Boolean(preview.held);
}

/** Turns `kind` on, from `deviceId` when given, otherwise from the browser default device. */
function turnOn(engine: MeetingEngine, kind: DeviceKind, deviceId: string | undefined): Promise<void> {
  const options = deviceId ? { deviceId } : undefined;
  return kind === "camera" ? engine.enableCamera(options) : engine.unmute(options);
}

function turnOff(engine: MeetingEngine, kind: DeviceKind): Promise<void> {
  return kind === "camera" ? engine.disableCamera() : engine.mute();
}

defineOnce("svk-announcer", SvkAnnouncer);
defineOnce("svk-toggle", SvkToggle);
defineOnce("svk-video-tile", SvkVideoTile);
defineOnce("svk-device-menu", SvkDeviceMenu);
defineOnce("svk-control-bar", SvkControlBar);
defineOnce("svk-participant-list", SvkParticipantList);
defineOnce("svk-meeting-message", SvkMeetingMessage);
defineOnce("svk-prejoin", SvkPrejoin);
defineOnce("svk-room", SvkRoom);
defineOnce("svk-final-state", SvkFinalState);
defineOnce("svk-end-meeting-dialog", SvkEndMeetingDialog);

/**
 * `<strevokit-meeting>`: a complete meeting UI for one participant. It stays idle until it is in the page and has a
 * `token` (property only) and a realtime URL, then shows the pre-join screen. Removing it from the page leaves the
 * meeting and releases the camera and microphone.
 *
 * @example
 * ```html
 * <strevokit-meeting id="meeting" realtime-url="wss://realtime.example.com"></strevokit-meeting>
 * <script type="module">
 *   document.getElementById("meeting").token = tokenFromYourBackend;
 * </script>
 * ```
 */
export class StrevokitMeetingElement extends LitElement {
  static override properties = {
    appearance: { type: String, reflect: true },
    realtimeUrl: { type: String, attribute: "realtime-url" },
    token: { attribute: false, noAccessor: true },
    logger: { attribute: false },
    hideEndMeeting: { type: Boolean, attribute: "hide-end-meeting", reflect: true },
  };

  /** Colour appearance: `"light"`, `"dark"`, or `"system"` (the default). Unknown values fall back to `"system"`. */
  declare appearance: MeetingShellAppearance;
  /** Realtime service URL, for example `wss://realtime.example.com`. Also settable as the `realtime-url` attribute. */
  declare realtimeUrl: string | null;
  /** Optional diagnostics sink, passed to the meeting engine. It never receives the join token. */
  declare logger: MeetingLogger | null;
  /** Whether to hide the End meeting button from hosts. */
  declare hideEndMeeting: boolean;

  #token: string | null = null;
  #phase: Phase = "idle";
  #configuration: string | null = null;
  #settings: Settings | null = null;
  #session: Session | null = null;
  #closed: { readonly reason: MeetingShellCloseReason; readonly code?: string } | null = null;
  #closedSent = false;
  #generation = 0;
  #warnedNoUrl = false;
  #endMeetingOpen = false;
  #endMeetingBusy = false;
  /** Which devices the participant wants on when joining. */
  #wanted: PerKind<boolean> = ALL_ON;
  #busy: PerKind<boolean> = ALL_OFF;
  /** Whether starting or stopping the screen share is in flight. */
  #screenBusy = false;
  #leaving: Promise<void> | null = null;
  #focusAfterJoin = false;
  /** The camera and microphone state last announced, or `null` until the join handoff is over. */
  #announcedMedia: PerKind<boolean> | null = null;
  /** The screen share state last announced, set and cleared together with `#announcedMedia`. */
  #announcedScreen = false;
  /** Devices the participant is turning off themselves, so the change is announced as their choice. */
  #turnedOff: PerKind<boolean> = ALL_OFF;
  /** Why the last join attempt failed, shown on the pre-join screen until the next attempt. */
  #joinFailure: CatalogueCopy | null = null;
  /** Why each device can't be used in the meeting, explained next to the controls. */
  #problems: DeviceProblems = NO_PROBLEMS;
  /** The pre-join preview problems last reported to `logger`, so a message that stays up is reported once. */
  #reportedPreview: DeviceProblems = NO_PROBLEMS;
  /**
   * The problem whose message the participant dismissed, per device. The message stays hidden while that problem
   * remains, until the participant presses the toggle or "Try … again", or the session ends.
   */
  #dismissed: DeviceProblems = NO_PROBLEMS;
  /** Stops watching each device for a permission or device change, while it has a problem a retry can fix. */
  readonly #watches: Record<DeviceKind, (() => void) | null> = { camera: null, microphone: null };
  /** The remembered camera and microphone, loaded when a meeting session starts. */
  #choice: DeviceChoice = NO_CHOICE;
  /** The streams last seen, so the device lists are refreshed once permission brings real labels. */
  #streamsSeen = "";
  /** The connection banner for the meeting, from joining until leaving starts or the session ends. */
  #banner: ConnectionBanner | null = null;
  #bannerVariant: BannerVariant | null = null;
  /** The notice slot for the meeting, with the same lifetime as the banner. */
  #notices: MeetingNotices | null = null;
  #notice: CatalogueCopy | null = null;
  #stopWatchingNetwork: (() => void) | null = null;
  readonly #meeting = new MeetingStoreController(this);
  readonly #preview = new PreviewController(this);
  readonly #devices = new DevicesController(this);

  constructor() {
    super();
    this.appearance = "system";
    this.realtimeUrl = null;
    this.logger = null;
    this.hideEndMeeting = false;
  }

  /** Join token issued by your backend for this participant. Property only: there is no `token` attribute. */
  get token(): string | null {
    return this.#token;
  }

  set token(value: string | null) {
    const previous = this.#token;
    this.#token = typeof value === "string" && value !== "" ? value : null;
    this.requestUpdate("token", previous);
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#reflectAppearance();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    // Moving the element within one task (as frameworks do when they reorder nodes) keeps the meeting.
    queueMicrotask(() => {
      if (!this.isConnected) this.#endSession();
    });
  }

  /**
   * Leaves the meeting and shows the final screen. Resolves once the final screen has rendered. Does nothing unless
   * the participant is in the meeting.
   */
  leave(): Promise<void> {
    const session = this.#session;
    if (this.#leaving) return this.#leaving;
    if (!session || this.#phase !== "in_meeting") return Promise.resolve();
    const generation = this.#generation;
    let done!: () => void;
    const leaving = new Promise<void>((resolve) => (done = resolve));
    this.#leaving = leaving;
    this.#stopMeetingMessages();
    this.requestUpdate();
    void session.engine
      .leave()
      .catch(() => {})
      .then(async () => {
        if (generation !== this.#generation) return;
        this.#finish("left");
        await this.updateComplete;
      })
      .then(done);
    return leaving;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("appearance")) this.#reflectAppearance();
    this.#configure();
    this.#announceMediaChanges();
    this.#devices.sync(this.#session !== null && this.#phase !== "final");
    this.#refreshDevicesOnNewStreams();
    const active = this.#session !== null && (this.#phase === "prejoin" || this.#phase === "joining");
    this.#preview.sync({
      camera: { active, wanted: this.#wanted.camera, deviceId: this.#previewDevice("camera") },
      microphone: { active, wanted: this.#wanted.microphone, deviceId: this.#previewDevice("microphone") },
    });
    this.#reportPreviewProblems();
    this.#forgetWorkingDismissals();
    this.#syncWatches();
  }

  /** Why each device can't be used now: the preview's problem before joining, the meeting's problem after. */
  #currentProblems(): DeviceProblems {
    if (this.#phase === "in_meeting") return this.#problems;
    if (this.#phase !== "prejoin" && this.#phase !== "joining") return NO_PROBLEMS;
    return { camera: previewProblem(this.#preview.camera), microphone: previewProblem(this.#preview.microphone) };
  }

  /** The problems whose messages are shown: every current problem except the dismissed ones. */
  #shownProblems(problems: DeviceProblems): DeviceProblems {
    const shown = (kind: DeviceKind): DeviceProblem | null =>
      problems[kind] !== null && problems[kind] === this.#dismissed[kind] ? null : problems[kind];
    return { camera: shown("camera"), microphone: shown("microphone") };
  }

  /** A preview that works again forgets its dismissed message, so a later problem is shown. */
  #forgetWorkingDismissals(): void {
    if (this.#phase !== "prejoin" && this.#phase !== "joining") return;
    for (const kind of KINDS) {
      if (this.#dismissed[kind] && this.#preview[kind].status === "ready") this.#undismiss(kind);
    }
  }

  #undismiss(kind: DeviceKind): void {
    if (!this.#dismissed[kind]) return;
    this.#dismissed = { ...this.#dismissed, [kind]: null };
    this.requestUpdate();
  }

  /** Watches each device whose problem a retry can fix, and stops watching once the problem is gone. */
  #syncWatches(): void {
    const problems = this.#currentProblems();
    for (const kind of KINDS) {
      const problem = problems[kind];
      const watch = this.isConnected && problem !== null && deviceCopy(kind, problem).retry;
      const stop = this.#watches[kind];
      if (watch && !stop) this.#watches[kind] = watchDevice(kind, () => void this.#recover(kind));
      else if (!watch && stop) {
        stop();
        this.#watches[kind] = null;
      }
    }
  }

  #stopWatches(): void {
    for (const kind of KINDS) {
      this.#watches[kind]?.();
      this.#watches[kind] = null;
    }
  }

  /**
   * After the `kind` permission or the connected devices changed: captures the preview again before joining. In the
   * meeting, only clears a problem that is now fixed, so a device never goes live without the participant asking.
   */
  async #recover(kind: DeviceKind): Promise<void> {
    const generation = this.#generation;
    const state = await permissionState(kind);
    const current = (): boolean => generation === this.#generation && this.isConnected;
    if (!current() || state === "denied") return;
    if (this.#phase === "prejoin") {
      const preview = this.#preview[kind];
      if (previewProblem(preview) && !previewRetrying(preview)) this.#preview.retry(kind);
      return;
    }
    if (this.#phase !== "in_meeting" || this.#leaving) return;
    const problem = this.#problems[kind];
    if (problem === "not_found" || problem === "disconnected") {
      if (!(await hasDevice(kind)) || !current() || this.#phase !== "in_meeting" || this.#leaving) return;
    } else if (problem !== "permission_denied") {
      return;
    }
    if (this.#problems[kind] === problem) this.#setProblem(kind, null);
  }

  #dismissDevice = (kind: DeviceKind, hadFocus: boolean): void => {
    const problem = this.#currentProblems()[kind];
    if (!problem) return;
    this.#dismissed = { ...this.#dismissed, [kind]: problem };
    this.requestUpdate();
    if (!hadFocus) return;
    void this.updateComplete.then(() => {
      if (!mayTakeFocus(this)) return;
      if (this.#phase === "in_meeting") void this.querySelector<SvkRoom>("svk-room")?.focusDevice(kind);
      else void this.querySelector<SvkPrejoin>("svk-prejoin")?.focusDevice(kind);
    });
  };

  #reportPreviewProblems(): void {
    const phase = this.#phase;
    if (phase !== "prejoin" && phase !== "joining") return;
    for (const kind of KINDS) {
      const problem = previewProblem(this.#preview[kind]);
      if (this.#reportedPreview[kind] === problem) continue;
      this.#reportedPreview = { ...this.#reportedPreview, [kind]: problem };
      if (problem) this.#reportDeviceProblem(kind, problem, phase, PROBLEM_CODES[problem]);
    }
  }

  #reportDeviceProblem(
    kind: DeviceKind,
    problem: DeviceProblem,
    phase: "prejoin" | "joining" | "in_meeting",
    code: string,
  ): void {
    if (!this.isConnected) return;
    reportFailure(this.logger, { surface: "device", phase, code, kind, retry: deviceCopy(kind, problem).retry });
  }

  /** The remembered device of `kind` among the devices listed now, or `null` for the browser default. */
  #resolvedDevice(kind: DeviceKind): string | null {
    return resolveDevice(this.#devices.lists[kind], this.#choice[kind]);
  }

  /** The device to turn on in the meeting; `undefined` uses the browser default. */
  #chosenDevice(kind: DeviceKind): string | undefined {
    return this.#resolvedDevice(kind) ?? undefined;
  }

  /**
   * The device to preview. Keeping the remembered ID when nothing listed matches avoids restarting a preview that
   * already fell back to the default device.
   */
  #previewDevice(kind: DeviceKind): string | null {
    return this.#resolvedDevice(kind) ?? this.#choice[kind]?.deviceId ?? null;
  }

  #refreshDevicesOnNewStreams(): void {
    const local = this.#meeting.snapshot.localMedia;
    const streams = [this.#preview.camera.stream, this.#preview.microphone.stream, local.camera, local.microphone]
      .map((stream) => stream?.id ?? "")
      .join("|");
    if (streams === this.#streamsSeen) return;
    this.#streamsSeen = streams;
    this.#devices.refresh();
  }

  protected override updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    if (!this.#focusAfterJoin) return;
    this.#focusAfterJoin = false;
    const room = this.querySelector<SvkRoom>("svk-room");
    if (room && mayTakeFocus(this)) void room.focusMicrophone();
  }

  protected override render(): TemplateResult | typeof nothing {
    if (this.#phase === "idle") return nothing;
    return html`<div class="svk-meeting">${this.#renderPhase()}<svk-announcer></svk-announcer></div>`;
  }

  #renderPhase(): TemplateResult {
    if (this.#phase === "final" && this.#closed) {
      return html`<svk-final-state .reason=${this.#closed.reason} .code=${this.#closed.code}></svk-final-state>`;
    }
    if (this.#phase === "in_meeting") {
      const media = this.#meeting.snapshot.localMediaState;
      const isHost = this.#session?.engine.self?.role === "host";
      const canEndMeeting = isHost && !this.hideEndMeeting;
      const canShareScreen = isHost;
      return html`<svk-room
        .participants=${this.#meeting.snapshot.participants}
        .media=${{ camera: media.camera, microphone: media.microphone }}
        .busy=${this.#busy}
        .screenOn=${media.screen}
        .screenBusy=${this.#screenBusy}
        .canShareScreen=${canShareScreen}
        .onToggleScreen=${this.#toggleScreen}
        .problems=${this.#shownProblems(this.#problems)}
        .devices=${this.#devices.lists}
        .currentDevice=${{
          camera: streamDeviceId(this.#meeting.snapshot.localMedia.camera) ?? this.#resolvedDevice("camera"),
          microphone: streamDeviceId(this.#meeting.snapshot.localMedia.microphone) ?? this.#resolvedDevice("microphone"),
        }}
        .leaving=${this.#leaving !== null}
        .message=${this.#meetingMessage()}
        .onToggle=${this.#toggleInMeeting}
        .onRetry=${this.#retryInMeeting}
        .onDismissDevice=${this.#dismissDevice}
        .onSelectDevice=${this.#selectInMeeting}
        .onLeave=${this.#leaveFromToolbar}
        .onDismissMessage=${this.#dismissNotice}
        .canEndMeeting=${canEndMeeting}
        .onEndMeeting=${this.#openEndMeeting}
      ></svk-room>
      ${this.#endMeetingOpen
        ? html`<svk-end-meeting-dialog
            .busy=${this.#endMeetingBusy}
            .onConfirm=${this.#confirmEndMeeting}
            .onCancel=${this.#cancelEndMeeting}
          ></svk-end-meeting-dialog>`
        : nothing}`;
    }
    const camera = this.#preview.camera;
    const microphone = this.#preview.microphone;
    const problems = { camera: previewProblem(camera), microphone: previewProblem(microphone) };
    return html`<svk-prejoin
      .streams=${{ camera: camera.stream, microphone: microphone.stream }}
      .pressed=${{
        camera: this.#wanted.camera && !blocksDevice(problems.camera),
        microphone: this.#wanted.microphone && !blocksDevice(problems.microphone),
      }}
      .busy=${{ camera: previewRetrying(camera), microphone: previewRetrying(microphone) }}
      .problems=${this.#shownProblems(problems)}
      .devices=${this.#devices.lists}
      .currentDevice=${{
        camera: this.#resolvedDevice("camera") ?? streamDeviceId(camera.stream),
        microphone: this.#resolvedDevice("microphone") ?? streamDeviceId(microphone.stream),
      }}
      .joining=${this.#phase === "joining"}
      .canJoin=${this.#session !== null && this.#phase === "prejoin"}
      .joinError=${this.#joinFailure}
      .onToggle=${this.#toggleBeforeJoin}
      .onRetry=${this.#retryBeforeJoin}
      .onDismissDevice=${this.#dismissDevice}
      .onSelectDevice=${this.#selectBeforeJoin}
      .onJoin=${this.#joinFromPrejoin}
    ></svk-prejoin>`;
  }

  /** The one meeting-level message above the tiles; nothing while leaving or outside the meeting. */
  #meetingMessage(): MeetingMessageView | null {
    if (this.#phase !== "in_meeting" || this.#leaving) return null;
    const variant = this.#bannerVariant;
    if (variant) {
      const failed = variant === "failed_reconnect" || variant === "failed_connect";
      return { type: "banner", tone: failed ? "danger" : "warning", text: shownText(CONNECTION_BANNER[variant]) };
    }
    return this.#notice ? { type: "notice", text: shownText(this.#notice) } : null;
  }

  /** Starts the connection banner and the notice slot for the meeting `engine` has just joined. */
  #startMeetingMessages(engine: MeetingEngine): void {
    this.#stopMeetingMessages();
    const generation = this.#generation;
    const live = (): boolean =>
      generation === this.#generation && this.isConnected && this.#phase === "in_meeting" && !this.#leaving;
    const notices = new MeetingNotices({
      onChange: (copy) => {
        if (!live()) return;
        this.#notice = copy;
        this.requestUpdate();
      },
      shown: (code, copy) => {
        if (!live()) return;
        this.#announce(shownText(copy));
        reportFailure(this.logger, { surface: "notice", phase: "in_meeting", code });
      },
    });
    const banner = new ConnectionBanner({
      onChange: (variant) => {
        if (!live()) return;
        this.#bannerVariant = variant;
        notices.setHidden(variant !== null);
        this.requestUpdate();
      },
      announce: (text) => {
        if (live()) this.#announce(text);
      },
      report: (effect) => {
        if (live()) this.#reportBanner(effect);
      },
    });
    for (const other of engine.participants) {
      if (other.id !== engine.self?.id) banner.participantStatus(other.id, engine.mediaConnectionStatus(other.id));
    }
    banner.network(typeof navigator === "undefined" || navigator.onLine !== false);
    const view = this.ownerDocument.defaultView;
    const onNetwork = (event: Event): void => banner.network(event.type === "online");
    view?.addEventListener("online", onNetwork);
    view?.addEventListener("offline", onNetwork);
    this.#banner = banner;
    this.#notices = notices;
    this.#stopWatchingNetwork = () => {
      view?.removeEventListener("online", onNetwork);
      view?.removeEventListener("offline", onNetwork);
    };
  }

  /** Hides the banner and the notice and stops watching the connection, silently. */
  #stopMeetingMessages(): void {
    this.#banner?.reset();
    this.#banner = null;
    this.#bannerVariant = null;
    this.#notices?.reset();
    this.#notices = null;
    this.#notice = null;
    this.#stopWatchingNetwork?.();
    this.#stopWatchingNetwork = null;
  }

  /** Shows an engine error reported during the meeting where the catalogue routes it. */
  #showMeetingError(error: unknown): void {
    const code = errorCode(error);
    const route = meetingErrorRoute(code);
    if (route.route === "notice") this.#notices?.report(code, route.copy);
  }

  #dismissNotice = (hadFocus: boolean): void => {
    if (!this.#notices) return;
    this.#notices.dismiss();
    if (!hadFocus) return;
    void this.updateComplete.then(() => {
      const room = this.querySelector<SvkRoom>("svk-room");
      if (room && mayTakeFocus(this)) void room.focusMicrophone();
    });
  };

  #reportBanner(effect: BannerEffect): void {
    if (effect.type === "recovery") reportRecovery(this.logger, effect.interruptedMs);
    else reportFailure(this.logger, { surface: "banner", phase: "in_meeting", code: effect.code });
  }

  #retryBeforeJoin = (kind: DeviceKind): void => {
    if (this.#phase !== "prejoin" || previewRetrying(this.#preview[kind])) return;
    this.#undismiss(kind);
    this.#wanted = { ...this.#wanted, [kind]: true };
    this.#preview.retry(kind);
  };

  #selectBeforeJoin = (kind: DeviceKind, deviceId: string): void => {
    const option = this.#devices.lists[kind].find((candidate) => candidate.deviceId === deviceId);
    this.#choice = saveDeviceChoice(kind, option ? savedDevice(option) : { deviceId, label: null });
    this.requestUpdate();
  };

  /** A blocked toggle whose message was dismissed tries the device again, which brings the message back if it fails. */
  #toggleBeforeJoin = (kind: DeviceKind): void => {
    if (this.#phase !== "prejoin") return;
    const problem = previewProblem(this.#preview[kind]);
    if (blocksDevice(problem)) {
      if (problem === this.#dismissed[kind]) this.#retryBeforeJoin(kind);
      return;
    }
    this.#wanted = { ...this.#wanted, [kind]: !this.#wanted[kind] };
    this.requestUpdate();
  };

  #joinFromPrejoin = (): void => {
    void this.#join();
  };

  #leaveFromToolbar = (): void => {
    void this.leave();
  };

  #openEndMeeting = (): void => {
    this.#endMeetingOpen = true;
    this.#endMeetingBusy = false;
    this.requestUpdate();
  };

  #cancelEndMeeting = (): void => {
    this.#endMeetingOpen = false;
    this.#endMeetingBusy = false;
    this.requestUpdate();
    void this.updateComplete.then(() => {
      if (mayTakeFocus(this)) void this.querySelector<SvkRoom>("svk-room")?.focusEndMeeting();
    });
  };

  #confirmEndMeeting = async (): Promise<void> => {
    if (this.#endMeetingBusy) return;
    this.#endMeetingBusy = true;
    this.requestUpdate();
    try {
      await this.#session?.engine.endMeeting();
    } catch {
      this.#endMeetingOpen = false;
      this.#endMeetingBusy = false;
      this.requestUpdate();
      this.#notices?.report("end_meeting_failed", { message: END_MEETING_FAILED, retry: false });
      void this.updateComplete.then(() => {
        if (mayTakeFocus(this)) void this.querySelector<SvkRoom>("svk-room")?.focusEndMeeting();
      });
    }
  };

  #toggleInMeeting = (kind: DeviceKind): void => {
    const engine = this.#session?.engine;
    if (!engine || this.#phase !== "in_meeting" || this.#busy[kind] || this.#leaving) return;
    if (!this.#meeting.snapshot.localMediaState[kind]) {
      const problem = this.#problems[kind];
      if (blocksDevice(problem)) {
        if (problem === this.#dismissed[kind]) this.#retryInMeeting(kind);
        return;
      }
      this.#undismiss(kind);
      const deviceId = this.#chosenDevice(kind);
      void this.#runMedia(kind, () => turnOn(engine, kind, deviceId));
      return;
    }
    this.#turnedOff = { ...this.#turnedOff, [kind]: true };
    void this.#runMedia(kind, () => turnOff(engine, kind)).then((done) => {
      if (!done) this.#turnedOff = { ...this.#turnedOff, [kind]: false };
    });
  };

  /** Starts or stops the screen share through the engine, never flipping the toggle before the engine confirms. */
  #toggleScreen = (): void => {
    const engine = this.#session?.engine;
    if (!engine || this.#phase !== "in_meeting" || this.#screenBusy || this.#leaving) return;
    const sharing = this.#meeting.snapshot.localMediaState.screen;
    void this.#runScreen(() => (sharing ? engine.stopScreenShare() : engine.startScreenShare()));
  };

  /** Runs a screen share request with its toggle busy. A failure shows a dismissible notice and leaves the meeting as it was. */
  async #runScreen(action: () => Promise<void>): Promise<void> {
    const generation = this.#generation;
    this.#setScreenBusy(true);
    try {
      await action();
    } catch (error) {
      if (generation === this.#generation && !this.#leaving && this.#phase === "in_meeting") {
        const code = errorCode(error);
        this.#notices?.report(`share_${code}`, screenShareNotice(code));
      }
    } finally {
      if (generation === this.#generation) this.#setScreenBusy(false);
    }
  }

  #setScreenBusy(busy: boolean): void {
    this.#screenBusy = busy;
    this.requestUpdate();
  }

  #retryInMeeting = (kind: DeviceKind): void => {
    const engine = this.#session?.engine;
    if (!engine || this.#phase !== "in_meeting" || this.#busy[kind] || this.#leaving) return;
    this.#undismiss(kind);
    const deviceId = this.#chosenDevice(kind);
    void this.#runMedia(kind, () => turnOn(engine, kind, deviceId));
  };

  /** Remembers the device; when that device kind is on, switches to it in place and announces the switch. */
  #selectInMeeting = (kind: DeviceKind, option: DeviceOption): void => {
    this.#choice = saveDeviceChoice(kind, savedDevice(option));
    this.requestUpdate();
    const engine = this.#session?.engine;
    if (!engine || this.#phase !== "in_meeting" || this.#busy[kind] || this.#leaving) return;
    if (!this.#meeting.snapshot.localMediaState[kind]) return;
    void this.#runMedia(kind, () => turnOn(engine, kind, option.deviceId)).then((done) => {
      if (done) this.#announce(ANNOUNCEMENTS.switchedTo(option.label));
    });
  };

  /**
   * Joins with the preview still running, so a failed join keeps it. Once joined, the preview is released before the
   * engine captures the devices the participant left on.
   */
  async #join(): Promise<void> {
    const session = this.#session;
    if (!session || this.#phase !== "prejoin") return;
    const { engine } = session;
    const generation = this.#generation;
    const handoff = KINDS.filter((kind) => this.#wanted[kind] && !blocksDevice(previewProblem(this.#preview[kind])));
    const handoffDevices = { camera: this.#chosenDevice("camera"), microphone: this.#chosenDevice("microphone") };
    this.#joinFailure = null;
    this.#phase = "joining";
    this.requestUpdate();
    try {
      await engine.join();
    } catch (error) {
      if (generation !== this.#generation) return;
      const code = errorCode(error);
      const failure = joinError(code, errorRetryable(error));
      if (failure.retry) {
        this.#joinFailure = failure;
        this.#replaceEngine();
        if (this.isConnected) reportFailure(this.logger, { surface: "join", phase: "joining", code, retry: true });
      } else if (code === "meeting_ended") {
        this.#finish("meeting_ended");
      } else {
        this.#finish("join_failed", code);
      }
      return;
    }
    if (generation !== this.#generation) return;
    this.#preview.stop();
    this.#reportedPreview = NO_PROBLEMS;
    this.#phase = "in_meeting";
    this.#startMeetingMessages(engine);
    this.#focusAfterJoin = true;
    this.#emit("svk-joined", { role: engine.self?.role ?? "participant" });
    this.#announce(ANNOUNCEMENTS.joined);
    this.requestUpdate();
    await Promise.all(handoff.map((kind) => this.#runMedia(kind, () => turnOn(engine, kind, handoffDevices[kind]))));
    if (generation !== this.#generation) return;
    this.#announcedMedia = this.#localMedia();
    this.#announcedScreen = this.#meeting.snapshot.localMediaState.screen;
  }

  /**
   * Runs a device action with its toggle busy, and resolves with whether it succeeded. A failure leaves the toggle
   * showing the engine's unchanged state.
   */
  async #runMedia(kind: DeviceKind, action: () => Promise<void>): Promise<boolean> {
    const generation = this.#generation;
    this.#setBusy(kind, true);
    try {
      await action();
      if (generation === this.#generation) this.#setProblem(kind, null);
      return true;
    } catch (error) {
      const code = errorCode(error);
      if (generation === this.#generation && !this.#leaving && MEDIA_PROBLEM_CODES.has(code)) {
        const problem = deviceProblemFromCode(code as MeetingErrorCode);
        if (this.#setProblem(kind, problem) && this.#phase === "in_meeting") {
          this.#reportDeviceProblem(kind, problem, "in_meeting", code);
        }
        this.#announce(deviceMessage(kind, problem));
      }
      return false;
    } finally {
      if (generation === this.#generation) this.#setBusy(kind, false);
    }
  }

  #localMedia(): PerKind<boolean> {
    const media = this.#meeting.snapshot.localMediaState;
    return { camera: media.camera, microphone: media.microphone };
  }

  /**
   * Announces the participant's own camera and microphone changes once the join handoff is over. A device that goes
   * off without the participant asking is not announced as their choice.
   */
  #announceMediaChanges(): void {
    const previous = this.#announcedMedia;
    if (!previous) return;
    const now = this.#localMedia();
    this.#announcedMedia = now;
    const screen = this.#meeting.snapshot.localMediaState.screen;
    const screenChanged = screen !== this.#announcedScreen;
    this.#announcedScreen = screen;
    if (this.#phase !== "in_meeting" || this.#leaving || this.#meeting.snapshot.state !== "joined") return;
    if (screenChanged) this.#announce(screen ? ANNOUNCEMENTS.screenSharingOn : ANNOUNCEMENTS.screenSharingOff);
    for (const kind of KINDS) {
      if (previous[kind] === now[kind]) continue;
      if (now[kind]) {
        this.#announce(kind === "camera" ? ANNOUNCEMENTS.cameraOn : ANNOUNCEMENTS.microphoneOn);
      } else if (this.#turnedOff[kind]) {
        this.#turnedOff = { ...this.#turnedOff, [kind]: false };
        this.#announce(kind === "camera" ? ANNOUNCEMENTS.cameraOff : ANNOUNCEMENTS.microphoneMuted);
      } else {
        void this.#explainStoppedDevice(kind);
      }
    }
  }

  /**
   * Explains a device that stopped without the participant asking. Browsers end the capture the same way for a revoked
   * permission and an unplugged device, so the browser's permission state tells them apart.
   */
  async #explainStoppedDevice(kind: DeviceKind): Promise<void> {
    const generation = this.#generation;
    const state = await permissionState(kind);
    if (generation !== this.#generation || !this.isConnected || this.#phase !== "in_meeting" || this.#leaving) return;
    if (this.#localMedia()[kind]) return;
    const problem: DeviceProblem = state === "denied" ? "permission_denied" : "disconnected";
    if (this.#setProblem(kind, problem)) this.#reportDeviceProblem(kind, problem, "in_meeting", PROBLEM_CODES[problem]);
    this.#announce(deviceMessage(kind, problem));
  }

  /** Shows `problem` for `kind`, and returns whether it changed. */
  #setProblem(kind: DeviceKind, problem: DeviceProblem | null): boolean {
    if (this.#problems[kind] === problem) return false;
    this.#problems = { ...this.#problems, [kind]: problem };
    this.requestUpdate();
    return true;
  }

  #setBusy(kind: DeviceKind, busy: boolean): void {
    this.#busy = { ...this.#busy, [kind]: busy };
    this.requestUpdate();
  }

  #reflectAppearance(): void {
    const appearance = appearanceOf(this.appearance);
    if (this.getAttribute("data-svk-appearance") !== appearance) this.setAttribute("data-svk-appearance", appearance);
  }

  /** Starts, keeps, or replaces the meeting engine to match the current token and realtime URL. */
  #configure(): void {
    if (!this.isConnected) return;
    const token = this.#token;
    const realtimeUrl = this.realtimeUrl || DEFAULT_REALTIME_URL;
    const configuration = token !== null && realtimeUrl ? `${token}\n${realtimeUrl}` : null;
    if (token !== null && !realtimeUrl && !this.#warnedNoUrl) {
      this.#warnedNoUrl = true;
      this.logger?.warn?.("The meeting shell has no realtime URL; it stays idle until realtimeUrl is set.");
    }
    if (configuration === this.#configuration) return;
    this.#endSession();
    this.#configuration = configuration;
    if (token === null || !realtimeUrl) return;
    this.#settings = { token, realtimeUrl };
    this.#startSession();
  }

  #startSession(): void {
    const settings = this.#settings;
    if (!settings) return;
    this.#phase = "prejoin";
    this.#choice = loadDeviceChoice();
    let engine: MeetingEngine;
    try {
      engine = getEngineFactory()({ ...settings, logger: this.#forwardingLogger() });
    } catch (error) {
      this.#finish("join_failed", errorCode(error));
      return;
    }
    const store = createMeetingStore(engine);
    const inMeeting = (): boolean => this.#session?.engine === engine && this.#phase === "in_meeting";
    const names = new Map<string, string>();
    const remember = (participant: Participant): void => {
      names.set(participant.id, displayName(participant.displayName));
    };
    const unsubscribers = [
      engine.on("joined", (event) => event.participants.forEach(remember)),
      engine.on("participant_joined", ({ participant }) => {
        remember(participant);
        if (inMeeting()) this.#announce(ANNOUNCEMENTS.participantJoined(displayName(participant.displayName)));
      }),
      engine.on("participant_left", ({ participantId }) => {
        const name = names.get(participantId);
        names.delete(participantId);
        if (!inMeeting()) return;
        this.#banner?.participantGone(participantId);
        if (name !== undefined) this.#announce(ANNOUNCEMENTS.participantLeft(name));
      }),
      engine.on("media_connection_changed", ({ participantId, status }) => {
        if (inMeeting()) this.#banner?.participantStatus(participantId, status);
      }),
      engine.on("error", ({ error }) => {
        if (inMeeting() && !this.#leaving) this.#showMeetingError(error);
      }),
      engine.on("closed", ({ reason, error }) => {
        if (reason === "meeting_ended" || error?.code === "meeting_ended") {
          this.#finish("meeting_ended", error?.code);
        } else if (inMeeting()) {
          this.#finish(reason, error?.code);
        }
      }),
    ];
    const unsubscribe = (): void => {
      for (const stop of unsubscribers) stop();
    };
    this.#session = { engine, store, unsubscribe };
    this.#meeting.setStore(store);
  }

  /** After a join that can be retried, swaps in a fresh engine and goes back to the pre-join screen as it was. */
  #replaceEngine(): void {
    this.#generation += 1;
    this.#stopMeetingMessages();
    this.#disposeSession();
    this.#startSession();
    this.requestUpdate();
  }

  /** Disposes the current engine (leaving the meeting and releasing devices) and returns to idle, silently. */
  #endSession(): void {
    this.#generation += 1;
    this.#stopMeetingMessages();
    this.#preview.stop();
    this.#disposeSession();
    this.#configuration = null;
    this.#settings = null;
    this.#phase = "idle";
    this.#closed = null;
    this.#closedSent = false;
    this.#endMeetingOpen = false;
    this.#endMeetingBusy = false;
    this.#wanted = ALL_ON;
    this.#busy = ALL_OFF;
    this.#screenBusy = false;
    this.#leaving = null;
    this.#focusAfterJoin = false;
    this.#announcedMedia = null;
    this.#announcedScreen = false;
    this.#turnedOff = ALL_OFF;
    this.#problems = NO_PROBLEMS;
    this.#reportedPreview = NO_PROBLEMS;
    this.#dismissed = NO_PROBLEMS;
    this.#stopWatches();
    this.#joinFailure = null;
    this.#streamsSeen = "";
  }

  #disposeSession(): void {
    const session = this.#session;
    this.#session = null;
    this.#meeting.setStore(null);
    if (!session) return;
    session.unsubscribe();
    session.store.destroy();
    session.engine.dispose();
  }

  #finish(reason: MeetingShellCloseReason, code?: string): void {
    if (this.#phase === "final" || this.#phase === "idle") return;
    this.#stopMeetingMessages();
    this.#phase = "final";
    this.#closed = code === undefined ? { reason } : { reason, code };
    if (reason !== "left" && !this.#leaving && this.isConnected) {
      reportFailure(this.logger, { surface: "final", phase: "final", code, reason });
    }
    this.#announce(finalState(reason, code).heading);
    this.#emit("svk-closed", { reason });
    this.requestUpdate();
  }

  /**
   * Dispatches a shell event once the screen it belongs to has rendered. Nothing is sent once the element has left
   * the page or the meeting has been replaced, and `svk-closed` is sent at most once per meeting.
   */
  #emit<K extends keyof MeetingShellEventMap>(type: K, detail: MeetingShellEventMap[K]["detail"]): void {
    const generation = this.#generation;
    void this.updateComplete.then(() => {
      if (!this.isConnected || generation !== this.#generation) return;
      if (type === "svk-closed") {
        if (this.#closedSent) return;
        this.#closedSent = true;
      }
      this.dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
    });
  }

  #announce(message: string): void {
    void this.updateComplete.then(() => this.querySelector<SvkAnnouncer>("svk-announcer")?.announce(message));
  }

  /** A logger that forwards to whatever `logger` is set at the time of each call. */
  #forwardingLogger(): MeetingLogger {
    const forward =
      (level: keyof MeetingLogger) =>
      (message: string, fields?: Parameters<NonNullable<MeetingLogger["info"]>>[1]): void =>
        this.logger?.[level]?.(message, fields);
    return { debug: forward("debug"), info: forward("info"), warn: forward("warn"), error: forward("error") };
  }

  override addEventListener<K extends keyof MeetingShellEventMap>(
    type: K,
    listener: (this: StrevokitMeetingElement, event: MeetingShellEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: StrevokitMeetingElement, event: HTMLElementEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  override removeEventListener<K extends keyof MeetingShellEventMap>(
    type: K,
    listener: (this: StrevokitMeetingElement, event: MeetingShellEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener<K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (this: StrevokitMeetingElement, event: HTMLElementEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }
}
