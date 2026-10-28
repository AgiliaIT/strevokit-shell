import { screen, within } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { participant } from "./support/fakeEngine.js";
import { fakeStream } from "./support/fakeMediaDevices.js";
import { createShell, joinMeeting } from "./support/fixture.js";

const LONG_NAME = "Maximilian Alexander von Hohenzollern-Sigmaringen der Dritte";

async function openList() {
  const shell = await createShell();
  await joinMeeting(shell);
  return shell;
}

describe("participant list", () => {
  it("names the trigger with a live count", async () => {
    const shell = await openList();
    expect(screen.getByRole("button", { name: "Participants (1)" })).toHaveAttribute("aria-expanded", "false");
    shell.engines.last.addParticipant(participant("remote-1", "Grace"));
    await shell.settle();
    expect(screen.getByRole("button", { name: "Participants (2)" })).toBeInTheDocument();
    shell.engines.last.removeParticipant("remote-1");
    await shell.settle();
    expect(screen.getByRole("button", { name: "Participants (1)" })).toBeInTheDocument();
  });

  it("lists every participant with name, role, connection, and media state", async () => {
    const shell = await openList();
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace Hopper"));
    engine.setRemoteMedia("remote-1", "microphone", true, fakeStream("microphone"));
    engine.setConnection("remote-1", "interrupted");
    await shell.settle();
    const trigger = screen.getByRole("button", { name: "Participants (2)" });
    await shell.user.click(trigger);
    await shell.settle();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const dialog = screen.getByRole("dialog", { name: "Participants" });
    expect(trigger).toHaveAttribute("aria-controls", dialog.id);
    const items = within(dialog).getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("aria-label"))).toEqual([
      "Ada Lovelace (You), Host, Connected, microphone on, camera on",
      "Grace Hopper, Participant, Connection interrupted, microphone on, camera off",
    ]);
  });

  it("updates entries live", async () => {
    const shell = await openList();
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace Hopper"));
    await shell.settle();
    await shell.user.click(screen.getByRole("button", { name: "Participants (2)" }));
    engine.setRemoteMedia("remote-1", "camera", true, fakeStream("camera"));
    await shell.settle();
    expect(screen.getByRole("listitem", { name: /^Grace Hopper, .*camera on$/u })).toBeInTheDocument();
    engine.removeParticipant("remote-1");
    await shell.settle();
    expect(screen.queryByRole("listitem", { name: /^Grace Hopper/u })).toBeNull();
  });

  it("closes with Escape and returns focus to the trigger", async () => {
    const shell = await openList();
    const trigger = screen.getByRole("button", { name: "Participants (1)" });
    await shell.user.click(trigger);
    await shell.settle();
    expect(screen.getByRole("dialog", { name: "Participants" })).toBeInTheDocument();
    await shell.user.keyboard("{Escape}");
    await shell.settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("never renders participant IDs", async () => {
    const shell = await openList();
    shell.engines.last.addParticipant(participant("remote-id-77", "Grace"));
    await shell.settle();
    await shell.user.click(screen.getByRole("button", { name: "Participants (2)" }));
    await shell.settle();
    expect(document.body.innerHTML).not.toContain("remote-id-77");
    expect(document.body.innerHTML).not.toContain("self-id-1");
  });

  it("truncates a long name visually and keeps it whole in the accessible text", async () => {
    const shell = await openList();
    shell.engines.last.addParticipant(participant("remote-1", LONG_NAME));
    await shell.settle();
    await shell.user.click(screen.getByRole("button", { name: "Participants (2)" }));
    await shell.settle();
    const entry = screen.getByRole("listitem", { name: new RegExp(`^${LONG_NAME}, Participant`, "u") });
    const name = within(entry).getByText(LONG_NAME);
    expect(name).toHaveClass("svk-participant-name");
    expect(name).toHaveAttribute("title", LONG_NAME);
  });

  it("gives each shell's dialog its own ID", async () => {
    const first = await openList();
    await first.user.click(screen.getByRole("button", { name: "Participants (1)" }));
    await first.settle();
    const second = await createShell();
    await joinMeeting(second);
    const triggers = screen.getAllByRole("button", { name: "Participants (1)" });
    await second.user.click(triggers[1] as HTMLElement);
    await second.settle();
    const ids = screen.getAllByRole("dialog", { name: "Participants" }).map((dialog) => dialog.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(ids.every((id) => id !== "")).toBe(true);
  });
});
