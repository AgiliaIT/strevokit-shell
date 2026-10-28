import { screen, within } from "@testing-library/dom";
import { userEvent } from "@testing-library/user-event";
import type { MeetingErrorCode } from "@strevokit/meeting-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogueCopy } from "../src/copy.js";
import { SHOW_AFTER_MS, STABLE_MS } from "../src/errors/connectionBanner.js";
import { MeetingNotices, NOTICE_BURST_MS } from "../src/errors/meetingNotices.js";
import { SvkAnnouncer } from "../src/elements/svk-announcer.js";
import { setBrowserOnline } from "./support/fakeBrowser.js";
import { participant, type FakeEngine } from "./support/fakeEngine.js";
import { createShell, joinMeeting, liveRegion, settle, type Shell } from "./support/fixture.js";

const RECONNECTING = "Connection lost — reconnecting…";
const RECONNECTING_OFFLINE = "Connection lost — reconnecting… Check your internet connection.";
const FAILED_RECONNECT = "Audio and video couldn't reconnect. Leave the meeting, then join again.";

/** Joins with one remote participant whose media is connected, then switches to fake timers. */
async function joinWithRemote(): Promise<{ shell: Shell; engine: FakeEngine; announced: string[] }> {
  const shell = await createShell();
  await joinMeeting(shell);
  const engine = shell.engines.last;
  engine.addParticipant(participant("remote-1", "Grace Hopper"));
  engine.setConnection("remote-1", "connected");
  await shell.settle();
  const announced: string[] = [];
  const announce = SvkAnnouncer.prototype.announce;
  vi.spyOn(SvkAnnouncer.prototype, "announce").mockImplementation(function (this: SvkAnnouncer, text: string) {
    announced.push(text);
    announce.call(this, text);
  });
  vi.useFakeTimers();
  return { shell, engine, announced };
}

async function advance(shell: Shell, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await shell.settle();
}

function meetingMessage(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".svk-meeting-message");
}

function toolbar(): HTMLElement {
  return screen.getByRole("toolbar", { name: "Meeting controls" });
}

function expectControlsUsable(): void {
  for (const name of ["Microphone", "Camera", /^Participants \(\d+\)$/u, "Leave meeting"]) {
    const button = within(toolbar()).getByRole("button", { name });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-disabled", "true");
  }
}

