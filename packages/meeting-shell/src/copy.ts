// Every user-facing string the meeting UI shows. Browser and engine error messages are never shown; codes are mapped
// to this copy instead.
import type { MeetingErrorCode } from "@strevokit/meeting-sdk";
import type { MeetingShellCloseReason } from "./types.js";

export type DeviceKind = "camera" | "microphone";

/** One value for each device kind. */
export type PerKind<T> = { readonly camera: T; readonly microphone: T };

/** Why a camera or microphone is not available. */
export type DeviceProblem = "permission_denied" | "not_found" | "in_use" | "disconnected" | "unsupported";

export const LABELS = {
  setupRegion: "Meeting setup",
  readyToJoin: "Ready to join?",
  join: "Join meeting",
  joining: "Joining…",
  leave: "Leave meeting",
  meetingRegion: "Meeting",
  meetingHeading: "Meeting",
  controls: "Meeting controls",
  tiles: "Participants' video",
  participantsDialog: "Participants",
  participants: (count: number) => `Participants (${count})`,
  you: "(You)",
  host: "Host",
  participant: "Participant",
  guest: "Guest",
  connected: "Connected",
  connecting: "Connecting…",
  interrupted: "Connection interrupted",
  turnOnSound: "Turn on sound",
  pickingUpSound: "Microphone is picking up sound",
  cameraOff: "Camera is off",
  sharedScreen: "Shared screen",
  microphone: "Microphone",
  camera: "Camera",
  shareScreen: "Share screen",
  microphoneDevice: "Microphone device",
  cameraDevice: "Camera device",
  chooseMicrophone: "Choose microphone",
  chooseCamera: "Choose camera",
  microphoneOffBadge: "microphone off",
  tryAgain: "Try again",
  tryDeviceAgain: (kind: DeviceKind) => `Try ${kind} again`,
  dismiss: "Dismiss",
  dismissMessage: "Dismiss message",
  dismissDeviceMessage: (kind: DeviceKind) => `Dismiss ${kind} message`,
  genericDevice: (kind: DeviceKind, index: number) => `${kind === "camera" ? "Camera" : "Microphone"} ${index}`,
  defaultDevice: "Default",
  on: "On",
  off: "Off",
  endMeeting: "End meeting",
} as const;

export const END_MEETING_DIALOG = {
  heading: "End the meeting for everyone?",
  body: "Everyone will leave the meeting.",
  confirm: "End meeting",
  cancel: "Cancel",
} as const;

export const END_MEETING_FAILED = "The meeting couldn't be ended. Try again.";

export const ANNOUNCEMENTS = {
  joined: "Joined the meeting",
  microphoneOn: "Microphone on",
  microphoneMuted: "Microphone muted",
  cameraOn: "Camera on",
  cameraOff: "Camera off",
  screenSharingOn: "Screen sharing on",
  screenSharingOff: "Screen sharing off",
  switchedTo: (device: string) => `Switched to ${device}`,
  participantJoined: (name: string) => `${name} joined`,
  participantLeft: (name: string) => `${name} left`,
  reconnected: "Reconnected",
  endMeetingFailed: "The meeting couldn't be ended. Try again.",
} as const;

/** One failure as the participant sees it: what happened, what to do next, and whether a retry action is offered. */
export interface CatalogueCopy {
  readonly message: string;
  readonly guidance?: string;
  readonly retry: boolean;
}

/** The text shown for a catalogue entry: the message, then the guidance, in one paragraph. */
export function shownText(copy: CatalogueCopy): string {
  return copy.guidance ? `${copy.message} ${copy.guidance}` : copy.message;
}

const CURRENT_BROWSER = "Try a current version of Chrome, Edge, Firefox, or Safari.";

export const DEVICE_MESSAGES = {
  permission_denied: (kind) => ({
    message: `${capitalize(kind)} permission was denied.`,
    guidance: `Allow ${kind} access from the icon next to the address bar and in your system settings, then try again.`,
    retry: true,
  }),
  not_found: (kind) => ({ message: `No ${kind} was found.`, guidance: `Connect a ${kind}, then try again.`, retry: true }),
  in_use: (kind) => ({ message: `Your ${kind} is being used by another app.`, guidance: "Close it, then try again.", retry: true }),
  disconnected: (kind) => ({ message: `Your ${kind} was disconnected.`, guidance: "Reconnect it, then try again.", retry: true }),
  unsupported: (kind) => ({ message: `This browser can't use a ${kind} here.`, guidance: CURRENT_BROWSER, retry: false }),
} as const satisfies Record<DeviceProblem, (kind: DeviceKind) => CatalogueCopy>;

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** The catalogue entry for a camera or microphone that cannot be used. */
export function deviceCopy(kind: DeviceKind, problem: DeviceProblem): CatalogueCopy {
  return DEVICE_MESSAGES[problem](kind);
}

