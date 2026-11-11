import { MeetingError } from "@strevokit/meeting-sdk";
import type { MeetingErrorCode } from "@strevokit/meeting-sdk";
import { describe, expect, it } from "vitest";
import {
  ANNOUNCEMENTS,
  CONNECTION_BANNER,
  DEVICE_MESSAGES,
  FINAL_STATES,
  FULL_SCREEN_REFUSAL,
  GENERIC_NOTICE,
  JOIN_ERRORS,
  LABELS,
  SPEAKER_FAILURE,
  MEETING_ERRORS,
  SCREEN_SHARE_NOTICES,
  END_MEETING_DIALOG,
  END_MEETING_FAILED,
  deviceCopy,
  deviceMessage,
  deviceProblemFromCode,
  deviceProblemFromName,
  finalState,
  joinError,
  meetingErrorRoute,
  screenShareNotice,
  shownText,
} from "../src/copy.js";
import type { BannerVariant, DeviceKind, DeviceProblem } from "../src/copy.js";
import type { MeetingShellCloseReason } from "../src/types.js";

/** Every SDK error code. `satisfies` fails type-checking when the SDK adds or removes one. */
const ALL_CODES = Object.keys({
  join_token_invalid: true,
  join_token_expired: true,
  origin_not_allowed: true,
  connection_failed: true,
  join_timeout: true,
  join_cancelled: true,
  connection_lost: true,
  session_replaced: true,
  service_unavailable: true,
  rate_limited: true,
  meeting_ended: true,
  protocol_error: true,
  already_joined: true,
  engine_closed: true,
  not_joined: true,
  not_permitted: true,
  permission_denied: true,
  device_not_found: true,
  device_unavailable: true,
  screen_share_cancelled: true,
  unsupported_environment: true,
  media_connection_failed: true,
  media_participant_limit: true,
} satisfies Record<MeetingErrorCode, true>) as MeetingErrorCode[];

const CLOSE_REASONS: MeetingShellCloseReason[] = [
  "left",
  "meeting_ended",
  "session_replaced",
  "connection_lost",
  "join_failed",
  "error",
];
const KINDS: DeviceKind[] = ["camera", "microphone"];
const PROBLEMS: DeviceProblem[] = ["permission_denied", "not_found", "in_use", "disconnected", "unsupported"];
const BANNER_VARIANTS: BannerVariant[] = [
  "reconnecting",
  "peer_reconnecting",
  "reconnecting_offline",
  "failed_reconnect",
  "failed_connect",
];

/** Media-topology words. "TURN" only in capitals, since "Turn on sound" is ordinary English. */
const TOPOLOGY = /(?<![\w-])(p2p|peer-to-peer|sfu|mediasoup|ice|sdp|router|transport|producer|consumer|webrtc)(?![\w-])|(?<![\w-])TURN(?![\w-])/iu;
const TOPOLOGY_TURN_ONLY_UPPER = /(?<![\w-])TURN(?![\w-])/u;
const SNAKE_CASE = /\b[a-z0-9]+_[a-z0-9_]+\b/u;
const BROWSER_ERROR_NAME = /[A-Z][a-z]+Error\b/u;
const SENTENCE_END = /[.!?…]+(?=\s|$)/gu;

const GENERIC_JOIN_RETRY = "Something went wrong joining the meeting. Try again.";
const GENERIC_JOIN_FINAL = "Something went wrong joining the meeting. Reload the page to try again.";