describe("connection banner", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("appears above the tiles after the threshold, announced politely, without moving focus", async () => {
    const { shell, engine, announced } = await joinWithRemote();
    const focused = document.activeElement;
    engine.setConnection("remote-1", "interrupted");
    await advance(shell, SHOW_AFTER_MS - 1);
    expect(meetingMessage()).toBeNull();
    await advance(shell, 1);

    const stage = document.querySelector(".svk-stage");
    expect(stage?.firstElementChild?.tagName).toBe("SVK-MEETING-MESSAGE");
    const message = stage?.firstElementChild?.querySelector(".svk-meeting-message");
    expect(message).toBe(meetingMessage());
    expect(message).toHaveAttribute("data-type", "banner");
    expect(message).toHaveAttribute("data-tone", "warning");
    expect(message).toHaveTextContent(RECONNECTING);
    expect(message).not.toHaveAttribute("role");
    expect(liveRegion()).toHaveTextContent(RECONNECTING);
    expect(announced.filter((text) => text === RECONNECTING)).toHaveLength(1);
    expect(document.activeElement).toBe(focused);
    expectControlsUsable();
  });

  it("clears after recovery and announces Reconnected once", async () => {
    const { shell, engine, announced } = await joinWithRemote();
    engine.setConnection("remote-1", "interrupted");
    await advance(shell, SHOW_AFTER_MS);
    engine.setConnection("remote-1", "connected");
    await advance(shell, STABLE_MS);
    expect(meetingMessage()).toBeNull();
    expect(liveRegion()).toHaveTextContent("Reconnected");
    expect(announced.filter((text) => text === "Reconnected")).toHaveLength(1);
    await advance(shell, STABLE_MS * 3);
    expect(announced.filter((text) => text === "Reconnected")).toHaveLength(1);
  });

  it("shows the failure in the danger tone, and Leave still leaves", async () => {
    const { shell, engine } = await joinWithRemote();
    engine.setConnection("remote-1", "failed");
    await shell.settle();
    expect(meetingMessage()).toHaveAttribute("data-tone", "danger");
    expect(meetingMessage()).toHaveTextContent(FAILED_RECONNECT);
    expect(liveRegion()).toHaveTextContent(FAILED_RECONNECT);
    expectControlsUsable();
    within(toolbar()).getByRole("button", { name: "Leave meeting" }).click();
    await shell.settle();
    await shell.settle();
    expect(screen.getByRole("heading", { name: "You left the meeting" })).toBeInTheDocument();
    expect(shell.closed).toEqual([{ reason: "left" }]);
  });

  it("blames the participant's own network only while the browser is offline", async () => {
    const { shell } = await joinWithRemote();
    setBrowserOnline(false);
    await advance(shell, SHOW_AFTER_MS);
    expect(meetingMessage()).toHaveTextContent(RECONNECTING_OFFLINE);
    setBrowserOnline(true);
    await advance(shell, STABLE_MS);
    expect(meetingMessage()).toBeNull();
    expect(liveRegion()).toHaveTextContent("Reconnected");
  });

  it("shows nothing for an interruption shorter than the threshold", async () => {
    const { shell, engine, announced } = await joinWithRemote();
    engine.setConnection("remote-1", "interrupted");
    await advance(shell, SHOW_AFTER_MS / 2);
    engine.setConnection("remote-1", "connected");
    await advance(shell, SHOW_AFTER_MS * 3);
    expect(meetingMessage()).toBeNull();
    expect(announced.filter((text) => text === RECONNECTING || text === "Reconnected")).toEqual([]);
  });

  it("shows no banner on the pre-join screen or while joining", async () => {
    const shell = await createShell({ engine: (engine) => (engine.joinOutcome = "pending") });
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace Hopper"));
    engine.setConnection("remote-1", "interrupted");
    setBrowserOnline(false);
    await shell.settle();
    await new Promise((resolve) => setTimeout(resolve, SHOW_AFTER_MS + 50));
    await shell.settle();
    expect(meetingMessage()).toBeNull();
    await shell.user.click(screen.getByRole("button", { name: "Join meeting" }));
    engine.setConnection("remote-1", "failed");
    await new Promise((resolve) => setTimeout(resolve, SHOW_AFTER_MS + 50));
    await shell.settle();
    expect(screen.getByRole("button", { name: "Joining…" })).toBeInTheDocument();
    expect(meetingMessage()).toBeNull();
    expect(shell.element.textContent).not.toContain("Connection lost");
  });

  it("clears silently when the affected participant leaves", async () => {
    const { shell, engine, announced } = await joinWithRemote();
    engine.setConnection("remote-1", "interrupted");
    await advance(shell, SHOW_AFTER_MS);
    engine.removeParticipant("remote-1");
    await advance(shell, STABLE_MS * 2);
    expect(meetingMessage()).toBeNull();
    expect(liveRegion()).toHaveTextContent("Grace Hopper left");
    expect(announced).not.toContain("Reconnected");
  });

  it("gives way to the Connection lost final screen when the session ends", async () => {
    const { shell, engine } = await joinWithRemote();
    engine.setConnection("remote-1", "interrupted");
    await advance(shell, SHOW_AFTER_MS);
    engine.close("connection_lost");
    await shell.settle();
    expect(screen.getByRole("heading", { name: "Connection lost" })).toBeInTheDocument();
    expect(meetingMessage()).toBeNull();
    expect(engine.localMediaState).toMatchObject({ camera: false, microphone: false });
    await advance(shell, STABLE_MS);
    expect(shell.closed).toEqual([{ reason: "connection_lost" }]);
  });

  it("shows the meeting-ended final screen when the meeting ends", async () => {
    const { shell, engine } = await joinWithRemote();
    engine.setConnection("remote-1", "failed");
    await shell.settle();
    engine.close("meeting_ended");
    await shell.settle();
    expect(screen.getByRole("heading", { name: "The meeting has ended." })).toBeInTheDocument();
    expect(meetingMessage()).toBeNull();
  });

  it("shows and announces nothing once leaving has started", async () => {
    const { shell, engine, announced } = await joinWithRemote();
    engine.setConnection("remote-1", "interrupted");
    await advance(shell, SHOW_AFTER_MS / 2);
    void shell.element.leave();
    engine.setConnection("remote-1", "failed");
    await advance(shell, SHOW_AFTER_MS * 3);
    expect(meetingMessage()).toBeNull();
    expect(announced.filter((text) => text.startsWith("Connection lost") || text.startsWith("Audio and video"))).toEqual([]);
  });

  it("shows and announces nothing once the element has been removed", async () => {
    const { shell, engine, announced } = await joinWithRemote();
    engine.setConnection("remote-1", "interrupted");
    await advance(shell, SHOW_AFTER_MS / 2);
    shell.element.remove();
    await settle();
    await advance(shell, SHOW_AFTER_MS * 3);
    expect(announced.filter((text) => text.startsWith("Connection lost"))).toEqual([]);
  });
});

