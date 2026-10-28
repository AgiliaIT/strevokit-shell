import { screen, within } from "@testing-library/dom";
import { MeetingError } from "@strevokit/meeting-sdk";
import type { MeetingLogger } from "@strevokit/meeting-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHOW_AFTER_MS, STABLE_MS } from "../src/errors/connectionBanner.js";
import { reportFailure, reportRecovery, safeCode } from "../src/errors/diagnostics.js";
import { NOTICE_BURST_MS } from "../src/errors/meetingNotices.js";
import { setBrowserOnline, stubPermissions } from "./support/fakeBrowser.js";
import { participant, type FakeEngine } from "./support/fakeEngine.js";
import { FakeMediaDevices } from "./support/fakeMediaDevices.js";
import { TOKEN, createShell, joinMeeting, settle, type Shell, type ShellOptions } from "./support/fixture.js";

type Fields = Readonly<Record<string, string | number | boolean>>;

function recordingLogger() {
  const entries: { level: string; message: string; fields: Fields | undefined }[] = [];
  const record =
    (level: string) =>
    (message: string, fields?: Fields): void => {
      entries.push({ level, message, fields });
    };
  const logger: MeetingLogger = { debug: record("debug"), info: record("info"), warn: record("warn"), error: record("error") };
  return { logger, entries };
}

