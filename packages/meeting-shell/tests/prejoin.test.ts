import { screen, within } from "@testing-library/dom";
import { afterEach, describe, expect, it } from "vitest";
import { FakeMediaDevices } from "./support/fakeMediaDevices.js";
import { createShell } from "./support/fixture.js";

function setupRegion(): HTMLElement {
  return screen.getByRole("region", { name: "Meeting setup" });
}

/** A Web Audio stand-in whose analyser always reports a loud signal. */
class LoudAudioContext {
  static instances: LoudAudioContext[] = [];
  closed = false;

  constructor() {
    LoudAudioContext.instances.push(this);
  }

  createMediaStreamSource() {
    return { connect: () => {}, disconnect: () => {} };
  }

  createAnalyser() {
    return { fftSize: 0, getByteTimeDomainData: (samples: Uint8Array) => samples.fill(220) };
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function waitForMeter(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

describe("pre-join screen", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "AudioContext");
    LoudAudioContext.instances = [];
  });

  it("shows a preview from the default devices", async () => {
    const { devices, element } = await createShell();
    expect(within(setupRegion()).getByRole("heading", { level: 2, name: "Ready to join?" })).toBeInTheDocument();
    expect(devices?.requests("camera")).toEqual([{ video: true }]);
    expect(devices?.requests("microphone")).toEqual([{ audio: true }]);
    const video = element.querySelector("video");
    expect(video).not.toBeNull();
    expect(video).toHaveClass("svk-mirrored");
    expect(video?.muted).toBe(true);
    expect(video?.srcObject).not.toBeNull();
  });

  it("shows the microphone indicator while the preview microphone picks up sound", async () => {
    Object.defineProperty(window, "AudioContext", { configurable: true, writable: true, value: LoudAudioContext });
    const shell = await createShell();
    await waitForMeter();
    await shell.settle();
    const region = setupRegion();
    expect(within(region).getByText("Microphone is picking up sound")).toBeInTheDocument();
    expect(region.querySelector(".svk-meter")).toHaveAttribute("aria-hidden", "true");

    await shell.user.click(screen.getByRole("button", { name: "Microphone" }));
    await shell.settle();
    expect(within(region).queryByText("Microphone is picking up sound")).toBeNull();
    expect(region.querySelector(".svk-meter")).toBeNull();
    expect(LoudAudioContext.instances.every((context) => context.closed)).toBe(true);
  });

  it("shows no indicator text while the microphone is quiet or Web Audio is missing", async () => {
    const shell = await createShell();
    await waitForMeter();
    await shell.settle();
    expect(setupRegion().querySelector(".svk-meter")).not.toBeNull();
    expect(screen.queryByText("Microphone is picking up sound")).toBeNull();
  });

  it("starts with camera and microphone on, and the toggles control the preview", async () => {
    const { devices, user, element, settle } = await createShell();
    const camera = screen.getByRole("button", { name: "Camera" });
    const microphone = screen.getByRole("button", { name: "Microphone" });
    expect(camera).toHaveAttribute("aria-pressed", "true");
    expect(microphone).toHaveAttribute("aria-pressed", "true");

    await user.click(camera);
    await settle();
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
    expect(element.querySelector("video")).toBeNull();
    expect(screen.getByText("Camera is off")).toBeInTheDocument();
    expect(devices?.liveTracks().map((track) => track.kind)).toEqual(["audio"]);

    await user.click(microphone);
    await settle();
    expect(microphone).toHaveAttribute("aria-pressed", "false");
    expect(devices?.liveTracks()).toEqual([]);

    await user.click(camera);
    await settle();
    expect(camera).toHaveAttribute("aria-pressed", "true");
    expect(element.querySelector("video")).not.toBeNull();
  });

  it("joins with Join meeting, showing a busy button while joining", async () => {
    const { engines, user, settle } = await createShell({ engine: (engine) => (engine.joinOutcome = "pending") });
    await user.click(screen.getByRole("button", { name: "Join meeting" }));
    await settle();
    const busy = screen.getByRole("button", { name: "Joining…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(engines.last.callsTo("join")).toHaveLength(1);

    await user.click(busy);
    expect(engines.last.callsTo("join")).toHaveLength(1);

    engines.last.finishJoin();
    await settle();
    expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
  });

  it("keeps the preview running when a join fails, then joins with a new meeting engine", async () => {
    const { engines, devices, user, element, settle, closed } = await createShell({
      engine: (engine, index) => (engine.joinOutcome = index === 0 ? "connection_failed" : "resolve"),
    });
    const tracksBefore = devices?.liveTracks().length;
    await user.click(screen.getByRole("button", { name: "Join meeting" }));
    await settle();

    expect(setupRegion()).toBeInTheDocument();
    expect(devices?.liveTracks()).toHaveLength(tracksBefore ?? 0);
    expect(element.querySelector("video")).not.toBeNull();
    expect(engines.engines).toHaveLength(2);
    expect(engines.engines[0]?.disposed).toBe(true);
    expect(closed).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Join meeting" }));
    await settle();
    expect(engines.engines[1]?.callsTo("join")).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
  });

  it("requests no camera or microphone before the meeting engine exists", async () => {
    const devices = new FakeMediaDevices();
    let requestsAtCreation = -1;
    await createShell({ devices, engine: () => (requestsAtCreation = devices.calls.length) });
    expect(requestsAtCreation).toBe(0);
    expect(devices.calls.length).toBeGreaterThan(0);
  });
});
