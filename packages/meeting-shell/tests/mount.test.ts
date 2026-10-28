import { screen } from "@testing-library/dom";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { setEngineFactoryForTests } from "../src/engine/engineFactory.js";
import { StrevokitMeetingElement, mount } from "../src/index.js";
import type { MountOptions, ShellHandle } from "../src/index.js";
import { engineFactory } from "./support/fakeEngine.js";
import { installMediaDevices } from "./support/fakeMediaDevices.js";
import { REALTIME_URL, TOKEN, settle } from "./support/fixture.js";

function setup() {
  const engines = engineFactory();
  setEngineFactoryForTests(engines.factory);
  const devices = installMediaDevices();
  const target = document.createElement("div");
  target.id = "call";
  const existing = document.createElement("p");
  existing.textContent = "Your page content";
  target.append(existing);
  document.body.append(target);
  return { engines, devices, target, existing, user: userEvent.setup() };
}

async function joinWith(handle: ShellHandle, user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Join meeting" }));
  await settle(handle.element);
}

const OPTIONS: MountOptions = { token: TOKEN, realtimeUrl: REALTIME_URL };

describe("mount()", () => {
  describe("targets", () => {
    it("appends the element to the element a selector matches, keeping its other children", async () => {
      const { engines, target, existing } = setup();
      const handle = mount("#call", OPTIONS);
      await settle(handle.element);
      expect(handle.element).toBeInstanceOf(StrevokitMeetingElement);
      expect(handle.element.parentElement).toBe(target);
      expect(target.firstElementChild).toBe(existing);
      expect(engines.last.options).toMatchObject({ token: TOKEN, realtimeUrl: REALTIME_URL });
      expect(screen.getByRole("region", { name: "Meeting setup" })).toBeInTheDocument();
    });

    it("accepts an element target and applies the appearance and logger", async () => {
      const { engines, target } = setup();
      const logger = { info: vi.fn() };
      const handle = mount(target, { ...OPTIONS, appearance: "dark", logger });
      await settle(handle.element);
      expect(handle.element.parentElement).toBe(target);
      expect(handle.element.appearance).toBe("dark");
      expect(handle.element).toHaveAttribute("data-svk-appearance", "dark");
      expect(handle.element.logger).toBe(logger);
      engines.last.options.logger?.info?.("hello");
      expect(logger.info).toHaveBeenCalledWith("hello", undefined);
    });

    it("accepts hideEndMeeting in MountOptions, reflects it on the element property and attribute", async () => {
      const { target } = setup();
      const handle = mount(target, { ...OPTIONS, hideEndMeeting: true });
      await settle(handle.element);
      expect(handle.element.hideEndMeeting).toBe(true);
      expect(handle.element.hasAttribute("hide-end-meeting")).toBe(true);

      handle.element.hideEndMeeting = false;
      await settle(handle.element);
      expect(handle.element.hasAttribute("hide-end-meeting")).toBe(false);

      handle.element.setAttribute("hide-end-meeting", "");
      await settle(handle.element);
      expect(handle.element.hideEndMeeting).toBe(true);
    });

    it("never writes the token to an attribute", async () => {
      const { target } = setup();
      const handle = mount(target, OPTIONS);
      await settle(handle.element);
      expect(handle.element.token).toBe(TOKEN);
      expect(target.outerHTML).not.toContain(TOKEN);
    });
  });

  describe("errors", () => {
    it("throws a TypeError for a selector that matches nothing, creating nothing", () => {
      const { engines, devices } = setup();
      expect(() => mount("#missing", OPTIONS)).toThrow(
        new TypeError("StrevokitShell.mount: no element matches #missing"),
      );
      expect(document.querySelector("strevokit-meeting")).toBeNull();
      expect(engines.engines).toEqual([]);
      expect(devices.calls).toEqual([]);
    });

    it.each<[string, unknown]>([
      ["null", null],
      ["a number", 42],
      ["a text node", document.createTextNode("call")],
    ])("throws a TypeError for %s as the target", (_, target) => {
      setup();
      expect(() => mount(target as HTMLElement, OPTIONS)).toThrow(
        new TypeError("StrevokitShell.mount: target must be a selector or an element"),
      );
      expect(document.querySelector("strevokit-meeting")).toBeNull();
    });

    it.each<[string, unknown]>([
      ["empty", ""],
      ["missing", undefined],
      ["not a string", 42],
    ])("throws a TypeError when the token is %s, creating nothing", (_, token) => {
      const { engines } = setup();
      expect(() => mount("#call", { realtimeUrl: REALTIME_URL, token } as MountOptions)).toThrow(
        new TypeError("StrevokitShell.mount: token is required"),
      );
      expect(document.querySelector("strevokit-meeting")).toBeNull();
      expect(engines.engines).toEqual([]);
    });
  });

  describe("the handle", () => {
    it("reports joined and closed through on(), until unsubscribed", async () => {
      const { user } = setup();
      const handle = mount("#call", OPTIONS);
      await settle(handle.element);
      const joined = vi.fn();
      const closed = vi.fn();
      const stopJoined = handle.on("joined", joined);
      handle.on("closed", closed);
      stopJoined();
      const joinedAgain = vi.fn();
      handle.on("joined", joinedAgain);

      await joinWith(handle, user);
      expect(joined).not.toHaveBeenCalled();
      expect(joinedAgain).toHaveBeenCalledExactlyOnceWith({ role: "host" });

      await handle.leave();
      await settle(handle.element);
      expect(screen.getByRole("heading", { level: 2, name: "You left the meeting" })).toBeInTheDocument();
      expect(closed).toHaveBeenCalledExactlyOnceWith({ reason: "left" });
    });

    it("mirrors the events through onJoined and onClosed", async () => {
      const { user } = setup();
      const onJoined = vi.fn();
      const onClosed = vi.fn();
      const handle = mount("#call", { ...OPTIONS, onJoined, onClosed });
      const events: string[] = [];
      handle.element.addEventListener("svk-joined", () => events.push("svk-joined"));
      handle.element.addEventListener("svk-closed", () => events.push("svk-closed"));
      await settle(handle.element);
      await joinWith(handle, user);
      await user.click(screen.getByRole("button", { name: "Leave meeting" }));
      await settle(handle.element);
      expect(onJoined).toHaveBeenCalledExactlyOnceWith({ role: "host" });
      expect(onClosed).toHaveBeenCalledExactlyOnceWith({ reason: "left" });
      expect(events).toEqual(["svk-joined", "svk-closed"]);
    });

    it("leave() resolves at once when not joined", async () => {
      const { engines } = setup();
      const handle = mount("#call", OPTIONS);
      await settle(handle.element);
      await handle.leave();
      expect(engines.last.callsTo("leave")).toEqual([]);
      expect(screen.getByRole("region", { name: "Meeting setup" })).toBeInTheDocument();
    });

    it("destroy() removes the element, ends the meeting, and is idempotent", async () => {
      const { engines, devices, target, user } = setup();
      const onClosed = vi.fn();
      const handle = mount(target, { ...OPTIONS, onClosed });
      const closed = vi.fn();
      handle.on("closed", closed);
      await settle(handle.element);
      await joinWith(handle, user);
      const engine = engines.last;

      handle.destroy();
      handle.destroy();
      await settle(handle.element);
      expect(handle.element.isConnected).toBe(false);
      expect(target.querySelector("strevokit-meeting")).toBeNull();
      expect(engine.disposed).toBe(true);
      expect(engine.callsTo("dispose")).toHaveLength(1);
      expect(devices.liveTracks()).toEqual([]);

      engine.emit("closed", { reason: "meeting_ended" });
      handle.element.dispatchEvent(new CustomEvent("svk-closed", { detail: { reason: "left" } }));
      await settle(handle.element);
      expect(onClosed).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      await expect(handle.leave()).resolves.toBeUndefined();
    });
  });
});
