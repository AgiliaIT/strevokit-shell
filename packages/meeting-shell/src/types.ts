import type { MeetingLogger, ParticipantRole } from "@strevokit/meeting-sdk";
import type { StrevokitMeetingElement } from "./elements/strevokit-meeting.js";

/** Colour appearance of the meeting UI. `"system"` follows the browser's light or dark preference. */
export type MeetingShellAppearance = "light" | "dark" | "system";

/** Why the meeting UI reached its final screen. */
export type MeetingShellCloseReason =
  | "left"
  | "meeting_ended"
  | "session_replaced"
  | "connection_lost"
  | "join_failed"
  | "error";

/** Detail of `svk-joined`, and the argument of `onJoined`, once the participant is in the meeting. */
export interface MeetingShellJoinedEvent {
  /** The role the platform assigned to this participant. */
  readonly role: ParticipantRole;
}

/** Detail of `svk-closed`, and the argument of `onClosed`, once the meeting UI reaches its final screen. */
export interface MeetingShellClosedEvent {
  /** Why the meeting ended for this participant. */
  readonly reason: MeetingShellCloseReason;
}

/** The events `<strevokit-meeting>` dispatches. Both bubble. */
export interface MeetingShellEventMap {
  "svk-joined": CustomEvent<MeetingShellJoinedEvent>;
  "svk-closed": CustomEvent<MeetingShellClosedEvent>;
}

/** Options of `mount()`. */
export interface MountOptions {
  /** Join token issued by your backend. Kept in memory only. Required, non-empty. */
  readonly token: string;
  /** Realtime endpoint (`wss://` outside local development). Optional once a production default exists. */
  readonly realtimeUrl?: string;
  /** Colour appearance. Default `"system"`. */
  readonly appearance?: MeetingShellAppearance;
  /** Called once when the participant enters the meeting. */
  readonly onJoined?: (event: MeetingShellJoinedEvent) => void;
  /** Called exactly once when the participant leaves or the meeting closes. Not called after `destroy()`. */
  readonly onClosed?: (event: MeetingShellClosedEvent) => void;
  /** Optional diagnostics sink, passed to the meeting engine. It never receives the join token. */
  readonly logger?: MeetingLogger;
  /** Whether to hide the End meeting button from hosts. Default `false`. */
  readonly hideEndMeeting?: boolean;
  /**
   * Called when the meeting needs a fresh join token to restore a lost connection and the token in memory can't be
   * used. Resolve with a token issued by your backend for the same participant; reject to give up. The token is kept
   * in memory only and never logged.
   */
  readonly getJoinToken?: () => Promise<string>;
  /** How long, in milliseconds, to keep trying to restore a lost connection. Default 120000; range 1000–600000. */
  readonly reconnectWindowMs?: number;
}

/** The events a {@link ShellHandle} reports. */
export interface ShellHandleEventMap {
  /** The participant entered the meeting; mirrors `svk-joined`. */
  readonly joined: MeetingShellJoinedEvent;
  /** The meeting UI reached its final screen; mirrors `svk-closed`. */
  readonly closed: MeetingShellClosedEvent;
}

/** Returned by `mount()`: the created element and a small control API. */
export interface ShellHandle {
  /** The `<strevokit-meeting>` element that was created. */
  readonly element: StrevokitMeetingElement;
  /** Listen for `"joined"` or `"closed"`. Returns a function that removes the listener. */
  on<K extends keyof ShellHandleEventMap>(type: K, listener: (event: ShellHandleEventMap[K]) => void): () => void;
  /** Leave the meeting (no-op unless joined). Resolves when the final screen is shown. */
  leave(): Promise<void>;
  /** Remove the element: leaves the meeting, releases devices, stops all notifications. Idempotent. */
  destroy(): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "strevokit-meeting": StrevokitMeetingElement;
  }
}