/** The text shown next to a camera or microphone control that cannot be used. */
export function deviceMessage(kind: DeviceKind, problem: DeviceProblem): string {
  return shownText(deviceCopy(kind, problem));
}

/** Problems that a retry cannot fix without the user changing something first; the toggle explains them instead. */
export function blocksDevice(problem: DeviceProblem | null): boolean {
  return problem === "permission_denied" || problem === "not_found" || problem === "unsupported";
}

/** The device problem for a browser capture failure, by `DOMException.name`. */
export function deviceProblemFromName(name: string | undefined): DeviceProblem {
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "permission_denied";
    case "NotFoundError":
    case "OverconstrainedError":
      return "not_found";
    case "TypeError":
      return "unsupported";
    default:
      return "in_use";
  }
}

/** The device problem for an engine media error code. */
export function deviceProblemFromCode(code: MeetingErrorCode): DeviceProblem {
  switch (code) {
    case "permission_denied":
      return "permission_denied";
    case "device_not_found":
      return "not_found";
    case "unsupported_environment":
      return "unsupported";
    default:
      return "in_use";
  }
}

const INVALID_LINK: CatalogueCopy = { message: "This meeting link is no longer valid.", guidance: "Ask for a new link.", retry: false };
const UNABLE_TO_CONNECT: CatalogueCopy = {
  message: "Unable to connect to the meeting.",
  guidance: "Check your connection and try again.",
  retry: true,
};
const TOO_MANY_ATTEMPTS: CatalogueCopy = { message: "Too many attempts.", guidance: "Wait a moment, then try again.", retry: true };
const JOIN_WENT_WRONG = "Something went wrong joining the meeting.";
const GENERIC_RETRY: CatalogueCopy = { message: JOIN_WENT_WRONG, guidance: "Try again.", retry: true };
const GENERIC_FINAL: CatalogueCopy = { message: JOIN_WENT_WRONG, guidance: "Reload the page to try again.", retry: false };

/** Join copy for every engine error code. Adding a code to the engine fails type-checking until it is mapped here. */
export const JOIN_ERRORS = {
  join_token_invalid: INVALID_LINK,
  join_token_expired: INVALID_LINK,
  origin_not_allowed: { message: "This meeting can't be joined from this site.", retry: false },
  meeting_ended: { message: "The meeting has ended.", retry: false },
  connection_failed: UNABLE_TO_CONNECT,
  join_timeout: UNABLE_TO_CONNECT,
  service_unavailable: UNABLE_TO_CONNECT,
  rate_limited: TOO_MANY_ATTEMPTS,
  unsupported_environment: { message: "This browser isn't supported.", guidance: CURRENT_BROWSER, retry: false },
  join_cancelled: { message: "Joining was interrupted.", guidance: "Try again.", retry: true },
  session_replaced: { message: "You're already in this meeting in another tab or on another device.", retry: false },
  connection_lost: GENERIC_RETRY,
  media_connection_failed: GENERIC_RETRY,
  device_unavailable: GENERIC_RETRY,
  protocol_error: GENERIC_FINAL,
  already_joined: GENERIC_FINAL,
  engine_closed: GENERIC_FINAL,
  not_joined: GENERIC_FINAL,
  not_permitted: GENERIC_FINAL,
  permission_denied: GENERIC_FINAL,
  device_not_found: GENERIC_FINAL,
  screen_share_cancelled: GENERIC_FINAL,
  media_participant_limit: GENERIC_FINAL,
} as const satisfies Record<MeetingErrorCode, CatalogueCopy>;

/** Join copy for `code`; unknown codes get the generic message and the engine's retry hint. */
export function joinError(code: string, retryable = true): CatalogueCopy {
  if (Object.hasOwn(JOIN_ERRORS, code)) return JOIN_ERRORS[code as MeetingErrorCode];
  return retryable ? GENERIC_RETRY : GENERIC_FINAL;
}

/**
 * Where an engine error reported during the meeting is shown: as a notice with its copy, or by another surface
 * (`banner`: the connection banner; `device`: the message next to the device control), or not at all (`ignored`).
 */
export type MeetingErrorRoute =
  | { readonly route: "notice"; readonly copy: CatalogueCopy }
  | { readonly route: "banner" | "device" | "ignored" };

const MEETING_WENT_WRONG: CatalogueCopy = {
  message: "Something went wrong in the meeting.",
  guidance: "If it stops working, leave and join again.",
  retry: false,
};

/** The notice for an in-meeting engine error with a code the catalogue doesn't know. */
export const GENERIC_NOTICE: CatalogueCopy = MEETING_WENT_WRONG;

const BANNER = { route: "banner" } as const;
const DEVICE = { route: "device" } as const;
const IGNORED = { route: "ignored" } as const;