const NOT_PERMITTED = "You can't do that in this meeting.";
const GENERIC = "Something went wrong in the meeting. If it stops working, leave and join again.";
const SENTINEL = "sentinel-engine-message-9012";

const NOTICES: [MeetingErrorCode, string][] = [
  ["not_permitted", NOT_PERMITTED],
  ["media_participant_limit", "Audio and video only work between two people in this meeting."],
  ["rate_limited", "Too many attempts. Wait a moment, then try again."],
  ["service_unavailable", "The meeting service is busy. Try again in a moment."],
  ["protocol_error", GENERIC],
  [
    "unsupported_environment",
    "This browser can't send or receive audio and video. Try a current version of Chrome, Edge, Firefox, or Safari.",
  ],
];

const NOT_SHOWN: MeetingErrorCode[] = [
  "media_connection_failed",
  "permission_denied",
  "device_not_found",
  "device_unavailable",
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
];

function dismissButton(): HTMLElement {
  return screen.getByRole("button", { name: "Dismiss message" });
}

describe("notices", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(NOTICES)("%s shows its notice, announced politely, without moving focus", async (code, text) => {
    const { shell, engine, announced } = await joinWithRemote();
    const focused = document.activeElement;
    engine.emitError(code);
    await shell.settle();
    const message = meetingMessage();
    expect(message).toHaveAttribute("data-type", "notice");
    expect(message).toHaveAttribute("data-tone", "warning");
    expect(message?.querySelector(".svk-meeting-message-text")).toHaveTextContent(text);
    expect(dismissButton()).toHaveTextContent("Dismiss");
    expect(liveRegion()).toHaveTextContent(text);
    expect(announced.filter((entry) => entry === text)).toHaveLength(1);
    expect(document.activeElement).toBe(focused);
    expectControlsUsable();
    expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
    expect(shell.closed).toEqual([]);
  });

  it("shows the generic notice for an unknown code, never the engine's message", async () => {
    const { shell, engine } = await joinWithRemote();
    engine.emitError("brand_new_code", SENTINEL);
    await shell.settle();
    expect(meetingMessage()).toHaveTextContent(GENERIC);
    engine.emitError("not_permitted", SENTINEL);
    await shell.settle();
    expect(meetingMessage()).toHaveTextContent(NOT_PERMITTED);
    expect(shell.element.textContent).not.toContain(SENTINEL);
    expect(shell.element.textContent).not.toContain("brand_new_code");
  });

  it.each(NOT_SHOWN)("%s shows and announces nothing as a notice", async (code) => {
    const { shell, engine, announced } = await joinWithRemote();
    engine.emitError(code);
    await shell.settle();
    expect(meetingMessage()).toBeNull();
    expect(announced).toEqual([]);
  });

  it("shows nothing for errors before the meeting or once leaving has started", async () => {
    const shell = await createShell();
    shell.engines.last.emitError("not_permitted");
    await shell.settle();
    await joinMeeting(shell);
    expect(meetingMessage()).toBeNull();

    const engine = shell.engines.last;
    const leaving = shell.element.leave();
    engine.emitError("not_permitted");
    await leaving;
    await shell.settle();
    expect(screen.getByRole("heading", { name: "You left the meeting" })).toBeInTheDocument();
    expect(shell.element.textContent).not.toContain(NOT_PERMITTED);
  });

  it("merges a repeat within the burst window and announces again after it", async () => {
    const { shell, engine, announced } = await joinWithRemote();
    engine.emitError("not_permitted");
    await shell.settle();
    await advance(shell, NOTICE_BURST_MS - 1000);
    engine.emitError("not_permitted");
    await shell.settle();
    expect(document.querySelectorAll(".svk-meeting-message")).toHaveLength(1);
    expect(announced.filter((entry) => entry === NOT_PERMITTED)).toHaveLength(1);
    await advance(shell, NOTICE_BURST_MS + 1);
    engine.emitError("not_permitted");
    await shell.settle();
    expect(document.querySelectorAll(".svk-meeting-message")).toHaveLength(1);
    expect(announced.filter((entry) => entry === NOT_PERMITTED)).toHaveLength(2);
  });

  it("replaces the notice with a different code", async () => {
    const { shell, engine } = await joinWithRemote();
    engine.emitError("not_permitted");
    await shell.settle();
    engine.emitError("rate_limited");
    await shell.settle();
    expect(document.querySelectorAll(".svk-meeting-message")).toHaveLength(1);
    expect(meetingMessage()).toHaveTextContent("Too many attempts. Wait a moment, then try again.");
  });

  it("keeps a notice hidden under the banner and shows it when the banner clears", async () => {
    const { shell, engine, announced } = await joinWithRemote();
    engine.setConnection("remote-1", "interrupted");
    await advance(shell, SHOW_AFTER_MS);
    engine.emitError("rate_limited");
    engine.emitError("not_permitted");
    await shell.settle();
    expect(meetingMessage()).toHaveAttribute("data-type", "banner");
    expect(announced).not.toContain(NOT_PERMITTED);

    engine.setConnection("remote-1", "connected");
    await advance(shell, STABLE_MS);
    expect(meetingMessage()).toHaveAttribute("data-type", "notice");
    expect(meetingMessage()).toHaveTextContent(NOT_PERMITTED);
    expect(announced).toContain(NOT_PERMITTED);
    expect(announced).toContain("Reconnected");
    expect(announced).not.toContain("Too many attempts. Wait a moment, then try again.");
    expect(liveRegion()).toHaveTextContent("Reconnected");
    expect(liveRegion()).toHaveTextContent(NOT_PERMITTED);
  });

  it("puts a failure banner above a notice", async () => {
    const { shell, engine } = await joinWithRemote();
    engine.emitError("not_permitted");
    await shell.settle();
    engine.setConnection("remote-1", "failed");
    await shell.settle();
    expect(document.querySelectorAll(".svk-meeting-message")).toHaveLength(1);
    expect(meetingMessage()).toHaveAttribute("data-tone", "danger");
  });

  it("is dismissed by pointer, and comes back only when reported again", async () => {
    const { shell, engine } = await joinWithRemote();
    engine.emitError("not_permitted");
    await shell.settle();
    const focused = document.activeElement;
    dismissButton().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await shell.settle();
    expect(meetingMessage()).toBeNull();
    expect(document.activeElement).toBe(focused);
    await advance(shell, NOTICE_BURST_MS * 2);
    expect(meetingMessage()).toBeNull();
    engine.emitError("not_permitted");
    await shell.settle();
    expect(meetingMessage()).toHaveTextContent(NOT_PERMITTED);
  });

  it.each(["{Enter}", " "])("is dismissed with %j from the keyboard, moving focus to the Microphone toggle", async (key) => {
    const { shell, engine } = await joinWithRemote();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
    engine.emitError("not_permitted");
    await shell.settle();
    dismissButton().focus();
    expect(dismissButton()).toHaveFocus();
    await user.keyboard(key);
    await shell.settle();
    await shell.settle();
    expect(meetingMessage()).toBeNull();
    expect(within(toolbar()).getByRole("button", { name: "Microphone" })).toHaveFocus();
  });

  it.each([
    ["leaving", (shell: Shell) => void shell.element.leave()],
    ["the meeting ending", (_shell: Shell, engine: FakeEngine) => engine.close("meeting_ended")],
  ] as const)("is cleared silently by %s", async (_case, end) => {
    const { shell, engine, announced } = await joinWithRemote();
    engine.emitError("not_permitted");
    await shell.settle();
    const before = announced.length;
    end(shell, engine);
    await shell.settle();
    await shell.settle();
    expect(meetingMessage()).toBeNull();
    expect(announced.slice(before)).not.toContain(NOT_PERMITTED);
  });

  it("is cleared silently when the element is removed", async () => {
    const { shell, engine, announced } = await joinWithRemote();
    engine.emitError("not_permitted");
    await shell.settle();
    const before = announced.length;
    shell.element.remove();
    await settle();
    engine.emitError("rate_limited");
    await advance(shell, NOTICE_BURST_MS * 2);
    expect(announced.slice(before)).toEqual([]);
  });
});

