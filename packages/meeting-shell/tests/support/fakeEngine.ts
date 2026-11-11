import { MeetingError } from "@strevokit/meeting-sdk";
import type {
  CloseReason,
  ConnectionState,
  LocalMedia,
  MediaConnectionStatus,
  MediaDeviceOptions,
  MediaKind,
  MediaState,
  MeetingEngine,
  MeetingEngineOptions,
  MeetingErrorCode,
  MeetingEventListener,
  MeetingEventMap,
  MeetingEventType,
  Participant,
  ParticipantRole,
  RemoteMedia,
  SelfParticipant,
} from "@strevokit/meeting-sdk";
import { fakeStream } from "./fakeMediaDevices.js";

export interface EngineCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

type MediaMethod = "enableCamera" | "disableCamera" | "mute" | "unmute" | "startScreenShare" | "stopScreenShare";

/** A join rejection with any code, retry hint, and message. */
export interface JoinFailure {
  readonly code: string;
  readonly retryable: boolean;
  readonly message: string;
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const NO_REMOTE: RemoteMedia = { camera: null, microphone: null, screen: null };

function sdkError(code: string): MeetingError | null {
  try {
    return new MeetingError(code as MeetingErrorCode);
  } catch {
    return null;
  }
}

function errorFor(code: string, message?: string): MeetingError {
  const known = message === undefined ? sdkError(code) : null;
  if (known) return known;
  return Object.assign(new Error(message ?? `engine failure ${code}`), { code, retryable: false }) as unknown as MeetingError;
}

/** A scripted engine: tests choose join and media outcomes, emit any event, and read every call. */
export class FakeEngine implements MeetingEngine {
  state: ConnectionState = "idle";
  self: SelfParticipant | null = null;
  participants: Participant[] = [];
  localMediaState: MediaState = { camera: false, microphone: false, screen: false };
  localMedia: LocalMedia = { camera: null, microphone: null, screen: null };
  readonly calls: EngineCall[] = [];
  disposed = false;

  /**
   * `"resolve"` admits, an error code rejects (the engine then closes, as the SDK does), `"pending"` waits. A failure
   * object rejects with exactly that code, retry hint, and message, which may be any string.
   */
  joinOutcome: "resolve" | "pending" | MeetingErrorCode | JoinFailure = "resolve";
  /** Error codes to reject media calls with, or `"pending"` to hold them until `settleMedia()`. */
  mediaOutcomes: Partial<Record<MediaMethod, MeetingErrorCode | "pending">> = {};
  /** Outcome for `endMeeting()`: `"resolve"` closes with meeting_ended, an error code rejects, `"pending"` waits. */
  endMeetingOutcome: "resolve" | "pending" | MeetingErrorCode = "resolve";
  selfRole: ParticipantRole = "host";
  selfName: string | undefined = "Ada Lovelace";

  readonly remote = new Map<string, RemoteMedia>();
  readonly statuses = new Map<string, MediaConnectionStatus | null>();
  #listeners = new Map<MeetingEventType, Set<(event: unknown) => void>>();
  #pendingJoin: Deferred | null = null;
  #pendingMedia: { method: MediaMethod; done: Deferred; apply: () => void }[] = [];
  #pendingEndMeeting: Deferred | null = null;
  #held: Partial<Record<MediaMethod, Deferred>> = {};

  constructor(readonly options: MeetingEngineOptions) {}

  remoteMedia(participantId: string): RemoteMedia {
    return this.remote.get(participantId) ?? NO_REMOTE;
  }

  mediaConnectionStatus(participantId: string): MediaConnectionStatus | null {
    return this.statuses.has(participantId) ? (this.statuses.get(participantId) ?? null) : "connected";
  }

  on<K extends MeetingEventType>(type: K, listener: MeetingEventListener<K>): () => void {
    const set = this.#listeners.get(type) ?? new Set();
    set.add(listener as (event: unknown) => void);
    this.#listeners.set(type, set);
    return () => set.delete(listener as (event: unknown) => void);
  }

  emit<K extends MeetingEventType>(type: K, event: MeetingEventMap[K]): void {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) listener(event);
  }

  listenerCount(): number {
    let count = 0;
    for (const set of this.#listeners.values()) count += set.size;
    return count;
  }

  #setState(state: ConnectionState): void {
    const previous = this.state;
    this.state = state;
    this.emit("state_changed", { state, previous });
  }

  /** Starts automatic recovery of the meeting service connection, as the engine does after an interruption. */
  startReconnecting(): void {
    this.#setState("reconnecting");
  }