function spyOnConsole() {
  return (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
}

describe("diagnostics module", () => {
  it("writes one warn entry with exactly the given fields", () => {
    const { logger, entries } = recordingLogger();
    reportFailure(logger, { surface: "device", phase: "prejoin", code: "permission_denied", kind: "camera", retry: true });
    expect(entries).toEqual([
      {
        level: "warn",
        message: "meeting shell showed a failure",
        fields: { surface: "device", phase: "prejoin", code: "permission_denied", kind: "camera", retry: true },
      },
    ]);
  });

  it("omits optional fields that are not given", () => {
    const { logger, entries } = recordingLogger();
    reportFailure(logger, { surface: "final", phase: "final", reason: "connection_lost" });
    reportFailure(logger, { surface: "notice", phase: "in_meeting", code: "not_permitted", kind: undefined, retry: undefined });
    expect(entries.map((entry) => entry.fields)).toEqual([
      { surface: "final", phase: "final", reason: "connection_lost" },
      { surface: "notice", phase: "in_meeting", code: "not_permitted" },
    ]);
  });

  it.each(["", "Not_Permitted", "has space", "a".repeat(65), "Something went wrong: token=abc", "1code", "code-with-dash"])(
    "writes the unsafe code %j as unknown",
    (code) => {
      const { logger, entries } = recordingLogger();
      reportFailure(logger, { surface: "notice", phase: "in_meeting", code });
      expect(entries[0]?.fields?.["code"]).toBe("unknown");
      expect(safeCode(code)).toBe("unknown");
    },
  );

  it("keeps safe codes as they are", () => {
    expect(safeCode("media_interrupted")).toBe("media_interrupted");
    expect(safeCode("a".repeat(64))).toBe("a".repeat(64));
  });

  it("writes recovery at info with a whole number of milliseconds", () => {
    const { logger, entries } = recordingLogger();
    reportRecovery(logger, 1234.6);
    expect(entries).toEqual([
      {
        level: "info",
        message: "meeting shell connection recovered",
        fields: { surface: "banner", phase: "in_meeting", interruptedMs: 1235 },
      },
    ]);
  });

  it("does nothing without a logger, or with a logger missing the level", () => {
    const spies = spyOnConsole();
    expect(() => reportFailure(null, { surface: "join", phase: "joining", code: "join_timeout", retry: true })).not.toThrow();
    expect(() => reportRecovery(null, 10)).not.toThrow();
    expect(() => reportFailure({}, { surface: "join", phase: "joining", code: "join_timeout" })).not.toThrow();
    expect(() => reportRecovery({ warn: () => {} }, 10)).not.toThrow();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("never writes to the console", () => {
    const spies = spyOnConsole();
    const { logger } = recordingLogger();
    reportFailure(logger, { surface: "banner", phase: "in_meeting", code: "browser_offline" });
    reportRecovery(logger, 1000);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});

const FAILURE = "meeting shell showed a failure";
const RECOVERED = "meeting shell connection recovered";

/** The recording logger and element of the running test, checked after each test. */
let recorded: { entries: ReturnType<typeof recordingLogger>["entries"]; element: HTMLElement } | null = null;

async function shellWithLogger(options: ShellOptions = {}) {
  const { logger, entries } = recordingLogger();
  const shell = await createShell({ ...options, logger });
  recorded = { entries, element: shell.element };
  const failures = () => entries.filter((entry) => entry.message === FAILURE).map((entry) => entry.fields);
  const recoveries = () => entries.filter((entry) => entry.message === RECOVERED).map((entry) => entry.fields);
  return { shell, entries, failures, recoveries };
}

/** Joins with one connected remote participant. */
async function joinedWithRemote(options: ShellOptions = {}) {
  const setup = await shellWithLogger(options);
  await joinMeeting(setup.shell);
  const engine = setup.shell.engines.last;
  engine.addParticipant(participant("remote-1", "Grace Hopper"));
  engine.setConnection("remote-1", "connected");
  await setup.shell.settle();
  return { ...setup, engine };
}

async function advance(shell: Shell, ms: number): Promise<void> {
  vi.advanceTimersByTime(ms);
  await shell.settle();
}

function toolbar(): HTMLElement {
  return screen.getByRole("toolbar", { name: "Meeting controls" });
}

describe("shell entries", () => {
  afterEach(() => {
    vi.useRealTimers();
    const current = recorded;
    recorded = null;
    if (!current) return;
    for (const entry of current.entries) expect(JSON.stringify(entry)).not.toContain(TOKEN);
    const text = current.element.textContent ?? "";
    for (const entry of current.entries) {
      const code = entry.fields?.["code"];
      if (typeof code === "string") expect(text, `rendered text contains the code ${code}`).not.toContain(code);
    }
  });

  describe("device", () => {
    it("writes one entry when the preview is denied, and again only after it was cleared", async () => {
      const devices = new FakeMediaDevices();
      devices.failures.camera = "NotAllowedError";
      const { shell, failures } = await shellWithLogger({ devices });
      expect(failures()).toEqual([
        { surface: "device", phase: "prejoin", code: "permission_denied", kind: "camera", retry: true },
      ]);
      await shell.user.click(screen.getByRole("button", { name: "Microphone" }));
      await shell.settle();
      await shell.user.click(screen.getByRole("button", { name: "Microphone" }));
      await shell.settle();
      expect(failures()).toHaveLength(1);

      await shell.user.click(screen.getByRole("button", { name: "Try camera again" }));
      await shell.settle();
      expect(failures()).toHaveLength(1);

      delete devices.failures.camera;
      await shell.user.click(screen.getByRole("button", { name: "Try camera again" }));
      await shell.settle();
      expect(failures()).toHaveLength(1);

      const camera = screen.getByRole("button", { name: "Camera" });
      await shell.user.click(camera);
      await shell.settle();
      devices.failures.camera = "NotAllowedError";
      await shell.user.click(camera);
      await shell.settle();
      expect(failures()).toHaveLength(2);
      expect(failures()[1]).toEqual(failures()[0]);
    });

    it.each([
      ["NotFoundError", "device_not_found", true],
      ["NotReadableError", "device_unavailable", true],
    ] as const)("reports a preview %s as %s", async (name, code, retry) => {
      const devices = new FakeMediaDevices();
      devices.failures.microphone = name;
      const { failures } = await shellWithLogger({ devices });
      expect(failures()).toEqual([{ surface: "device", phase: "prejoin", code, kind: "microphone", retry }]);
    });

    it("reports a browser without media devices as unsupported, without a retry", async () => {
      const { failures } = await shellWithLogger({ devices: null });
      expect(failures()).toHaveLength(2);
      expect(failures()).toEqual(
        expect.arrayContaining([
          { surface: "device", phase: "prejoin", code: "unsupported_environment", kind: "microphone", retry: false },
          { surface: "device", phase: "prejoin", code: "unsupported_environment", kind: "camera", retry: false },
        ]),
      );
    });

    it("reports a rejected device call in the meeting with the engine code, once while it stays up", async () => {
      const { shell, engine, failures } = await joinedWithRemote();
      await shell.user.click(within(toolbar()).getByRole("button", { name: "Camera" }));
      await shell.settle();
      expect(failures()).toEqual([]);
      engine.mediaOutcomes.enableCamera = "device_unavailable";
      await shell.user.click(within(toolbar()).getByRole("button", { name: "Camera" }));
      await shell.settle();
      expect(failures()).toEqual([
        { surface: "device", phase: "in_meeting", code: "device_unavailable", kind: "camera", retry: true },
      ]);
      await shell.user.click(screen.getByRole("button", { name: "Try camera again" }));
      await shell.settle();
      expect(failures()).toHaveLength(1);
    });

    it("reports a capture ended without a revoked permission as device_disconnected", async () => {
      stubPermissions({ camera: "granted" });
      const { shell, engine, failures } = await joinedWithRemote();
      engine.setLocalMedia("camera", false);
      await shell.settle();
      await shell.settle();
      expect(failures()).toEqual([
        { surface: "device", phase: "in_meeting", code: "device_disconnected", kind: "camera", retry: true },
      ]);
    });

    it("reports a capture ended by a revoked permission as permission_denied", async () => {
      stubPermissions({ microphone: "denied" });
      const { shell, engine, failures } = await joinedWithRemote();
      engine.setLocalMedia("microphone", false);
      await shell.settle();
      await shell.settle();
      expect(failures()).toEqual([
        { surface: "device", phase: "in_meeting", code: "permission_denied", kind: "microphone", retry: true },
      ]);
    });
  });

  describe("join", () => {
    it("reports a retryable join failure on the pre-join screen", async () => {
      const { shell, failures } = await shellWithLogger({
        engine: (engine, index) => (engine.joinOutcome = index === 0 ? "connection_failed" : "resolve"),
      });
      await shell.user.click(screen.getByRole("button", { name: "Join meeting" }));
      await shell.settle();
      expect(failures()).toEqual([{ surface: "join", phase: "joining", code: "connection_failed", retry: true }]);
    });

    it("reports a join failure that can't be retried on the final screen", async () => {
      const { shell, failures } = await shellWithLogger({ engine: (engine) => (engine.joinOutcome = "join_token_invalid") });
      await shell.user.click(screen.getByRole("button", { name: "Join meeting" }));
      await shell.settle();
      expect(failures()).toEqual([{ surface: "final", phase: "final", code: "join_token_invalid", reason: "join_failed" }]);
    });

    it("reports an engine that could not be created", async () => {
      const { failures } = await shellWithLogger({
        engine: () => {
          throw new MeetingError("join_token_invalid");
        },
      });
      expect(failures()).toEqual([{ surface: "final", phase: "final", code: "join_token_invalid", reason: "join_failed" }]);
    });
  });

  describe("banner", () => {
    it("reports reconnecting, then the recovery with how long it lasted", async () => {
      const { shell, engine, failures, recoveries } = await joinedWithRemote();
      vi.useFakeTimers();
      engine.setConnection("remote-1", "interrupted");
      await advance(shell, SHOW_AFTER_MS);
      expect(failures()).toEqual([{ surface: "banner", phase: "in_meeting", code: "media_interrupted" }]);
      setBrowserOnline(false);
      await shell.settle();
      setBrowserOnline(true);
      await shell.settle();
      expect(failures()).toHaveLength(1);
      engine.setConnection("remote-1", "connected");
      await advance(shell, STABLE_MS);
      expect(recoveries()).toEqual([{ surface: "banner", phase: "in_meeting", interruptedMs: STABLE_MS }]);
    });

    it("reports the offline banner as browser_offline", async () => {
      const { shell, failures } = await joinedWithRemote();
      vi.useFakeTimers();
      setBrowserOnline(false);
      await advance(shell, SHOW_AFTER_MS);
      expect(failures()).toEqual([{ surface: "banner", phase: "in_meeting", code: "browser_offline" }]);
    });

    it("reports a failure banner as media_connection_failed", async () => {
      const { shell, engine, failures } = await joinedWithRemote();
      engine.setConnection("remote-1", "failed");
      engine.emitError("media_connection_failed");
      await shell.settle();
      expect(failures()).toEqual([{ surface: "banner", phase: "in_meeting", code: "media_connection_failed" }]);
    });

    it("writes nothing for an interruption shorter than the threshold", async () => {
      const { shell, engine, entries } = await joinedWithRemote();
      vi.useFakeTimers();
      const before = entries.length;
      engine.setConnection("remote-1", "interrupted");
      await advance(shell, SHOW_AFTER_MS / 2);
      engine.setConnection("remote-1", "connected");
      await advance(shell, SHOW_AFTER_MS * 3);
      expect(entries.slice(before)).toEqual([]);
    });
  });

  describe("notice", () => {
    it("reports a notice with its code, and unsafe codes as unknown", async () => {
      const { shell, engine, failures } = await joinedWithRemote();
      engine.emitError("not_permitted");
      await shell.settle();
      engine.emitError("Bad Code: with spaces", "sentinel-message");
      await shell.settle();
      expect(failures()).toEqual([
        { surface: "notice", phase: "in_meeting", code: "not_permitted" },
        { surface: "notice", phase: "in_meeting", code: "unknown" },
      ]);
    });

    it("writes a repeat only after the burst window", async () => {
      const { shell, engine, failures } = await joinedWithRemote();
      vi.useFakeTimers();
      engine.emitError("rate_limited");
      await shell.settle();
      await advance(shell, NOTICE_BURST_MS - 1);
      engine.emitError("rate_limited");
      await shell.settle();
      expect(failures()).toHaveLength(1);
      await advance(shell, NOTICE_BURST_MS + 1);
      engine.emitError("rate_limited");
      await shell.settle();
      expect(failures()).toHaveLength(2);
    });

    it("never writes a notice replaced while hidden under the banner", async () => {
      const { shell, engine, failures } = await joinedWithRemote();
      vi.useFakeTimers();
      engine.setConnection("remote-1", "interrupted");
      await advance(shell, SHOW_AFTER_MS);
      engine.emitError("rate_limited");
      engine.emitError("not_permitted");
      engine.setConnection("remote-1", "connected");
      await advance(shell, STABLE_MS);
      expect(failures().filter((fields) => fields?.["surface"] === "notice")).toEqual([
        { surface: "notice", phase: "in_meeting", code: "not_permitted" },
      ]);
    });
  });

  describe("final", () => {
    it.each([
      ["meeting_ended", "meeting_ended"],
      ["session_replaced", "session_replaced"],
      ["connection_lost", "connection_lost"],
      ["error", "protocol_error"],
    ] as const)("reports the %s final screen", async (reason, code) => {
      const { shell, engine, failures } = await joinedWithRemote();
      engine.close(reason, code);
      await shell.settle();
      expect(failures()).toEqual([{ surface: "final", phase: "final", code, reason }]);
    });

    it("reports a close without an error code with only its reason", async () => {
      const { shell, engine, failures } = await joinedWithRemote();
      engine.close("meeting_ended");
      await shell.settle();
      expect(failures()).toEqual([{ surface: "final", phase: "final", reason: "meeting_ended" }]);
    });

    it("writes nothing when the participant leaves", async () => {
      const { shell, entries } = await joinedWithRemote();
      const before = entries.length;
      await shell.element.leave();
      await shell.settle();
      expect(entries.slice(before)).toEqual([]);
    });
  });

  describe("suppression", () => {
    it("writes nothing once leaving has started", async () => {
      const { shell, engine, entries } = await joinedWithRemote();
      vi.useFakeTimers();
      engine.setConnection("remote-1", "interrupted");
      const before = entries.length;
      const leaving = shell.element.leave();
      engine.emitError("not_permitted");
      engine.setConnection("remote-1", "failed");
      await advance(shell, SHOW_AFTER_MS * 3);
      await leaving;
      expect(entries.slice(before)).toEqual([]);
    });

    it("writes nothing once the element has been removed", async () => {
      const { shell, engine, entries } = await joinedWithRemote();
      vi.useFakeTimers();
      engine.setConnection("remote-1", "interrupted");
      const before = entries.length;
      shell.element.remove();
      await settle();
      await advance(shell, SHOW_AFTER_MS * 3);
      expect(entries.slice(before)).toEqual([]);
    });

    it("writes nothing for a replaced session", async () => {
      let answer!: (state: PermissionState) => void;
      stubPermissions({ camera: new Promise<PermissionState>((resolve) => (answer = resolve)) });
      const { shell, engine, entries } = await joinedWithRemote();
      engine.setLocalMedia("camera", false);
      await shell.settle();
      engine.close("session_replaced");
      await shell.settle();
      const before = entries.length;
      answer("denied");
      await shell.settle();
      expect(entries.slice(before)).toEqual([]);
    });
  });

  it("runs the same flows without a logger, with the same screen and no console output", async () => {
    const spies = spyOnConsole();
    const devices = new FakeMediaDevices();
    devices.failures.camera = "NotAllowedError";
    const shell = await createShell({ devices });
    expect(screen.getByText(/Camera permission was denied\./u)).toBeInTheDocument();
    await joinMeeting(shell);
    const engine: FakeEngine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace Hopper"));
    engine.setConnection("remote-1", "failed");
    await shell.settle();
    expect(document.querySelector('.svk-meeting-message[data-tone="danger"]')).not.toBeNull();
    engine.setConnection("remote-1", "connected");
    engine.emitError("not_permitted");
    await shell.settle();
    engine.close("connection_lost", "connection_lost");
    await shell.settle();
    expect(screen.getByRole("heading", { name: "Connection lost" })).toBeInTheDocument();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