/** Every failure text the shell can show, labelled for assertion messages. */
function failureTexts(): [string, string][] {
  const texts: [string, string][] = [];
  for (const kind of KINDS) for (const problem of PROBLEMS) texts.push([`device ${kind} ${problem}`, deviceMessage(kind, problem)]);
  for (const code of ALL_CODES) texts.push([`join ${code}`, shownText(joinError(code))]);
  texts.push(["join unknown", shownText(joinError("brand_new_code", false))]);
  for (const code of ALL_CODES) {
    const route = MEETING_ERRORS[code];
    if (route.route === "notice") texts.push([`notice ${code}`, shownText(route.copy)]);
  }
  texts.push(["notice unknown", shownText(GENERIC_NOTICE)]);
  for (const [code, copy] of Object.entries(SCREEN_SHARE_NOTICES)) texts.push([`screen share ${code}`, shownText(copy)]);
  for (const variant of BANNER_VARIANTS) texts.push([`banner ${variant}`, shownText(CONNECTION_BANNER[variant])]);
  for (const reason of CLOSE_REASONS) {
    texts.push([`final ${reason} heading`, finalState(reason).heading]);
    const body = finalState(reason).body;
    if (body) texts.push([`final ${reason} body`, body]);
  }
  texts.push(["announcement reconnected", ANNOUNCEMENTS.reconnected]);
  texts.push(["announcement screen on", ANNOUNCEMENTS.screenSharingOn]);
  texts.push(["announcement screen off", ANNOUNCEMENTS.screenSharingOff]);
  texts.push(["label close participants", LABELS.closeParticipants]);
  texts.push(["label full screen", LABELS.fullScreen]);
  texts.push(["label exit full screen", LABELS.exitFullScreen]);
  texts.push(["label show controls", LABELS.showControls]);
  texts.push(["announcement full screen on", ANNOUNCEMENTS.fullScreenOn]);
  texts.push(["announcement full screen off", ANNOUNCEMENTS.fullScreenOff]);
  texts.push(["full screen refusal", FULL_SCREEN_REFUSAL]);
  return texts;
}

function allCopy(): string[] {
  const strings: string[] = [];
  for (const value of Object.values(LABELS)) strings.push(typeof value === "function" ? (value as (...args: never[]) => string)(...([] as never[])) : value);
  strings.push(LABELS.participants(3), LABELS.tryDeviceAgain("camera"), LABELS.genericDevice("microphone", 2));
  for (const value of Object.values(ANNOUNCEMENTS)) strings.push(typeof value === "function" ? value("Ada") : value);
  for (const [, text] of failureTexts()) strings.push(text);
  return strings.filter((text) => typeof text === "string" && text !== "");
}

describe("speaker copy", () => {
  it("uses product language for choosing a speaker and for a failed switch", () => {
    expect(LABELS.chooseSpeaker).toBe("Choose speaker");
    expect(LABELS.speaker).toBe("Speaker");
    expect(LABELS.genericSpeaker(2)).toBe("Speaker 2");
    expect(shownText(SPEAKER_FAILURE)).toBe("Couldn't switch speakers. Try again.");
    const text = `${LABELS.chooseSpeaker} ${LABELS.speaker} ${LABELS.genericSpeaker(1)} ${shownText(SPEAKER_FAILURE)}`;
    expect(text).not.toMatch(/setSinkId|Chrome|Firefox|Safari|Edge/u);
    expect(text).not.toMatch(TOPOLOGY);
  });
});

