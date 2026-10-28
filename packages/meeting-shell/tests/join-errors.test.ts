import { screen } from "@testing-library/dom";
import { MeetingError } from "@strevokit/meeting-sdk";
import type { MeetingErrorCode } from "@strevokit/meeting-sdk";
import { describe, expect, it } from "vitest";
import type { JoinFailure } from "./support/fakeEngine.js";
import { createShell } from "./support/fixture.js";

const SENTINEL = "sentinel-engine-message-5678";
const SNAKE_CASE = /\b[a-z0-9]+_[a-z0-9_]+\b/u;

const INVALID_LINK = "This meeting link is no longer valid. Ask for a new link.";
const UNABLE_TO_CONNECT = "Unable to connect to the meeting. Check your connection and try again.";
const GENERIC_RETRY = "Something went wrong joining the meeting. Try again.";
const GENERIC_FINAL = "Something went wrong joining the meeting. Reload the page to try again.";

/** Join failures shown on the pre-join screen with "Try again". */
const RETRYABLE: [MeetingErrorCode, string][] = [
  ["connection_failed", UNABLE_TO_CONNECT],
  ["join_timeout", UNABLE_TO_CONNECT],
  ["service_unavailable", UNABLE_TO_CONNECT],
  ["rate_limited", "Too many attempts. Wait a moment, then try again."],
  ["join_cancelled", "Joining was interrupted. Try again."],
  ["connection_lost", GENERIC_RETRY],
  ["media_connection_failed", GENERIC_RETRY],
  ["device_unavailable", GENERIC_RETRY],
];

/** Join failures that go to the "Unable to join this meeting" final screen. */
const FINAL: [MeetingErrorCode, string][] = [
  ["join_token_invalid", INVALID_LINK],
  ["join_token_expired", INVALID_LINK],
  ["origin_not_allowed", "This meeting can't be joined from this site."],
  ["unsupported_environment", "This browser isn't supported. Try a current version of Chrome, Edge, Firefox, or Safari."],
  ["session_replaced", "You're already in this meeting in another tab or on another device."],
  ["protocol_error", GENERIC_FINAL],
  ["already_joined", GENERIC_FINAL],
  ["engine_closed", GENERIC_FINAL],
  ["not_joined", GENERIC_FINAL],
  ["not_permitted", GENERIC_FINAL],
  ["permission_denied", GENERIC_FINAL],
  ["device_not_found", GENERIC_FINAL],
  ["screen_share_cancelled", GENERIC_FINAL],
  ["media_participant_limit", GENERIC_FINAL],
];

function failure(code: string, retryable?: boolean): JoinFailure {
  const hint = retryable ?? new MeetingError(code as MeetingErrorCode).retryable;
  return { code, retryable: hint, message: SENTINEL };
}

async function failJoin(outcome: JoinFailure | MeetingErrorCode) {
  const shell = await createShell({ engine: (engine, index) => (engine.joinOutcome = index === 0 ? outcome : "resolve") });
  await shell.user.click(screen.getByRole("button", { name: "Join meeting" }));
  await shell.settle();
  return shell;
}

function expectNothingTechnical(element: HTMLElement): void {
  expect(element.textContent).not.toContain(SENTINEL);
  expect(SNAKE_CASE.test(element.textContent ?? "")).toBe(false);
}

describe("retryable join errors", () => {
  it.each(RETRYABLE)("%s shows its copy in an alert with Try again, which joins on a fresh engine", async (code, copy) => {
    const shell = await failJoin(failure(code));
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(copy);
    expect(screen.getByRole("region", { name: "Meeting setup" })).toBeInTheDocument();
    expect(shell.closed).toEqual([]);
    expectNothingTechnical(shell.element);

    await shell.user.click(screen.getByRole("button", { name: "Try again" }));
    await shell.settle();
    expect(shell.engines.engines).toHaveLength(2);
    expect(shell.engines.last.callsTo("join")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("uses the generic retry copy for an unknown code the engine says can be retried", async () => {
    const shell = await failJoin(failure("brand_new_code", true));
    expect(screen.getByRole("alert")).toHaveTextContent(GENERIC_RETRY);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expectNothingTechnical(shell.element);
  });
});

describe("final join errors", () => {
  it.each(FINAL)("%s goes to the final screen with its copy and no retry", async (code, copy) => {
    const shell = await failJoin(failure(code));
    expect(screen.getByRole("heading", { level: 2, name: "Unable to join this meeting" })).toHaveFocus();
    expect(screen.getByRole("region", { name: "Meeting" })).toHaveTextContent(copy);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(shell.closed).toEqual([{ reason: "join_failed" }]);
    expect(shell.devices?.liveTracks()).toEqual([]);
    expectNothingTechnical(shell.element);
  });

  it("meeting_ended goes to the meeting_ended final screen with close reason meeting_ended", async () => {
    const shell = await failJoin(failure("meeting_ended"));
    expect(screen.getByRole("heading", { level: 2, name: "The meeting has ended." })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(shell.closed).toEqual([{ reason: "meeting_ended" }]);
    expect(shell.devices?.liveTracks()).toEqual([]);
    expectNothingTechnical(shell.element);
  });

  it("uses the generic final copy for an unknown code the engine says can't be retried", async () => {
    const shell = await failJoin(failure("brand_new_code", false));
    expect(screen.getByRole("heading", { level: 2, name: "Unable to join this meeting" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Meeting" })).toHaveTextContent(GENERIC_FINAL);
    expectNothingTechnical(shell.element);
  });

  it("never shows the engine's own error message", async () => {
    await failJoin("join_token_invalid");
    expect(document.body.textContent).not.toContain(new MeetingError("join_token_invalid").message);
  });
});
