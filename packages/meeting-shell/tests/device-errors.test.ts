import { screen, within } from "@testing-library/dom";
import type { MeetingErrorCode } from "@strevokit/meeting-sdk";
import { describe, expect, it } from "vitest";
import { changePermission, stubPermissions } from "./support/fakeBrowser.js";
import { FakeMediaDevices } from "./support/fakeMediaDevices.js";
import { createShell, joinMeeting, liveRegion, type Shell } from "./support/fixture.js";

const DENIED = {
  camera: "Camera permission was denied. Allow camera access from the icon next to the address bar and in your system settings, then try again.",
  microphone:
    "Microphone permission was denied. Allow microphone access from the icon next to the address bar and in your system settings, then try again.",
} as const;
const DISCONNECTED = {
  camera: "Your camera was disconnected. Reconnect it, then try again.",
  microphone: "Your microphone was disconnected. Reconnect it, then try again.",
} as const;
const NOT_FOUND = "No camera was found. Connect a camera, then try again.";
const IN_USE = "Your camera is being used by another app. Close it, then try again.";
const SENTINEL = "sentinel-browser-message-1234";

/** Waits past the delay the shell lets a permission or device change settle for, then for the shell to update. */
async function afterDeviceChange(shell: Shell): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  await shell.settle();
  await shell.settle();
}

const CASES = [
  ["NotAllowedError", "Camera permission was denied. Allow camera access from the icon next to the address bar and in your system settings, then try again.", "Microphone permission was denied. Allow microphone access from the icon next to the address bar and in your system settings, then try again."],
  ["NotFoundError", "No camera was found. Connect a camera, then try again.", "No microphone was found. Connect a microphone, then try again."],
  ["OverconstrainedError", "No camera was found. Connect a camera, then try again.", "No microphone was found. Connect a microphone, then try again."],
  ["NotReadableError", "Your camera is being used by another app. Close it, then try again.", "Your microphone is being used by another app. Close it, then try again."],
] as const;

function setupRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Meeting setup" });
}

