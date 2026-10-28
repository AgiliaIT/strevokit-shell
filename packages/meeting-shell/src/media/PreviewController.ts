import type { ReactiveController, ReactiveControllerHost } from "lit";
import { deviceProblemFromName } from "../copy.js";
import type { DeviceKind, DeviceProblem, PerKind } from "../copy.js";
import { captureKind, errorName, mediaDevices, stopStream } from "./capture.js";

export type PreviewStatus = "idle" | "requesting" | "ready" | DeviceProblem;

export interface KindPreview {
  readonly stream: MediaStream | null;
  readonly status: PreviewStatus;
  /** The problem from before a retry, still shown until the retry settles so the message doesn't flash. */
  readonly held?: DeviceProblem | null;
}

export interface PreviewRequest {
  /** False until the meeting engine exists, and after joining: nothing is captured then. */
  readonly active: boolean;
  readonly wanted: boolean;
  readonly deviceId: string | null;
}

interface KindState {
  /** The request being served, or `null` after `stop()`, so the next request starts a fresh capture. */
  request: string | null;
  /** Bumped on every release, so a capture that finishes late is stopped instead of shown. */
  run: number;
  preview: KindPreview;
  /** The problem kept on screen while a retry is in flight. */
  held: DeviceProblem | null;
}

const IDLE: KindPreview = Object.freeze({ stream: null, status: "idle" });
const KINDS: readonly DeviceKind[] = ["camera", "microphone"];

function problemOf(preview: KindPreview): DeviceProblem | null {
  const { status } = preview;
  if (status === "idle" || status === "requesting" || status === "ready") return preview.held ?? null;
  return status;
}

/**
 * The pre-join self-preview: one capture per wanted kind, replaced when the request changes and released on `stop()`,
 * when no longer wanted, or when the host leaves the page.
 */
export class PreviewController implements ReactiveController {
  readonly #host: ReactiveControllerHost & HTMLElement;
  readonly #kinds: Record<DeviceKind, KindState> = {
    camera: { request: null, run: 0, preview: IDLE, held: null },
    microphone: { request: null, run: 0, preview: IDLE, held: null },
  };

  constructor(host: ReactiveControllerHost & HTMLElement) {
    this.#host = host;
    host.addController(this);
  }

  get camera(): KindPreview {
    return this.#kinds.camera.preview;
  }

  get microphone(): KindPreview {
    return this.#kinds.microphone.preview;
  }

  /** Starts, keeps, or stops each kind's capture to match `requests`. Call it before every render. */
  sync(requests: PerKind<PreviewRequest>): void {
    for (const kind of KINDS) {
      const request = requests[kind];
      const capture = request.active && request.wanted;
      const key = capture ? `on\n${request.deviceId ?? ""}` : "off";
      const state = this.#kinds[kind];
      if (state.request === key) continue;
      this.#release(state);
      state.request = key;
      if (capture) this.#capture(kind, state, request.deviceId);
      else state.held = null;
    }
  }

  /**
   * Captures `kind` again on the next update, for example after the participant changed a site permission. The current
   * problem stays reported until the new capture settles.
   */
  retry(kind: DeviceKind): void {
    const state = this.#kinds[kind];
    state.held = problemOf(state.preview);
    this.#release(state);
    state.request = null;
    this.#host.requestUpdate();
  }

  /** Stops every preview capture now. */
  stop(): void {
    for (const kind of KINDS) {
      const state = this.#kinds[kind];
      this.#release(state);
      state.request = null;
      state.held = null;
    }
  }

  hostDisconnected(): void {
    // A host moved within one task keeps its preview, like the meeting itself.
    queueMicrotask(() => {
      if (!this.#host.isConnected) this.stop();
    });
  }

  #capture(kind: DeviceKind, state: KindState, deviceId: string | null): void {
    if (!mediaDevices()) {
      state.held = null;
      state.preview = { stream: null, status: "unsupported" };
      return;
    }
    const run = state.run;
    state.preview = { stream: null, status: "requesting", held: state.held };
    captureKind(kind, deviceId).then(
      (stream) => {
        if (state.run !== run) {
          stopStream(stream);
          return;
        }
        state.held = null;
        state.preview = { stream, status: "ready" };
        this.#host.requestUpdate();
      },
      (error: unknown) => {
        if (state.run !== run) return;
        state.held = null;
        state.preview = { stream: null, status: deviceProblemFromName(errorName(error)) };
        this.#host.requestUpdate();
      },
    );
  }

  #release(state: KindState): void {
    state.run += 1;
    stopStream(state.preview.stream);
    state.preview = IDLE;
  }
}
