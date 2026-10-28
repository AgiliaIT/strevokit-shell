import { screen, within } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { participant } from "./support/fakeEngine.js";
import { createShell } from "./support/fixture.js";

async function joinWithKeyboard(shell: Awaited<ReturnType<typeof createShell>>): Promise<void> {
  screen.getByRole("button", { name: "Join meeting" }).focus();
  await shell.user.keyboard("{Enter}");
  await shell.settle();
}

describe("keyboard", () => {
  it("tabs through the pre-join controls in order", async () => {
    const { user } = await createShell();
    await user.tab();
    expect(screen.getByRole("button", { name: "Camera" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Microphone" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("combobox", { name: "Camera device" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("combobox", { name: "Microphone device" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Join meeting" })).toHaveFocus();
  });

  it("toggles with Enter and Space, joins with Enter, then focuses the microphone", async () => {
    const shell = await createShell();
    await shell.user.tab();
    await shell.user.keyboard("{Enter}");
    await shell.settle();
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
    await shell.user.keyboard(" ");
    await shell.settle();
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "true");

    await joinWithKeyboard(shell);
    expect(shell.engines.last.callsTo("join")).toHaveLength(1);
    const toolbar = screen.getByRole("toolbar", { name: "Meeting controls" });
    expect(within(toolbar).getByRole("button", { name: "Microphone" })).toHaveFocus();

    await shell.user.keyboard(" ");
    await shell.settle();
    expect(within(toolbar).getByRole("button", { name: "Microphone" })).toHaveAttribute("aria-pressed", "false");
  });

  it("moves through the control bar in order", async () => {
    const shell = await createShell();
    await joinWithKeyboard(shell);
    const toolbar = screen.getByRole("toolbar", { name: "Meeting controls" });
    for (const name of [
      "Microphone",
      "Choose microphone",
      "Camera",
      "Choose camera",
      "Share screen",
      "Participants (1)",
      "Leave meeting",
      "End meeting",
    ]) {
      expect(within(toolbar).getByRole("button", { name })).toHaveFocus();
      await shell.user.tab();
    }
  });

  it("tabs through the open End meeting dialog starting on Cancel", async () => {
    const shell = await createShell();
    await joinWithKeyboard(shell);
    const endButton = screen.getByRole("button", { name: "End meeting" });
    endButton.focus();
    await shell.user.keyboard("{Enter}");
    await shell.settle();

    const dialog = screen.getByRole("dialog", { name: "End the meeting for everyone?" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await shell.user.tab();
    expect(within(dialog).getByRole("button", { name: "End meeting" })).toHaveFocus();
  });

  it("opens Participants with Enter and closes it with Escape, returning focus", async () => {
    const shell = await createShell();
    await joinWithKeyboard(shell);
    shell.engines.last.addParticipant(participant("remote-1", "Grace"));
    await shell.settle();
    const trigger = screen.getByRole("button", { name: "Participants (2)" });
    trigger.focus();
    await shell.user.keyboard("{Enter}");
    await shell.settle();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Participants" })).toBeInTheDocument();
    await shell.user.keyboard("{Escape}");
    await shell.settle();
    expect(screen.queryByRole("dialog", { name: "Participants" })).toBeNull();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("focuses the final heading after leaving", async () => {
    const shell = await createShell();
    await joinWithKeyboard(shell);
    screen.getByRole("button", { name: "Leave meeting" }).focus();
    await shell.user.keyboard("{Enter}");
    await shell.settle();
    expect(screen.getByRole("heading", { level: 2, name: "You left the meeting" })).toHaveFocus();
  });

  it("doesn't take focus from the host page when the meeting moves on", async () => {
    const shell = await createShell({ engine: (engine) => (engine.joinOutcome = "pending") });
    const outside = document.createElement("input");
    outside.setAttribute("aria-label", "Host page field");
    document.body.append(outside);
    await shell.user.click(screen.getByRole("button", { name: "Join meeting" }));
    outside.focus();
    shell.engines.last.finishJoin();
    await shell.settle();
    expect(screen.getByRole("toolbar", { name: "Meeting controls" })).toBeInTheDocument();
    expect(outside).toHaveFocus();

    shell.engines.last.close("meeting_ended");
    await shell.settle();
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    expect(outside).toHaveFocus();
  });
});