describe("catalogue completeness", () => {
  it("maps every SDK error code in the join and in-meeting tables", () => {
    expect(Object.keys(JOIN_ERRORS).sort()).toEqual([...ALL_CODES].sort());
    expect(Object.keys(MEETING_ERRORS).sort()).toEqual([...ALL_CODES].sort());
    for (const code of ALL_CODES) expect(joinError(code).message).not.toBe("");
  });

  it("has final copy for every close reason", () => {
    expect(Object.keys(FINAL_STATES).sort()).toEqual([...CLOSE_REASONS].sort());
  });

  it("has exactly the four banner variants", () => {
    expect(Object.keys(CONNECTION_BANNER).sort()).toEqual([...BANNER_VARIANTS].sort());
  });

  it("has device copy for every problem and kind", () => {
    expect(Object.keys(DEVICE_MESSAGES).sort()).toEqual([...PROBLEMS].sort());
    for (const kind of KINDS) {
      for (const problem of PROBLEMS) expect(deviceCopy(kind, problem).message).toContain(kind === "camera" ? "amera" : "icrophone");
    }
  });

  it("gives every in-meeting code notice copy or an explicit route", () => {
    for (const code of ALL_CODES) {
      const route = MEETING_ERRORS[code];
      expect(["notice", "banner", "device", "ignored"], code).toContain(route.route);
      if (route.route === "notice") expect(route.copy.message, code).not.toBe("");
      else expect(route, code).not.toHaveProperty("copy");
    }
  });

  it("routes in-meeting codes as the contract says", () => {
    const byRoute = (name: string) => ALL_CODES.filter((code) => MEETING_ERRORS[code].route === name).sort();
    expect(byRoute("notice")).toEqual(
      [
        "not_permitted",
        "media_participant_limit",
        "rate_limited",
        "service_unavailable",
        "protocol_error",
        "unsupported_environment",
      ].sort(),
    );
    expect(byRoute("banner")).toEqual(["media_connection_failed"]);
    expect(byRoute("device")).toEqual(["device_not_found", "device_unavailable", "permission_denied"]);
    expect(byRoute("ignored")).toEqual(
      [
        "join_token_invalid",
        "join_token_expired",
        "origin_not_allowed",
        "connection_failed",
        "join_timeout",
        "join_cancelled",
        "connection_lost",
        "session_replaced",
        "meeting_ended",
        "engine_closed",
        "already_joined",
        "not_joined",
        "screen_share_cancelled",
      ].sort(),
    );
    expect(meetingErrorRoute("brand_new_code")).toEqual({ route: "notice", copy: GENERIC_NOTICE });
    expect(meetingErrorRoute("not_permitted")).toBe(MEETING_ERRORS.not_permitted);
  });
});

