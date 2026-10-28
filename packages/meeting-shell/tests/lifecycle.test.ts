import { MeetingError } from "@strevokit/meeting-sdk";
import type { CloseReason } from "@strevokit/meeting-sdk";
import { screen } from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";
import { defineOnce } from "../src/define.js";
import { setEngineFactoryForTests } from "../src/engine/engineFactory.js";
import { StrevokitMeetingElement } from "../src/index.js";
import { engineFactory, participant } from "./support/fakeEngine.js";
import { FakeMediaDevices, installMediaDevices } from "./support/fakeMediaDevices.js";
import { REALTIME_URL, TOKEN, createShell, joinMeeting, settle } from "./support/fixture.js";

describe("lifecycle", () => {
  describe("idle until configured", () => {
    it("renders and requests nothing without a token", async () => {
      const shell = await createShell({ token: null });
      expect(shell.element.children).toHaveLength(0);
      expect(shell.engines.engines).toEqual([]);
      expect(shell.devices?.calls).toEqual([]);

      shell.element.token = TOKEN;
      await shell.settle();
      expect(shell.engines.engines).toHaveLength(1);
      expect(screen.getByRole("region", { name: "Meeting setup" })).toBeInTheDocument();
    });

    it("stays idle without a realtime URL, warning the logger once", async () => {
      const shell = await createShell({ realtimeUrl: null, token: null });
      const warn = vi.fn();
      shell.element.logger = { warn };
      shell.element.token = TOKEN;
      await shell.settle();
      shell.element.appearance = "dark";
      await shell.settle();
      expect(shell.element.children).toHaveLength(0);
      expect(shell.engines.engines).toEqual([]);
      expect(shell.devices?.calls).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warn.mock.calls)).not.toContain(TOKEN);

      shell.element.realtimeUrl = REALTIME_URL;
      await shell.settle();
      expect(shell.engines.last.options).toMatchObject({ token: TOKEN, realtimeUrl: REALTIME_URL });
    });

    it("does nothing until it is in the page", async () => {
      const engines = engineFactory();
      setEngineFactoryForTests(engines.factory);
      const devices = installMediaDevices();
      const element = document.createElement("strevokit-meeting");
      element.realtimeUrl = REALTIME_URL;
      element.token = TOKEN;
      await settle();
      expect(engines.engines).toEqual([]);
      expect(devices.calls).toEqual([]);

      document.body.append(element);
      await settle(element);
      expect(engines.engines).toHaveLength(1);
    });
  });

  it("creates one engine per configuration", async () => {
    const shell = await createShell();
    shell.element.token = TOKEN;
    shell.element.realtimeUrl = REALTIME_URL;
    shell.element.appearance = "light";
    await shell.settle();
    await joinMeeting(shell);
    shell.engines.last.addParticipant(participant("remote-1", "Grace"));
    await shell.settle();
    expect(shell.engines.engines).toHaveLength(1);
    expect(shell.engines.last.options).toMatchObject({ token: TOKEN, realtimeUrl: REALTIME_URL });
  });

  it("disposes the engine and stops the preview when removed before joining, with no events", async () => {
    const shell = await createShell();
    expect(shell.devices?.liveTracks()).toHaveLength(2);
    shell.element.remove();
    await shell.settle();
    expect(shell.devices?.liveTracks()).toEqual([]);
    expect(shell.engines.last.disposed).toBe(true);
    expect(shell.engines.last.listenerCount()).toBe(0);
    expect(shell.closed).toEqual([]);
  });

  it("disposes the engine when removed while joined, with no events afterwards", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    shell.element.remove();
    await shell.settle();
    expect(engine.disposed).toBe(true);
    expect(engine.callsTo("dispose")).toHaveLength(1);
    expect(shell.devices?.liveTracks()).toEqual([]);
    expect(shell.joined).toHaveLength(1);
    expect(shell.closed).toEqual([]);
  });

  it("keeps the meeting when the element moves within one task", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    const container = document.createElement("div");
    document.body.append(container);
    container.append(shell.element);
    await shell.settle();
    expect(engine.disposed).toBe(false);
    expect(shell.engines.engines).toHaveLength(1);
    expect(screen.getByRole("toolbar", { name: "Meeting controls" })).toBeInTheDocument();
    expect(shell.closed).toEqual([]);
  });

  it("starts a new meeting when added back after a removal", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    shell.element.remove();
    await shell.settle();
    document.body.append(shell.element);
    await shell.settle();
    expect(shell.engines.engines).toHaveLength(2);
    expect(shell.engines.engines[0]?.disposed).toBe(true);
    expect(screen.getByRole("region", { name: "Meeting setup" })).toBeInTheDocument();
    expect(shell.devices?.liveTracks()).toHaveLength(2);
  });

  it.each([
    ["token", (element: StrevokitMeetingElement) => (element.token = "next-token-test")],
    ["realtime URL", (element: StrevokitMeetingElement) => (element.realtimeUrl = "wss://other.example.test")],
  ])("starts a new meeting at pre-join when the %s changes", async (_, change) => {
    const shell = await createShell();
    await joinMeeting(shell);
    const first = shell.engines.last;
    change(shell.element);
    await shell.settle();
    expect(first.disposed).toBe(true);
    expect(shell.engines.engines).toHaveLength(2);
    expect(shell.engines.last).not.toBe(first);
    expect(screen.getByRole("region", { name: "Meeting setup" })).toBeInTheDocument();
    expect(shell.closed).toEqual([]);

    await joinMeeting(shell);
    expect(shell.joined).toHaveLength(2);
  });

  it("dispatches svk-joined once with the role, bubbling", async () => {
    const bubbled = vi.fn();
    document.addEventListener("svk-joined", bubbled);
    try {
      const shell = await createShell({ engine: (engine) => (engine.selfRole = "participant") });
      await joinMeeting(shell);
      expect(shell.joined).toEqual([{ role: "participant" }]);
      expect(bubbled).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("svk-joined", bubbled);
    }
  });

  it.each<CloseReason>(["meeting_ended", "session_replaced", "connection_lost", "error"])(
    "dispatches svk-closed exactly once when the meeting closes with %s",
    async (reason) => {
      const shell = await createShell();
      await joinMeeting(shell);
      shell.engines.last.close(reason);
      await shell.settle();
      shell.engines.last.emit("closed", { reason });
      await shell.settle();
      expect(shell.closed).toEqual([{ reason }]);
      expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 2 })).toHaveFocus();
    },
  );

  it("dispatches svk-closed once with left after Leave meeting", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await shell.user.click(screen.getByRole("button", { name: "Leave meeting" }));
    await shell.settle();
    expect(shell.closed).toEqual([{ reason: "left" }]);
    expect(screen.getByRole("heading", { level: 2, name: "You left the meeting" })).toHaveFocus();
  });

  it("leave() leaves when joined and resolves once the final screen shows", async () => {
    const shell = await createShell();
    await shell.element.leave();
    expect(shell.engines.last.callsTo("leave")).toEqual([]);
    expect(screen.getByRole("region", { name: "Meeting setup" })).toBeInTheDocument();

    await joinMeeting(shell);
    await shell.element.leave();
    expect(screen.getByRole("heading", { level: 2, name: "You left the meeting" })).toBeInTheDocument();
    expect(shell.engines.last.callsTo("leave")).toHaveLength(1);
    await shell.settle();
    expect(shell.closed).toEqual([{ reason: "left" }]);
  });

  it("goes to join_failed without requesting media when the engine can't be created", async () => {
    const devices = new FakeMediaDevices();
    const shell = await createShell({
      devices,
      engine: () => {
        throw new MeetingError("unsupported_environment");
      },
    });
    expect(shell.closed).toEqual([{ reason: "join_failed" }]);
    expect(devices.calls).toEqual([]);
    expect(screen.getByRole("heading", { level: 2, name: "Unable to join this meeting" })).toBeInTheDocument();
    expect(
      screen.getByText("This browser isn't supported. Try a current version of Chrome, Edge, Firefox, or Safari."),
    ).toBeInTheDocument();
  });

  it("keeps properties set before the element is defined", async () => {
    const engines = engineFactory();
    setEngineFactoryForTests(engines.factory);
    installMediaDevices();
    const tag = "svk-test-early-meeting";
    const early = document.createElement(tag);
    Object.assign(early, { token: TOKEN, realtimeUrl: REALTIME_URL, appearance: "dark" });
    document.body.append(early);
    customElements.define(tag, class extends StrevokitMeetingElement {});
    await settle(early);

    expect(early).toBeInstanceOf(StrevokitMeetingElement);
    expect(early).toHaveAttribute("data-svk-appearance", "dark");
    expect(engines.last.options).toMatchObject({ token: TOKEN, realtimeUrl: REALTIME_URL });
    expect(screen.getByRole("region", { name: "Meeting setup" })).toBeInTheDocument();
    expect(early.outerHTML).not.toContain(TOKEN);
  });

  it("ignores a token attribute in markup", async () => {
    const engines = engineFactory();
    setEngineFactoryForTests(engines.factory);
    const devices = installMediaDevices();
    document.body.innerHTML = `<strevokit-meeting token="${TOKEN}" realtime-url="${REALTIME_URL}"></strevokit-meeting>`;
    const element = document.querySelector("strevokit-meeting");
    if (!element) throw new Error("element missing");
    await settle(element);
    expect(element.token).toBeNull();
    expect(element.realtimeUrl).toBe(REALTIME_URL);
    expect(engines.engines).toEqual([]);
    expect(devices.calls).toEqual([]);
    expect(element.children).toHaveLength(0);
  });

  it("doesn't throw or replace the element when it is defined twice", () => {
    expect(() => defineOnce("strevokit-meeting", StrevokitMeetingElement)).not.toThrow();
    expect(() => defineOnce("strevokit-meeting", class extends StrevokitMeetingElement {})).not.toThrow();
    expect(customElements.get("strevokit-meeting")).toBe(StrevokitMeetingElement);
  });
});