  /** Ends recovery with the connection restored; the engine does not emit `joined` again. */
  finishReconnecting(): void {
    this.#setState("joined");
  }

  async join(): Promise<void> {
    this.calls.push({ method: "join", args: [] });
    this.#setState("joining");
    if (this.joinOutcome === "pending") {
      this.#pendingJoin = deferred();
      return this.#pendingJoin.promise;
    }
    if (this.joinOutcome !== "resolve") return this.#failJoin(this.joinOutcome);
    this.#admit();
  }

  /** Completes a pending join: admits it, or fails it with `code`. */
  finishJoin(code?: MeetingErrorCode): void {
    const pending = this.#pendingJoin;
    this.#pendingJoin = null;
    if (!pending) throw new Error("no pending join");
    if (code) {
      this.#failJoin(code).catch((error: unknown) => pending.reject(error));
      return;
    }
    this.#admit();
    pending.resolve();
  }

  #admit(): void {
    this.self = {
      id: "self-id-1",
      role: this.selfRole,
      displayName: this.selfName,
      joinedAt: "2026-01-01T00:00:00Z",
    };
    this.#setState("joined");
    this.emit("joined", { self: this.self, participants: this.participants });
  }

  async #failJoin(failure: MeetingErrorCode | JoinFailure): Promise<never> {
    const error =
      typeof failure === "string"
        ? new MeetingError(failure)
        : (Object.assign(new Error(failure.message), {
            name: "MeetingError",
            code: failure.code,
            retryable: failure.retryable,
          }) as unknown as MeetingError);
    this.#setState("closed");
    this.emit("closed", { reason: "join_failed", error });
    throw error;
  }

  async leave(): Promise<void> {
    this.calls.push({ method: "leave", args: [] });
    this.#setState("leaving");
    this.#releaseAll();
    this.#setState("closed");
    this.emit("closed", { reason: "left" });
  }

  #releaseAll(): void {
    for (const kind of ["camera", "microphone", "screen"] as const) {
      if (this.localMediaState[kind]) this.setLocalMedia(kind, false);
    }
  }

  /** Changes local media as the engine would and emits `local_media_changed`. */
  setLocalMedia(kind: MediaKind, enabled: boolean, stream: MediaStream | null = null): void {
    const next = enabled ? (stream ?? fakeStream(kind, `${kind}-local`)) : null;
    this.localMediaState = { ...this.localMediaState, [kind]: enabled };
    this.localMedia = { ...this.localMedia, [kind]: next };
    this.emit("local_media_changed", { kind, enabled, stream: next });
  }

  /** Resolves the next `method` call only after the returned function runs. */
  holdNext(method: MediaMethod): () => void {
    const done = deferred();
    this.#held[method] = done;
    return () => {
      if (this.#held[method] === done) delete this.#held[method];
      done.resolve();
    };
  }

  #media(method: MediaMethod, args: unknown[], apply: () => void): Promise<void> {
    this.calls.push({ method, args });
    if (this.state !== "joined") return Promise.reject(new MeetingError("not_joined"));
    const held = this.#held[method];
    if (held) {
      delete this.#held[method];
      return held.promise.then(() => this.#finishMedia(method, apply));
    }
    return this.#finishMedia(method, apply);
  }

  #finishMedia(method: MediaMethod, apply: () => void): Promise<void> {
    if (this.state !== "joined") return Promise.reject(new MeetingError("not_joined"));
    const outcome = this.mediaOutcomes[method];
    if (outcome === "pending") {
      const done = deferred();
      this.#pendingMedia.push({ method, done, apply });
      return done.promise;
    }
    if (outcome) return Promise.reject(new MeetingError(outcome));
    apply();
    return Promise.resolve();
  }

  /** Settles every held media call, applying it unless `code` is given. */
  settleMedia(code?: MeetingErrorCode): void {
    const pending = this.#pendingMedia.splice(0);
    for (const call of pending) {
      if (code) {
        call.done.reject(new MeetingError(code));
      } else {
        if (this.state === "joined") call.apply();
        call.done.resolve();
      }
    }
  }

  enableCamera(options?: MediaDeviceOptions): Promise<void> {
    return this.#media("enableCamera", options === undefined ? [] : [options], () => {
      const stream = fakeStream("camera", options?.deviceId ?? "camera-1");
      this.setLocalMedia("camera", true, stream);
    });
  }

  disableCamera(): Promise<void> {
    return this.#media("disableCamera", [], () => this.setLocalMedia("camera", false));
  }

  mute(): Promise<void> {
    return this.#media("mute", [], () => this.setLocalMedia("microphone", false));
  }

  unmute(options?: MediaDeviceOptions): Promise<void> {
    return this.#media("unmute", options === undefined ? [] : [options], () => {
      const stream = fakeStream("microphone", options?.deviceId ?? "mic-1");
      this.setLocalMedia("microphone", true, stream);
    });
  }

  startScreenShare(): Promise<void> {
    return this.#media("startScreenShare", [], () => this.setLocalMedia("screen", true));
  }

  stopScreenShare(): Promise<void> {
    return this.#media("stopScreenShare", [], () => this.setLocalMedia("screen", false));
  }

  endMeeting(): Promise<void> {
    this.calls.push({ method: "endMeeting", args: [] });
    if (this.state !== "joined") return Promise.reject(new MeetingError("not_joined"));
    if (this.endMeetingOutcome === "pending") {
      const done = deferred();
      this.#pendingEndMeeting = done;
      return done.promise;
    }
    if (this.endMeetingOutcome !== "resolve") {
      return Promise.reject(new MeetingError(this.endMeetingOutcome));
    }
    this.close("meeting_ended");
    return Promise.resolve();
  }

  /** Settles a pending endMeeting() call. */
  settleEndMeeting(code?: MeetingErrorCode): void {
    const pending = this.#pendingEndMeeting;
    this.#pendingEndMeeting = null;
    if (pending) {
      if (code) {
        pending.reject(new MeetingError(code));
      } else {
        if (this.state === "joined") this.close("meeting_ended");
        pending.resolve();
      }
    }
  }

  dispose(): void {
    this.calls.push({ method: "dispose", args: [] });
    this.disposed = true;
    this.#listeners.clear();
    if (this.state !== "closed") this.state = "closed";
  }

  // Roster helpers.

  addParticipant(participant: Participant): void {
    this.participants = [...this.participants, participant];
    this.emit("participant_joined", { participant });
  }

  removeParticipant(participantId: string): void {
    this.participants = this.participants.filter((participant) => participant.id !== participantId);
    this.remote.delete(participantId);
    this.statuses.delete(participantId);
    this.emit("participant_left", { participantId, reason: "left" });
  }

  setRemoteMedia(participantId: string, kind: MediaKind, enabled: boolean, stream?: MediaStream | null): void {
    this.participants = this.participants.map((participant) =>
      participant.id === participantId ? { ...participant, media: { ...participant.media, [kind]: enabled } } : participant,
    );
    this.emit("participant_media_changed", { participantId, kind, enabled });
    if (stream !== undefined) {
      this.remote.set(participantId, { ...this.remoteMedia(participantId), [kind]: stream });
      this.emit("remote_media_changed", { participantId, kind, stream });
    }
  }

  setConnection(participantId: string, status: MediaConnectionStatus | null): void {
    this.statuses.set(participantId, status);
    this.emit("media_connection_changed", { participantId, status });
  }

  /** Closes the session as the engine would, optionally with the error that ended it. */
  close(reason: CloseReason, code?: MeetingErrorCode): void {
    this.#releaseAll();
    this.#setState("closed");
    this.emit("closed", code ? { reason, error: new MeetingError(code) } : { reason });
  }

  /**
   * Emits the engine `error` event. SDK codes carry a real `MeetingError`; any other code, or an explicit `message`,
   * carries a plain error object with that code and message, so tests can prove the message is never shown.
   */
  emitError(code: string, message?: string): void {
    this.emit("error", { error: errorFor(code, message) });
  }

  callsTo(method: string): EngineCall[] {
    return this.calls.filter((call) => call.method === method);
  }
}

export function participant(id: string, name: string | undefined, role: ParticipantRole = "participant"): Participant {
  return { id, role, displayName: name, media: { camera: false, microphone: false, screen: false } };
}

/** A factory that records every engine it creates; `configure` scripts each new engine. */
export function engineFactory(configure: (engine: FakeEngine, index: number) => void = () => {}) {
  const engines: FakeEngine[] = [];
  const factory = (options: MeetingEngineOptions): MeetingEngine => {
    const engine = new FakeEngine(options);
    configure(engine, engines.length);
    engines.push(engine);
    return engine;
  };
  return {
    factory,
    engines,
    get last(): FakeEngine {
      const engine = engines[engines.length - 1];
      if (!engine) throw new Error("no engine created yet");
      return engine;
    },
  };
}