describe("catalogue copy", () => {
  it("joins message and guidance with one space", () => {
    expect(shownText({ message: "A.", retry: false })).toBe("A.");
    expect(shownText({ message: "A.", guidance: "B.", retry: false })).toBe("A. B.");
  });

  it.each<[DeviceProblem, string, string, boolean]>([
    [
      "permission_denied",
      "Camera permission was denied. Allow camera access from the icon next to the address bar and in your system settings, then try again.",
      "Microphone permission was denied. Allow microphone access from the icon next to the address bar and in your system settings, then try again.",
      true,
    ],
    ["not_found", "No camera was found. Connect a camera, then try again.", "No microphone was found. Connect a microphone, then try again.", true],
    [
      "in_use",
      "Your camera is being used by another app. Close it, then try again.",
      "Your microphone is being used by another app. Close it, then try again.",
      true,
    ],
    [
      "disconnected",
      "Your camera was disconnected. Reconnect it, then try again.",
      "Your microphone was disconnected. Reconnect it, then try again.",
      true,
    ],
    [
      "unsupported",
      "This browser can't use a camera here. Try a current version of Chrome, Edge, Firefox, or Safari.",
      "This browser can't use a microphone here. Try a current version of Chrome, Edge, Firefox, or Safari.",
      false,
    ],
  ])("device %s", (problem, camera, microphone, retry) => {
    expect(deviceMessage("camera", problem)).toBe(camera);
    expect(deviceMessage("microphone", problem)).toBe(microphone);
    expect(deviceCopy("camera", problem).retry).toBe(retry);
  });

  it.each<[BannerVariant, string]>([
    ["reconnecting", "Meeting connection lost — reconnecting…"],
    ["peer_reconnecting", "Audio and video interrupted — reconnecting…"],
    ["reconnecting_offline", "Meeting connection lost — reconnecting… Check your internet connection."],
    ["failed_reconnect", "Audio and video couldn't reconnect. Leave the meeting, then join again."],
    ["failed_connect", "Audio and video couldn't connect. Leave the meeting, then join again."],
  ])("banner %s", (variant, text) => {
    expect(shownText(CONNECTION_BANNER[variant])).toBe(text);
  });

  it.each<[MeetingErrorCode, string]>([
    ["not_permitted", "You can't do that in this meeting."],
    ["media_participant_limit", "Audio and video only work between two people in this meeting."],
    ["rate_limited", "Too many attempts. Wait a moment, then try again."],
    ["service_unavailable", "The meeting service is busy. Try again in a moment."],
    ["protocol_error", "Something went wrong in the meeting. If it stops working, leave and join again."],
    ["unsupported_environment", "This browser can't send or receive audio and video. Try a current version of Chrome, Edge, Firefox, or Safari."],
  ])("notice %s", (code, text) => {
    const route = MEETING_ERRORS[code];
    expect(route.route).toBe("notice");
    if (route.route === "notice") expect(shownText(route.copy)).toBe(text);
  });

  it("has the generic notice, labels, and announcement", () => {
    expect(shownText(GENERIC_NOTICE)).toBe("Something went wrong in the meeting. If it stops working, leave and join again.");
    expect(LABELS.dismiss).toBe("Dismiss");
    expect(LABELS.dismissMessage).toBe("Dismiss message");
    expect(LABELS.dismissDeviceMessage("camera")).toBe("Dismiss camera message");
    expect(LABELS.dismissDeviceMessage("microphone")).toBe("Dismiss microphone message");
    expect(ANNOUNCEMENTS.reconnected).toBe("Reconnected");
  });

  it("pins the screen sharing copy", () => {
    expect(LABELS.shareScreen).toBe("Share screen");
    expect(LABELS.sharedScreen).toBe("Shared screen");
    expect(ANNOUNCEMENTS.screenSharingOn).toBe("Screen sharing on");
    expect(ANNOUNCEMENTS.screenSharingOff).toBe("Screen sharing off");
    expect(shownText(screenShareNotice("screen_share_cancelled"))).toBe("Screen sharing was cancelled.");
    expect(shownText(screenShareNotice("permission_denied"))).toBe(
      "Screen sharing permission was denied. Allow screen sharing in your browser, then try again.",
    );
    expect(shownText(screenShareNotice("unsupported_environment"))).toBe("Screen sharing isn't available in this meeting.");
    expect(shownText(screenShareNotice("not_permitted"))).toBe("You don't have permission to share your screen.");
    expect(screenShareNotice("brand_new_code")).toBe(GENERIC_NOTICE);
  });

  it("pins the end-meeting copy", () => {
    expect(LABELS.endMeeting).toBe("End meeting");
    expect(END_MEETING_DIALOG.heading).toBe("End the meeting for everyone?");
    expect(END_MEETING_DIALOG.body).toBe("Everyone will leave the meeting.");
    expect(END_MEETING_DIALOG.confirm).toBe("End meeting");
    expect(END_MEETING_DIALOG.cancel).toBe("Cancel");
    expect(END_MEETING_FAILED).toBe("The meeting couldn't be ended. Try again.");
    expect(ANNOUNCEMENTS.endMeetingFailed).toBe("The meeting couldn't be ended. Try again.");
  });

  it("pins the participants and full screen copy", () => {
    expect(LABELS.closeParticipants).toBe("Close participants");
    expect(LABELS.fullScreen).toBe("Full screen");
    expect(LABELS.exitFullScreen).toBe("Exit full screen");
    expect(LABELS.showControls).toBe("Show controls");
    expect(ANNOUNCEMENTS.fullScreenOn).toBe("Full screen on");
    expect(ANNOUNCEMENTS.fullScreenOff).toBe("Full screen off");
    expect(FULL_SCREEN_REFUSAL).toBe("Couldn't fill the display. The shared screen is expanded in the meeting.");
  });

  it("keeps every failure text to at most two sentences, without codes or browser error names", () => {
    for (const [label, text] of failureTexts()) {
      expect((text.match(SENTENCE_END) ?? []).length, label).toBeLessThanOrEqual(2);
      expect(SNAKE_CASE.test(text), `${label}: ${text}`).toBe(false);
      expect(BROWSER_ERROR_NAME.test(text), `${label}: ${text}`).toBe(false);
    }
  });

  it("never mentions media topology", () => {
    for (const text of allCopy()) {
      const match = TOPOLOGY.exec(text);
      if (match && match[0].toLowerCase() === "turn") {
        expect(TOPOLOGY_TURN_ONLY_UPPER.test(text), text).toBe(false);
      } else {
        expect(match, text).toBeNull();
      }
    }
  });

  it("never reuses the engine's own error messages", () => {
    for (const code of ALL_CODES) {
      const engineMessage = new MeetingError(code).message;
      const shown = [shownText(joinError(code)), joinError(code).message, finalState("join_failed", code).body];
      const route = MEETING_ERRORS[code];
      if (route.route === "notice") shown.push(shownText(route.copy), route.copy.message);
      expect(shown, code).not.toContain(engineMessage);
    }
  });
});