describe("MeetingNotices", () => {
  const A: CatalogueCopy = { message: "A.", retry: false };
  const B: CatalogueCopy = { message: "B.", retry: false };

  function createNotices() {
    let time = 0;
    const changes: (CatalogueCopy | null)[] = [];
    const shown: string[] = [];
    const notices = new MeetingNotices({
      now: () => time,
      onChange: (copy) => changes.push(copy),
      shown: (code) => shown.push(code),
    });
    return { notices, changes, shown, tick: (ms: number) => (time += ms) };
  }

  it("holds one notice; a new code replaces it", () => {
    const { notices, changes, shown } = createNotices();
    notices.report("a", A);
    notices.report("b", B);
    expect(notices.visible).toBe(B);
    expect(changes).toEqual([A, B]);
    expect(shown).toEqual(["a", "b"]);
  });

  it("merges repeats within the burst window and re-announces after it", () => {
    const { notices, changes, shown, tick } = createNotices();
    notices.report("a", A);
    tick(NOTICE_BURST_MS);
    notices.report("a", A);
    expect(shown).toEqual(["a"]);
    tick(NOTICE_BURST_MS + 1);
    notices.report("a", A);
    expect(shown).toEqual(["a", "a"]);
    expect(changes).toEqual([A]);
  });

  it("hides the notice while hidden, and shows the latest when unhidden", () => {
    const { notices, changes, shown } = createNotices();
    notices.setHidden(true);
    notices.report("a", A);
    notices.report("b", B);
    expect(notices.visible).toBeNull();
    expect(shown).toEqual([]);
    notices.setHidden(false);
    expect(notices.visible).toBe(B);
    expect(changes).toEqual([B]);
    expect(shown).toEqual(["b"]);
  });

  it("does not announce again a notice that was already shown before it was hidden", () => {
    const { notices, changes, shown } = createNotices();
    notices.report("a", A);
    notices.setHidden(true);
    notices.setHidden(false);
    expect(changes).toEqual([A, null, A]);
    expect(shown).toEqual(["a"]);
  });

  it("clears on dismiss, and a dismissed notice comes back only when reported again", () => {
    const { notices, changes, shown } = createNotices();
    notices.report("a", A);
    notices.dismiss();
    expect(notices.visible).toBeNull();
    expect(changes).toEqual([A, null]);
    notices.report("a", A);
    expect(notices.visible).toBe(A);
    expect(shown).toEqual(["a", "a"]);
  });

  it("emits nothing on reset", () => {
    const { notices, changes, shown } = createNotices();
    notices.setHidden(true);
    notices.report("a", A);
    notices.reset();
    notices.setHidden(false);
    expect(notices.visible).toBeNull();
    expect(changes).toEqual([]);
    expect(shown).toEqual([]);
  });
});
