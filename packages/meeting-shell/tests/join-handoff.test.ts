import { screen } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { createShell, joinMeeting } from "./support/fixture.js";

describe("join handoff", () => {
  it("stops the preview exactly once before the meeting captures the camera and microphone", async () => {
    let liveAtEnable = -1;
    let liveAtUnmute = -1;
    const shell = await createShell();
    const engine = shell.engines.last;
    const previewTracks = shell.devices?.liveTracks() ?? [];
    expect(previewTracks).toHaveLength(2);
    const enableCamera = engine.enableCamera.bind(engine);
    engine.enableCamera = (options) => {
      liveAtEnable = shell.devices?.liveTracks().length ?? -1;
      return enableCamera(options);
    };
    const unmute = engine.unmute.bind(engine);
    engine.unmute = (options) => {
      liveAtUnmute = shell.devices?.liveTracks().length ?? -1;
      return unmute(options);
    };
    await joinMeeting(shell);

    expect(liveAtEnable).toBe(0);
    expect(liveAtUnmute).toBe(0);
    expect(previewTracks.map((track) => track.stopCount)).toEqual([1, 1]);
    const order = engine.calls.map((call) => call.method);
    expect(order.indexOf("join")).toBeLessThan(order.indexOf("enableCamera"));
    expect(order.indexOf("join")).toBeLessThan(order.indexOf("unmute"));
    expect(engine.callsTo("enableCamera")).toHaveLength(1);
    expect(engine.callsTo("unmute")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Microphone" })).toHaveAttribute("aria-pressed", "true");
  });

  it("turns on only the devices left on", async () => {
    const shell = await createShell();
    await shell.user.click(screen.getByRole("button", { name: "Camera" }));
    await shell.settle();
    await joinMeeting(shell);

    expect(shell.engines.last.callsTo("enableCamera")).toHaveLength(0);
    expect(shell.engines.last.callsTo("unmute")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
  });

  it("turns nothing on when both are off", async () => {
    const shell = await createShell();
    await shell.user.click(screen.getByRole("button", { name: "Camera" }));
    await shell.user.click(screen.getByRole("button", { name: "Microphone" }));
    await shell.settle();
    await joinMeeting(shell);
    expect(shell.engines.last.callsTo("enableCamera")).toHaveLength(0);
    expect(shell.engines.last.callsTo("unmute")).toHaveLength(0);
  });

  it("stays in the meeting with the camera off when a capture fails after joining", async () => {
    const shell = await createShell({ engine: (engine) => (engine.mediaOutcomes.enableCamera = "device_unavailable") });
    await joinMeeting(shell);

    expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: "Microphone" })).toHaveAttribute("aria-pressed", "true");
    expect(shell.closed).toEqual([]);
    expect(shell.engines.last.state).toBe("joined");
  });
});