describe("device problems", () => {
  it("maps every media error code to a device problem", () => {
    expect(deviceProblemFromCode("permission_denied")).toBe("permission_denied");
    expect(deviceProblemFromCode("device_not_found")).toBe("not_found");
    expect(deviceProblemFromCode("device_unavailable")).toBe("in_use");
    expect(deviceProblemFromCode("unsupported_environment")).toBe("unsupported");
  });

  it.each([
    ["NotAllowedError", "permission_denied"],
    ["SecurityError", "permission_denied"],
    ["NotFoundError", "not_found"],
    ["OverconstrainedError", "not_found"],
    ["NotReadableError", "in_use"],
    ["AbortError", "in_use"],
    ["SomethingNew", "in_use"],
    ["TypeError", "unsupported"],
  ])("maps the browser error %s to %s", (name, problem) => {
    expect(deviceProblemFromName(name)).toBe(problem);
  });
});

describe("join copy", () => {
  it("offers a retry only for the retryable join errors in the contract", () => {
    const retryable = ALL_CODES.filter((code) => joinError(code).retry).sort();
    expect(retryable).toEqual(
      [
        "connection_failed",
        "join_timeout",
        "service_unavailable",
        "rate_limited",
        "join_cancelled",
        "connection_lost",
        "media_connection_failed",
        "device_unavailable",
      ].sort(),
    );
    expect(joinError("join_token_expired").retry).toBe(false);
  });

  it.each<[MeetingErrorCode, string]>([
    ["join_token_invalid", "This meeting link is no longer valid. Ask for a new link."],
    ["origin_not_allowed", "This meeting can't be joined from this site."],
    ["meeting_ended", "The meeting has ended."],
    ["connection_failed", "Unable to connect to the meeting. Check your connection and try again."],
    ["rate_limited", "Too many attempts. Wait a moment, then try again."],
    ["unsupported_environment", "This browser isn't supported. Try a current version of Chrome, Edge, Firefox, or Safari."],
    ["join_cancelled", "Joining was interrupted. Try again."],
    ["session_replaced", "You're already in this meeting in another tab or on another device."],
    ["connection_lost", GENERIC_JOIN_RETRY],
    ["protocol_error", GENERIC_JOIN_FINAL],
  ])("%s", (code, text) => {
    expect(shownText(joinError(code))).toBe(text);
  });

  it("handles unknown codes with the generic message and the engine's retry hint", () => {
    expect(joinError("brand_new_code", true).retry).toBe(true);
    expect(joinError("brand_new_code", false).retry).toBe(false);
    expect(joinError("brand_new_code", true).message).toBe("Something went wrong joining the meeting.");
    expect(joinError("brand_new_code", false).message).toBe("Something went wrong joining the meeting.");
    expect(shownText(joinError("brand_new_code", true))).toBe(GENERIC_JOIN_RETRY);
    expect(shownText(joinError("brand_new_code", false))).toBe(GENERIC_JOIN_FINAL);
  });

  it("shows the join text as the body of the join-failed final screen", () => {
    expect(finalState("join_failed", "meeting_ended")).toEqual({
      heading: "Unable to join this meeting",
      body: "The meeting has ended.",
    });
    expect(finalState("join_failed", "join_token_expired").body).toBe("This meeting link is no longer valid. Ask for a new link.");
    expect(finalState("join_failed", "brand_new_code").body).toBe(GENERIC_JOIN_FINAL);
  });
});