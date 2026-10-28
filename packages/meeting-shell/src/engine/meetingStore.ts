import type {
  ConnectionState,
  LocalMedia,
  MediaConnectionStatus,
  MediaState,
  MeetingEngine,
  MeetingEventType,
  ParticipantRole,
} from "@strevokit/meeting-sdk";
import { LABELS } from "../copy.js";

/** How the connection to a participant is shown. */
export type ConnectionView = "connected" | "connecting" | "interrupted";

/** One participant as the UI shows it. `key` is a template key only and is never rendered. */
export interface ParticipantView {
  readonly key: string;
  readonly isSelf: boolean;
  readonly name: string;
  readonly role: ParticipantRole;
  readonly connection: ConnectionView;
  readonly microphoneOn: boolean;
  readonly cameraOn: boolean;
  readonly cameraStream: MediaStream | null;
  /** Whether the participant is sharing their screen. */
  readonly screenOn: boolean;
  /** The shared screen's video, once it is available; `null` otherwise. */
  readonly screenStream: MediaStream | null;
  readonly audioStream: MediaStream | null;
}

/** An immutable view of the engine, replaced on every engine event. */
export interface MeetingSnapshot {
  readonly state: ConnectionState;
  readonly localMediaState: MediaState;
  readonly localMedia: LocalMedia;
  /** Self first, then hosts, then everyone else in join order. */
  readonly participants: readonly ParticipantView[];
}

export interface MeetingStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): MeetingSnapshot;
  destroy(): void;
}

const EVENT_TYPES: readonly MeetingEventType[] = [
  "state_changed",
  "joined",
  "participant_joined",
  "participant_left",
  "participant_reconnected",
  "participant_media_changed",
  "local_media_changed",
  "remote_media_changed",
  "media_connection_changed",
  "error",
  "closed",
];

const NO_MEDIA: MediaState = Object.freeze({ camera: false, microphone: false, screen: false });
const NO_STREAMS: LocalMedia = Object.freeze({ camera: null, microphone: null, screen: null });

export const EMPTY_SNAPSHOT: MeetingSnapshot = Object.freeze({
  state: "idle",
  localMediaState: NO_MEDIA,
  localMedia: NO_STREAMS,
  participants: Object.freeze([]),
});

/** The name to show: the display name, or "Guest" when it is missing or blank. */
export function displayName(name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : LABELS.guest;
}

export function connectionView(status: MediaConnectionStatus | null): ConnectionView {
  if (status === "connected") return "connected";
  if (status === "interrupted" || status === "failed") return "interrupted";
  return "connecting";
}

/** Derives the participant views from the engine's current state. */
export function deriveParticipants(engine: MeetingEngine): ParticipantView[] {
  const views: ParticipantView[] = [];
  const self = engine.self;
  if (self) {
    views.push({
      key: self.id,
      isSelf: true,
      name: displayName(self.displayName),
      role: self.role,
      connection: "connected",
      microphoneOn: engine.localMediaState.microphone,
      cameraOn: engine.localMediaState.camera,
      cameraStream: engine.localMedia.camera,
      screenOn: engine.localMediaState.screen,
      screenStream: engine.localMedia.screen,
      audioStream: null,
    });
  }
  const others = engine.participants.filter((participant) => participant.id !== self?.id);
  const ordered = [...others.filter((p) => p.role === "host"), ...others.filter((p) => p.role !== "host")];
  for (const participant of ordered) {
    const media = engine.remoteMedia(participant.id);
    views.push({
      key: participant.id,
      isSelf: false,
      name: displayName(participant.displayName),
      role: participant.role,
      connection: connectionView(engine.mediaConnectionStatus(participant.id)),
      microphoneOn: participant.media.microphone,
      cameraOn: participant.media.camera,
      cameraStream: media.camera,
      screenOn: participant.media.screen,
      screenStream: media.screen,
      audioStream: media.microphone,
    });
  }
  return views;
}

function snapshotOf(engine: MeetingEngine): MeetingSnapshot {
  return Object.freeze({
    state: engine.state,
    localMediaState: engine.localMediaState,
    localMedia: engine.localMedia,
    participants: Object.freeze(deriveParticipants(engine)),
  });
}

/** A subscribable, immutable view of one engine, rebuilt on every engine event. */
export function createMeetingStore(engine: MeetingEngine): MeetingStore {
  const listeners = new Set<() => void>();
  let snapshot = snapshotOf(engine);
  const refresh = (): void => {
    snapshot = snapshotOf(engine);
    for (const listener of [...listeners]) listener();
  };
  const unsubscribers = EVENT_TYPES.map((type) => engine.on(type, refresh));
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    destroy() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      listeners.clear();
    },
  };
}
