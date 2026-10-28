import { screen, within } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { createShell, joinMeeting } from "./support/fixture.js";

function toolbar(): HTMLElement {
  return screen.getByRole("toolbar", { name: "Meeting controls" });
}

describe("control bar", () => {
  it("has the microphone and camera toggles with their device menus, Share screen, Participants, Leave meeting, and End meeting for a host", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const buttons = within(toolbar()).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label") ?? button.getAttribute("title"))).toEqual([
      "Microphone",
      "Choose microphone",
      "Camera",
      "Choose camera",
      "Share screen",
      "Participants (1)",
      "Leave meeting",
      "End meeting",
    ]);
    const participants = within(toolbar()).getByRole("button", { name: "Participants (1)" });
    expect(within(participants).getByText("Participants (1)")).toBeInTheDocument();
    expect(within(participants).getByText("1")).toHaveAttribute("aria-hidden", "true");
    const microphone = within(toolbar()).getByRole("button", { name: "Microphone" });
    expect(within(microphone).getByText("Microphone")).toBeInTheDocument();
    expect(within(microphone).getByText("On")).toBeInTheDocument();
    expect(microphone.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    const endMeeting = within(toolbar()).getByRole("button", { name: "End meeting" });
    expect(within(endMeeting).getByText("End meeting")).toBeInTheDocument();
  });

  it("does not render End meeting or Share screen for a participant", async () => {
    const shell = await createShell({
      engine: (engine) => {
        engine.selfRole = "participant";
      },
    });
    await joinMeeting(shell);
    const buttons = within(toolbar()).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label") ?? button.getAttribute("title"))).toEqual([
      "Microphone",
      "Choose microphone",
      "Camera",
      "Choose camera",
      "Participants (1)",
      "Leave meeting",
    ]);
  });

  it("does not render End meeting when hideEndMeeting is true", async () => {
    const shell = await createShell();
    shell.element.hideEndMeeting = true;
    await joinMeeting(shell);
    const buttons = within(toolbar()).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label") ?? button.getAttribute("title"))).toEqual([
      "Microphone",
      "Choose microphone",
      "Camera",
      "Choose camera",
      "Share screen",
      "Participants (1)",
      "Leave meeting",
    ]);
  });

  it("shows the engine's state only, never flipping before the engine confirms", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.mediaOutcomes.mute = "pending";
    const microphone = within(toolbar()).getByRole("button", { name: "Microphone" });
    expect(microphone).toHaveAttribute("aria-pressed", "true");

    await shell.user.click(microphone);
    await shell.settle();
    expect(microphone).toHaveAttribute("aria-pressed", "true");
    expect(microphone).toHaveAttribute("aria-busy", "true");

    engine.settleMedia();
    await shell.settle();
    expect(microphone).toHaveAttribute("aria-pressed", "false");
    expect(microphone).toHaveAttribute("aria-busy", "false");
    expect(within(microphone).getByText("Off")).toBeInTheDocument();
  });

  it("follows changes the engine makes on its own", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    shell.engines.last.setLocalMedia("camera", false);
    await shell.settle();
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
  });

  it("ignores presses while a change is in flight", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.mediaOutcomes.disableCamera = "pending";
    const camera = within(toolbar()).getByRole("button", { name: "Camera" });
    await shell.user.click(camera);
    await shell.settle();
    await shell.user.click(camera);
    await shell.user.click(camera);
    expect(engine.callsTo("disableCamera")).toHaveLength(1);
    expect(engine.callsTo("enableCamera")).toHaveLength(1);
    engine.settleMedia();
    await shell.settle();
    expect(camera).toHaveAttribute("aria-pressed", "false");
  });

  it("turns the camera and microphone off and on through the engine", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Camera" }));
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Microphone" }));
    await shell.settle();
    expect(engine.localMediaState).toMatchObject({ camera: false, microphone: false });
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Camera" }));
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Microphone" }));
    await shell.settle();
    expect(engine.localMediaState).toMatchObject({ camera: true, microphone: true });
    expect(engine.callsTo("disableCamera")).toHaveLength(1);
    expect(engine.callsTo("mute")).toHaveLength(1);
  });

  it("leaves with Leave meeting, even while a toggle is pending", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.mediaOutcomes.disableCamera = "pending";
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Camera" }));
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Leave meeting" }));
    await shell.settle();

    expect(engine.callsTo("leave")).toHaveLength(1);
    expect(engine.localMediaState).toMatchObject({ camera: false, microphone: false });
    expect(screen.getByRole("heading", { level: 2, name: "You left the meeting" })).toBeInTheDocument();
    expect(shell.closed).toEqual([{ reason: "left" }]);
    engine.settleMedia();
    await shell.settle();
    expect(screen.queryByRole("toolbar")).toBeNull();
    expect(shell.closed).toEqual([{ reason: "left" }]);
  });

  it("shows Leave meeting as busy and ignores repeat presses while leaving", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    let finishLeave = (): void => {};
    const gate = new Promise<void>((resolve) => (finishLeave = resolve));
    let leaveCalls = 0;
    const leave = engine.leave.bind(engine);
    engine.leave = async () => {
      leaveCalls += 1;
      await gate;
      return leave();
    };
    const button = within(toolbar()).getByRole("button", { name: "Leave meeting" });
    await shell.user.click(button);
    await shell.settle();
    expect(button).toHaveAttribute("aria-busy", "true");
    await shell.user.click(button);
    expect(leaveCalls).toBe(1);

    finishLeave();
    await shell.settle();
    expect(screen.getByRole("heading", { level: 2, name: "You left the meeting" })).toBeInTheDocument();
    expect(shell.closed).toEqual([{ reason: "left" }]);
  });

  it("does not put Share screen in the DOM for a participant", async () => {
    const shell = await createShell({
      engine: (engine) => {
        engine.selfRole = "participant";
      },
    });
    await joinMeeting(shell);
    expect(screen.queryByRole("button", { name: "Share screen" })).toBeNull();
  });

  it("puts Share screen after the camera menu and before Participants in the tab order", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const camera = within(toolbar()).getByRole("button", { name: "Camera" });
    camera.focus();
    await shell.user.tab();
    expect(within(toolbar()).getByRole("button", { name: "Choose camera" })).toHaveFocus();
    await shell.user.tab();
    expect(within(toolbar()).getByRole("button", { name: "Share screen" })).toHaveFocus();
    await shell.user.tab();
    expect(within(toolbar()).getByRole("button", { name: "Participants (1)" })).toHaveFocus();
  });

  it("shows Share screen as not pressed, starts sharing through the engine, and keeps focus on it", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    const share = within(toolbar()).getByRole("button", { name: "Share screen" });
    expect(share).toHaveAttribute("aria-pressed", "false");
    expect(share).toHaveAttribute("aria-busy", "false");
    expect(within(share).getByText("Share screen")).toBeInTheDocument();

    await shell.user.click(share);
    await shell.settle();
    expect(engine.callsTo("startScreenShare")).toHaveLength(1);
    expect(share).toHaveAttribute("aria-pressed", "true");
    expect(share).toHaveFocus();
    expect(within(share).getByText("On")).toBeInTheDocument();

    await shell.user.click(share);
    await shell.settle();
    expect(engine.callsTo("stopScreenShare")).toHaveLength(1);
    expect(share).toHaveAttribute("aria-pressed", "false");
    expect(share).toHaveFocus();
  });

  it("works from the keyboard with Enter and Space", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const share = within(toolbar()).getByRole("button", { name: "Share screen" });
    share.focus();
    await shell.user.keyboard("{Enter}");
    await shell.settle();
    expect(share).toHaveAttribute("aria-pressed", "true");
    await shell.user.keyboard(" ");
    await shell.settle();
    expect(share).toHaveAttribute("aria-pressed", "false");
  });

  it("is busy while a share request is in flight, and ignores presses", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.mediaOutcomes.startScreenShare = "pending";
    const share = within(toolbar()).getByRole("button", { name: "Share screen" });
    await shell.user.click(share);
    await shell.settle();
    expect(share).toHaveAttribute("aria-busy", "true");
    expect(share).toHaveAttribute("aria-pressed", "false");
    await shell.user.click(share);
    expect(engine.callsTo("startScreenShare")).toHaveLength(1);

    engine.settleMedia();
    await shell.settle();
    expect(share).toHaveAttribute("aria-busy", "false");
    expect(share).toHaveAttribute("aria-pressed", "true");
  });

  it("follows a stop the engine makes on its own", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    const share = within(toolbar()).getByRole("button", { name: "Share screen" });
    await shell.user.click(share);
    await shell.settle();
    expect(share).toHaveAttribute("aria-pressed", "true");
    engine.setLocalMedia("screen", false);
    await shell.settle();
    expect(share).toHaveAttribute("aria-pressed", "false");
    expect(engine.callsTo("stopScreenShare")).toHaveLength(0);
  });
});