describe("device errors on the pre-join screen", () => {
  describe.each(["camera", "microphone"] as const)("%s", (kind) => {
    const label = kind === "camera" ? "Camera" : "Microphone";

    it.each(CASES)("explains %s next to the toggle", async (name, cameraCopy, microphoneCopy) => {
      const devices = new FakeMediaDevices();
      devices.failures[kind] = name;
      await createShell({ devices });
      const copy = kind === "camera" ? cameraCopy : microphoneCopy;
      const message = within(setupRegion()).getByText(copy);
      const toggle = within(setupRegion()).getByRole("button", { name: label });
      expect(toggle).toHaveAttribute("aria-describedby", message.id);
      expect(toggle).toHaveAccessibleDescription(copy);
      expect(toggle).toBeEnabled();
    });

    it("keeps the blocked toggle operable but off, and retries on request", async () => {
      const devices = new FakeMediaDevices();
      devices.failures[kind] = "NotAllowedError";
      const shell = await createShell({ devices });
      const toggle = within(setupRegion()).getByRole("button", { name: label });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      await shell.user.click(toggle);
      await shell.settle();
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(toggle).toHaveAttribute("aria-describedby");

      const requestsBefore = devices.requests(kind).length;
      delete devices.failures[kind];
      await shell.user.click(within(setupRegion()).getByRole("button", { name: `Try ${kind} again` }));
      await shell.settle();
      expect(devices.requests(kind).length).toBe(requestsBefore + 1);
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(toggle).not.toHaveAttribute("aria-describedby");
    });
  });

  it.each(["NotAllowedError", "SecurityError"])("%s gives the permission copy for both kinds, in order", async (name) => {
    const devices = new FakeMediaDevices();
    devices.failures.camera = name;
    devices.failures.microphone = name;
    const shell = await createShell({ devices });
    const setup = setupRegion();
    const texts = [...setup.querySelectorAll(".svk-device-message-text")].map((node) => node.textContent);
    expect(texts).toEqual([DENIED.camera, DENIED.microphone]);
    expect(within(setup).getByRole("button", { name: "Try camera again" })).toBeInTheDocument();
    expect(within(setup).getByRole("button", { name: "Try microphone again" })).toBeInTheDocument();
    expect(within(setup).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
    expect(within(setup).getByRole("button", { name: "Microphone" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Join meeting" })).not.toHaveAttribute("aria-disabled", "true");

    await joinMeeting(shell);
    expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
    expect(shell.engines.last.callsTo("enableCamera")).toHaveLength(0);
    expect(shell.engines.last.callsTo("unmute")).toHaveLength(0);
    expect(shell.engines.last.localMediaState).toMatchObject({ camera: false, microphone: false });
  });

  it("keeps the message and the toggle steady while a retry is in flight", async () => {
    const devices = new FakeMediaDevices();
    devices.failures.camera = "NotAllowedError";
    const shell = await createShell({ devices });
    const setup = setupRegion();
    const toggle = within(setup).getByRole("button", { name: "Camera" });
    const message = within(setup).getByText(DENIED.camera);

    let answer!: () => void;
    devices.pending = new Promise<void>((resolve) => (answer = resolve));
    await shell.user.click(within(setup).getByRole("button", { name: "Try camera again" }));
    await shell.settle();
    expect(within(setup).getByText(DENIED.camera)).toBe(message);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-busy", "true");
    expect(toggle).toHaveAttribute("aria-describedby", message.id);

    devices.pending = null;
    answer();
    await shell.settle();
    expect(within(setup).getByText(DENIED.camera)).toBe(message);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAttribute("aria-busy", "false");
  });

  it("starts the preview in place once a retry is allowed", async () => {
    const devices = new FakeMediaDevices();
    devices.failures.camera = "NotAllowedError";
    const shell = await createShell({ devices });
    const setup = setupRegion();
    expect(within(setup).getByText(DENIED.camera)).toBeInTheDocument();
    delete devices.failures.camera;
    await shell.user.click(within(setup).getByRole("button", { name: "Try camera again" }));
    await shell.settle();
    expect(setupRegion()).toBe(setup);
    expect(within(setup).queryByText(DENIED.camera)).toBeNull();
    expect(setup.querySelector("video")).not.toBeNull();
  });

  it("never shows the browser's own error name or message", async () => {
    const devices = new FakeMediaDevices();
    devices.failures.camera = "NotAllowedError";
    devices.failures.microphone = "NotReadableError";
    devices.failureMessage = SENTINEL;
    const shell = await createShell({ devices });
    expect(shell.element.textContent).not.toContain(SENTINEL);
    expect(shell.element.textContent).not.toContain("NotAllowedError");
    expect(shell.element.textContent).not.toContain("NotReadableError");
    expect(within(setupRegion()).getByText(DENIED.camera)).toBeInTheDocument();
  });

  it("still joins with the camera blocked, turning on only the microphone", async () => {
    const devices = new FakeMediaDevices();
    devices.failures.camera = "NotAllowedError";
    const shell = await createShell({ devices });
    expect(screen.getByRole("button", { name: "Join meeting" })).not.toHaveAttribute("aria-disabled", "true");
    await joinMeeting(shell);
    expect(shell.engines.last.callsTo("enableCamera")).toHaveLength(0);
    expect(shell.engines.last.callsTo("unmute")).toHaveLength(1);
  });

  it("shows the unsupported message without a broken preview when the browser has no media devices", async () => {
    await createShell({ devices: null });
    expect(
      within(setupRegion()).getByText(
        "This browser can't use a camera here. Try a current version of Chrome, Edge, Firefox, or Safari.",
      ),
    ).toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
    expect(screen.queryByRole("button", { name: "Try camera again" })).toBeNull();
    expect(within(setupRegion()).getByText("Camera is off")).toBeInTheDocument();
  });
});

describe("device errors in the meeting", () => {
  it.each<[MeetingErrorCode, string]>([
    ["permission_denied", "Camera permission was denied. Allow camera access from the icon next to the address bar and in your system settings, then try again."],
    ["device_not_found", "No camera was found. Connect a camera, then try again."],
    ["device_unavailable", "Your camera is being used by another app. Close it, then try again."],
  ])("shows the %s copy without leaving", async (code, copy) => {
    const shell = await createShell();
    await shell.user.click(screen.getByRole("button", { name: "Camera" }));
    await shell.settle();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.mediaOutcomes.enableCamera = code;
    const room = screen.getByRole("region", { name: "Meeting" });
    const camera = within(room).getByRole("button", { name: "Camera" });
    await shell.user.click(camera);
    await shell.settle();
    expect(within(room).getByText(copy)).toBeInTheDocument();
    expect(camera).toHaveAccessibleDescription(copy);
    expect(camera).toHaveAttribute("aria-pressed", "false");
    expect(engine.state).toBe("joined");
    expect(shell.closed).toEqual([]);

    delete engine.mediaOutcomes.enableCamera;
    await shell.user.click(within(room).getByRole("button", { name: "Try camera again" }));
    await shell.settle();
    expect(camera).toHaveAttribute("aria-pressed", "true");
    expect(within(room).queryByText(copy)).toBeNull();
  });
});

describe("a device that stops during the meeting", () => {
  const label = { camera: "Camera", microphone: "Microphone" } as const;

  async function joinWithBothOn(): Promise<Shell> {
    const shell = await createShell();
    await joinMeeting(shell);
    await shell.settle();
    expect(shell.engines.last.localMediaState).toMatchObject({ camera: true, microphone: true });
    return shell;
  }

  function toolbar(): HTMLElement {
    return screen.getByRole("toolbar", { name: "Meeting controls" });
  }

  describe.each(["camera", "microphone"] as const)("%s", (kind) => {
    it("explains a revoked permission when the browser reports it denied", async () => {
      stubPermissions({ [kind]: "denied" });
      const shell = await joinWithBothOn();
      const focused = document.activeElement;
      shell.engines.last.setLocalMedia(kind, false);
      await shell.settle();
      await shell.settle();
      const toggle = within(toolbar()).getByRole("button", { name: label[kind] });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      expect(toggle).toHaveAccessibleDescription(DENIED[kind]);
      expect(liveRegion()).toHaveTextContent(DENIED[kind]);
      expect(document.activeElement).toBe(focused);
      expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
      expect(shell.closed).toEqual([]);
    });

    it.each<[string, Parameters<typeof stubPermissions>[0]]>([
      ["granted", { [kind]: "granted" }],
      ["prompt", { [kind]: "prompt" }],
      ["a rejected query", { [kind]: "reject" }],
      ["no Permissions API", null],
    ])("says the device was disconnected when the browser reports %s", async (_case, states) => {
      stubPermissions(states);
      const shell = await joinWithBothOn();
      shell.engines.last.setLocalMedia(kind, false);
      await shell.settle();
      await shell.settle();
      const toggle = within(toolbar()).getByRole("button", { name: label[kind] });
      expect(toggle).toHaveAccessibleDescription(DISCONNECTED[kind]);
      expect(liveRegion()).toHaveTextContent(DISCONNECTED[kind]);
    });
  });

  it("drops an answer that arrives after leaving started", async () => {
    let answer!: (state: PermissionState) => void;
    stubPermissions({ camera: new Promise<PermissionState>((resolve) => (answer = resolve)) });
    const shell = await joinWithBothOn();
    shell.engines.last.setLocalMedia("camera", false);
    await shell.settle();
    const leaving = shell.element.leave();
    answer("denied");
    await leaving;
    await shell.settle();
    expect(shell.element.textContent).not.toContain(DENIED.camera);
    expect(liveRegion()).not.toHaveTextContent(DENIED.camera);
  });

  it("drops an answer that arrives after the session was replaced", async () => {
    let answer!: (state: PermissionState) => void;
    stubPermissions({ camera: new Promise<PermissionState>((resolve) => (answer = resolve)) });
    const shell = await joinWithBothOn();
    shell.engines.last.setLocalMedia("camera", false);
    await shell.settle();
    shell.engines.last.close("session_replaced");
    await shell.settle();
    answer("denied");
    await shell.settle();
    expect(screen.getByRole("heading", { name: "You joined from another tab" })).toBeInTheDocument();
    expect(shell.element.textContent).not.toContain(DENIED.camera);
    expect(liveRegion()).not.toHaveTextContent(DENIED.camera);
  });

  it("tries the camera again after a revoked permission, clearing the message on success", async () => {
    stubPermissions({ camera: "denied" });
    const shell = await joinWithBothOn();
    const engine = shell.engines.last;
    engine.setLocalMedia("camera", false);
    await shell.settle();
    await shell.settle();
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAccessibleDescription(DENIED.camera);
    const before = engine.callsTo("enableCamera").length;
    await shell.user.click(screen.getByRole("button", { name: "Try camera again" }));
    await shell.settle();
    expect(engine.callsTo("enableCamera")).toHaveLength(before + 1);
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "true");
    expect(shell.element.textContent).not.toContain(DENIED.camera);
  });
});

describe("dismissing a device message", () => {
  it("hides the message before joining, moves focus to the toggle, and the toggle brings it back", async () => {
    const devices = new FakeMediaDevices();
    devices.devices.camera = [];
    const shell = await createShell({ devices });
    const setup = setupRegion();
    const toggle = within(setup).getByRole("button", { name: "Camera" });
    expect(within(setup).getByText(NOT_FOUND)).toBeInTheDocument();

    await shell.user.click(within(setup).getByRole("button", { name: "Dismiss camera message" }));
    await shell.settle();
    await shell.settle();
    expect(within(setup).queryByText(NOT_FOUND)).toBeNull();
    expect(toggle).not.toHaveAttribute("aria-describedby");
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(document.activeElement).toBe(toggle);

    const requestsBefore = devices.requests("camera").length;
    await shell.user.click(toggle);
    await shell.settle();
    expect(devices.requests("camera").length).toBe(requestsBefore + 1);
    expect(within(setup).getByText(NOT_FOUND)).toBeInTheDocument();
    expect(toggle).toHaveAccessibleDescription(NOT_FOUND);
  });

  it("keeps the other device's message", async () => {
    const devices = new FakeMediaDevices();
    devices.failures.camera = "NotAllowedError";
    devices.failures.microphone = "NotAllowedError";
    const shell = await createShell({ devices });
    await shell.user.click(within(setupRegion()).getByRole("button", { name: "Dismiss camera message" }));
    await shell.settle();
    expect(within(setupRegion()).queryByText(DENIED.camera)).toBeNull();
    expect(within(setupRegion()).getByText(DENIED.microphone)).toBeInTheDocument();
  });

  it("shows the message again when the problem changes", async () => {
    stubPermissions({ camera: "denied" });
    const devices = new FakeMediaDevices();
    devices.failures.camera = "NotAllowedError";
    const shell = await createShell({ devices });
    await shell.user.click(within(setupRegion()).getByRole("button", { name: "Dismiss camera message" }));
    await shell.settle();
    expect(within(setupRegion()).queryByText(DENIED.camera)).toBeNull();

    devices.failures.camera = "NotReadableError";
    changePermission("camera", "granted");
    await afterDeviceChange(shell);
    expect(within(setupRegion()).getByText(IN_USE)).toBeInTheDocument();
  });

  it("hides the message in the meeting, and the blocked toggle tries again", async () => {
    stubPermissions({ camera: "denied" });
    const shell = await createShell();
    await joinMeeting(shell);
    await shell.settle();
    const engine = shell.engines.last;
    engine.setLocalMedia("camera", false);
    await shell.settle();
    await shell.settle();
    const room = screen.getByRole("region", { name: "Meeting" });
    const camera = within(room).getByRole("button", { name: "Camera" });
    expect(camera).toHaveAccessibleDescription(DENIED.camera);

    await shell.user.click(within(room).getByRole("button", { name: "Dismiss camera message" }));
    await shell.settle();
    await shell.settle();
    expect(within(room).queryByText(DENIED.camera)).toBeNull();
    expect(camera).not.toHaveAttribute("aria-describedby");
    expect(document.activeElement).toBe(camera);

    engine.mediaOutcomes.enableCamera = "permission_denied";
    const before = engine.callsTo("enableCamera").length;
    await shell.user.click(camera);
    await shell.settle();
    expect(engine.callsTo("enableCamera")).toHaveLength(before + 1);
    expect(within(room).getByText(DENIED.camera)).toBeInTheDocument();
  });
});

describe("recovering after a permission or device change", () => {
  it("starts the preview again once the permission is allowed", async () => {
    stubPermissions({ camera: "denied" });
    const devices = new FakeMediaDevices();
    devices.failures.camera = "NotAllowedError";
    const shell = await createShell({ devices });
    const setup = setupRegion();
    expect(within(setup).getByText(DENIED.camera)).toBeInTheDocument();

    delete devices.failures.camera;
    changePermission("camera", "granted");
    await afterDeviceChange(shell);
    expect(within(setup).queryByText(DENIED.camera)).toBeNull();
    expect(within(setup).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "true");
    expect(setup.querySelector("video")).not.toBeNull();
  });

  it("does not try again while the permission stays denied", async () => {
    stubPermissions({ camera: "denied" });
    const devices = new FakeMediaDevices();
    devices.failures.camera = "NotAllowedError";
    const shell = await createShell({ devices });
    const before = devices.requests("camera").length;
    devices.dispatchEvent(new Event("devicechange"));
    await afterDeviceChange(shell);
    expect(devices.requests("camera").length).toBe(before);
    expect(within(setupRegion()).getByText(DENIED.camera)).toBeInTheDocument();
  });

  it("starts the preview once a camera is connected", async () => {
    const devices = new FakeMediaDevices();
    devices.devices.camera = [];
    const shell = await createShell({ devices });
    expect(within(setupRegion()).getByText(NOT_FOUND)).toBeInTheDocument();

    devices.addDevice("camera", { deviceId: "camera-new", label: "New camera" });
    await afterDeviceChange(shell);
    expect(within(setupRegion()).queryByText(NOT_FOUND)).toBeNull();
    expect(setupRegion().querySelector("video")).not.toBeNull();
  });

  it("keeps a dismissed message hidden when trying again on its own fails the same way", async () => {
    const devices = new FakeMediaDevices();
    devices.devices.camera = [];
    const shell = await createShell({ devices });
    await shell.user.click(within(setupRegion()).getByRole("button", { name: "Dismiss camera message" }));
    await shell.settle();
    const before = devices.requests("camera").length;

    devices.addDevice("microphone", { deviceId: "mic-new", label: "New microphone" });
    await afterDeviceChange(shell);
    expect(devices.requests("camera").length).toBe(before + 1);
    expect(within(setupRegion()).queryByText(NOT_FOUND)).toBeNull();
  });

  it("clears a denied permission in the meeting without turning the camera on", async () => {
    stubPermissions({ camera: "denied" });
    const shell = await createShell();
    await joinMeeting(shell);
    await shell.settle();
    const engine = shell.engines.last;
    engine.setLocalMedia("camera", false);
    await shell.settle();
    await shell.settle();
    const room = screen.getByRole("region", { name: "Meeting" });
    expect(within(room).getByText(DENIED.camera)).toBeInTheDocument();
    const before = engine.callsTo("enableCamera").length;

    changePermission("camera", "granted");
    await afterDeviceChange(shell);
    const camera = within(room).getByRole("button", { name: "Camera" });
    expect(within(room).queryByText(DENIED.camera)).toBeNull();
    expect(camera).not.toHaveAttribute("aria-describedby");
    expect(camera).toHaveAttribute("aria-pressed", "false");
    expect(engine.callsTo("enableCamera")).toHaveLength(before);
  });

  it("clears a missing camera in the meeting once one is connected, without turning it on", async () => {
    const shell = await createShell();
    await shell.user.click(screen.getByRole("button", { name: "Camera" }));
    await shell.settle();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.mediaOutcomes.enableCamera = "device_not_found";
    const room = screen.getByRole("region", { name: "Meeting" });
    await shell.user.click(within(room).getByRole("button", { name: "Camera" }));
    await shell.settle();
    expect(within(room).getByText(NOT_FOUND)).toBeInTheDocument();
    const before = engine.callsTo("enableCamera").length;

    shell.devices?.addDevice("camera", { deviceId: "camera-new", label: "New camera" });
    await afterDeviceChange(shell);
    expect(within(room).queryByText(NOT_FOUND)).toBeNull();
    expect(within(room).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
    expect(engine.callsTo("enableCamera")).toHaveLength(before);
  });
});
