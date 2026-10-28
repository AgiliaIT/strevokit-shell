import { screen, within } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { MeetingError } from "@strevokit/meeting-sdk";
import { createShell, joinMeeting, liveRegion } from "./support/fixture.js";

function toolbar(): HTMLElement {
  return screen.getByRole("toolbar", { name: "Meeting controls" });
}

describe("end meeting", () => {
  it("opens the confirmation dialog with the exact copy and initial focus on Cancel", async () => {
    const shell = await createShell();
    await joinMeeting(shell);

    const endButton = within(toolbar()).getByRole("button", { name: "End meeting" });
    await shell.user.click(endButton);
    await shell.settle();

    const dialog = screen.getByRole("dialog", { name: "End the meeting for everyone?" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("heading", { level: 2, name: "End the meeting for everyone?" })).toBeInTheDocument();
    expect(within(dialog).getByText("Everyone will leave the meeting.")).toBeInTheDocument();

    const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
    const confirmButton = within(dialog).getByRole("button", { name: "End meeting" });
    expect(cancelButton).toBeInTheDocument();
    expect(confirmButton).toBeInTheDocument();
    expect(cancelButton).toHaveFocus();
  });

  it("closes on Cancel without ending the meeting, returning focus to End meeting", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;

    const endButton = within(toolbar()).getByRole("button", { name: "End meeting" });
    await shell.user.click(endButton);
    await shell.settle();

    const dialog = screen.getByRole("dialog", { name: "End the meeting for everyone?" });
    const cancelButton = within(dialog).getByRole("button", { name: "Cancel" });
    await shell.user.click(cancelButton);
    await shell.settle();

    expect(screen.queryByRole("dialog", { name: "End the meeting for everyone?" })).toBeNull();
    expect(engine.callsTo("endMeeting")).toHaveLength(0);
    expect(endButton).toHaveFocus();
  });

  it("closes on Escape without ending the meeting, returning focus to End meeting", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;

    const endButton = within(toolbar()).getByRole("button", { name: "End meeting" });
    await shell.user.click(endButton);
    await shell.settle();

    expect(screen.getByRole("dialog", { name: "End the meeting for everyone?" })).toBeInTheDocument();
    await shell.user.keyboard("{Escape}");
    await shell.settle();

    expect(screen.queryByRole("dialog", { name: "End the meeting for everyone?" })).toBeNull();
    expect(engine.callsTo("endMeeting")).toHaveLength(0);
    expect(endButton).toHaveFocus();
  });

  it("marks confirm button as busy and ignores further presses while endMeeting is pending", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.endMeetingOutcome = "pending";

    const endButton = within(toolbar()).getByRole("button", { name: "End meeting" });
    await shell.user.click(endButton);
    await shell.settle();

    const dialog = screen.getByRole("dialog", { name: "End the meeting for everyone?" });
    const confirmButton = within(dialog).getByRole("button", { name: "End meeting" });

    await shell.user.click(confirmButton);
    await shell.settle();

    expect(engine.callsTo("endMeeting")).toHaveLength(1);
    expect(confirmButton).toHaveAttribute("aria-busy", "true");

    await shell.user.click(confirmButton);
    await shell.settle();
    expect(engine.callsTo("endMeeting")).toHaveLength(1);
  });

  it("shows the ended screen and emits svk-closed with reason meeting_ended on success", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.endMeetingOutcome = "pending";

    const endButton = within(toolbar()).getByRole("button", { name: "End meeting" });
    await shell.user.click(endButton);
    await shell.settle();

    const dialog = screen.getByRole("dialog", { name: "End the meeting for everyone?" });
    await shell.user.click(within(dialog).getByRole("button", { name: "End meeting" }));
    await shell.settle();

    engine.settleEndMeeting();
    await shell.settle();

    expect(screen.getByRole("heading", { level: 2, name: "The meeting has ended." })).toBeInTheDocument();
    expect(shell.closed).toEqual([{ reason: "meeting_ended" }]);
  });

  it("closes dialog, announces failure notice, keeps meeting running, and focuses End meeting on failure", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.endMeetingOutcome = "pending";

    const endButton = within(toolbar()).getByRole("button", { name: "End meeting" });
    await shell.user.click(endButton);
    await shell.settle();

    const dialog = screen.getByRole("dialog", { name: "End the meeting for everyone?" });
    await shell.user.click(within(dialog).getByRole("button", { name: "End meeting" }));
    await shell.settle();

    engine.settleEndMeeting("service_unavailable");
    await shell.settle();

    expect(screen.queryByRole("dialog", { name: "End the meeting for everyone?" })).toBeNull();
    expect(within(toolbar()).getByRole("button", { name: "End meeting" })).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("The meeting couldn't be ended. Try again.");
    expect(document.querySelector(".svk-meeting-message-text")).toHaveTextContent(
      "The meeting couldn't be ended. Try again.",
    );
    expect(endButton).toHaveFocus();
  });

  it("transitions directly to ended screen when connection drops with meeting_ended before join", async () => {
    const shell = await createShell();
    const engine = shell.engines.last;

    engine.emit("closed", { reason: "meeting_ended", error: new MeetingError("meeting_ended") });
    await shell.settle();

    expect(screen.getByRole("heading", { level: 2, name: "The meeting has ended." })).toBeInTheDocument();
    expect(shell.closed).toEqual([{ reason: "meeting_ended" }]);
  });

  it("transitions directly to ended screen when initial join fails with meeting_ended", async () => {
    const shell = await createShell();
    const engine = shell.engines.last;
    engine.joinOutcome = "meeting_ended";

    const joinButton = screen.getByRole("button", { name: "Join meeting" });
    await shell.user.click(joinButton);
    await shell.settle();

    expect(screen.getByRole("heading", { level: 2, name: "The meeting has ended." })).toBeInTheDocument();
    expect(shell.closed).toEqual([{ reason: "meeting_ended" }]);
  });

  it("transitions directly to ended screen when closed with meeting_ended during reconnect", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;

    // Simulate connection drop / close with meeting_ended
    engine.emit("closed", { reason: "meeting_ended", error: new MeetingError("meeting_ended") });
    await shell.settle();

    expect(screen.getByRole("heading", { level: 2, name: "The meeting has ended." })).toBeInTheDocument();
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });
});