/** In-meeting routing for every engine error code. Adding a code to the engine fails type-checking until it is here. */
export const MEETING_ERRORS = {
  not_permitted: { route: "notice", copy: { message: "You can't do that in this meeting.", retry: false } },
  media_participant_limit: {
    route: "notice",
    copy: { message: "Audio and video only work between two people in this meeting.", retry: false },
  },
  rate_limited: { route: "notice", copy: { ...TOO_MANY_ATTEMPTS, retry: false } },
  service_unavailable: {
    route: "notice",
    copy: { message: "The meeting service is busy.", guidance: "Try again in a moment.", retry: false },
  },
  protocol_error: { route: "notice", copy: MEETING_WENT_WRONG },
  unsupported_environment: {
    route: "notice",
    copy: { message: "This browser can't send or receive audio and video.", guidance: CURRENT_BROWSER, retry: false },
  },
  media_connection_failed: BANNER,
  permission_denied: DEVICE,
  device_not_found: DEVICE,
  device_unavailable: DEVICE,
  join_token_invalid: IGNORED,
  join_token_expired: IGNORED,
  origin_not_allowed: IGNORED,
  connection_failed: IGNORED,
  join_timeout: IGNORED,
  join_cancelled: IGNORED,
  connection_lost: IGNORED,
  session_replaced: IGNORED,
  meeting_ended: IGNORED,
  engine_closed: IGNORED,
  already_joined: IGNORED,
  not_joined: IGNORED,
  screen_share_cancelled: IGNORED,
} as const satisfies Record<MeetingErrorCode, MeetingErrorRoute>;

/** Notices for a failed Share screen request, by the engine code the request was rejected with. */
export const SCREEN_SHARE_NOTICES: Readonly<Partial<Record<MeetingErrorCode, CatalogueCopy>>> = {
  screen_share_cancelled: { message: "Screen sharing was cancelled.", retry: false },
  permission_denied: {
    message: "Screen sharing permission was denied.",
    guidance: "Allow screen sharing in your browser, then try again.",
    retry: false,
  },
  unsupported_environment: { message: "Screen sharing isn't available in this meeting.", retry: false },
  not_permitted: { message: "You don't have permission to share your screen.", retry: false },
};

/** The notice for a Share screen request rejected with `code`; other codes get the generic in-meeting notice. */
export function screenShareNotice(code: string): CatalogueCopy {
  return Object.hasOwn(SCREEN_SHARE_NOTICES, code)
    ? (SCREEN_SHARE_NOTICES[code as MeetingErrorCode] as CatalogueCopy)
    : GENERIC_NOTICE;
}

const GENERIC_NOTICE_ROUTE: MeetingErrorRoute = Object.freeze({ route: "notice", copy: GENERIC_NOTICE });

/** The in-meeting route for `code`; unknown codes get the generic notice. */
export function meetingErrorRoute(code: string): MeetingErrorRoute {
  return Object.hasOwn(MEETING_ERRORS, code) ? MEETING_ERRORS[code as MeetingErrorCode] : GENERIC_NOTICE_ROUTE;
}

/** What the connection banner says: reconnecting (online or offline), or audio and video failed. */
export type BannerVariant = "reconnecting" | "reconnecting_offline" | "failed_reconnect" | "failed_connect";

const RECONNECTING = "Connection lost — reconnecting…";
const LEAVE_AND_JOIN = "Leave the meeting, then join again.";

export const CONNECTION_BANNER = {
  reconnecting: { message: RECONNECTING, retry: false },
  reconnecting_offline: { message: RECONNECTING, guidance: "Check your internet connection.", retry: false },
  failed_reconnect: { message: "Audio and video couldn't reconnect.", guidance: LEAVE_AND_JOIN, retry: false },
  failed_connect: { message: "Audio and video couldn't connect.", guidance: LEAVE_AND_JOIN, retry: false },
} as const satisfies Record<BannerVariant, CatalogueCopy>;

export interface FinalCopy {
  readonly heading: string;
  readonly body?: string;
}

export const FINAL_STATES = {
  left: { heading: "You left the meeting" },
  meeting_ended: { heading: "The meeting has ended." },
  session_replaced: { heading: "You joined from another tab", body: "This tab has left the meeting." },
  connection_lost: { heading: "Connection lost", body: "You've been disconnected from the meeting." },
  join_failed: { heading: "Unable to join this meeting" },
  error: { heading: "Something went wrong", body: "You've left the meeting." },
} as const satisfies Record<MeetingShellCloseReason, FinalCopy>;

/** Final-screen copy for `reason`; a failed join shows the join error for `code` when it is known. */
export function finalState(reason: MeetingShellCloseReason, code?: string): FinalCopy {
  if (reason === "join_failed" && code !== undefined) {
    return { heading: FINAL_STATES.join_failed.heading, body: shownText(joinError(code, false)) };
  }
  return FINAL_STATES[reason];
}
