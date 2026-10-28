import axe from "axe-core";
import { screen } from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";
import { SHOW_AFTER_MS } from "../src/errors/connectionBanner.js";
import { participant, type FakeEngine } from "./support/fakeEngine.js";
import { fakeStream } from "./support/fakeMediaDevices.js";
import { createShell, joinMeeting, type Shell } from "./support/fixture.js";

/** Joins with one connected remote participant. */
async function meetingWithRemote(appearance: "light" | "dark"): Promise<{ shell: Shell; engine: FakeEngine }> {
  const shell = await createShell({ appearance });
  await joinMeeting(shell);
  const engine = shell.engines.last;
  engine.addParticipant(participant("remote-1", "Grace Hopper", "participant"));
  engine.setConnection("remote-1", "connected");
  await shell.settle();
  return { shell, engine };
}

/** Interrupts the remote participant's connection for long enough to show the banner. */
async function showReconnectingBanner(shell: Shell, engine: FakeEngine): Promise<void> {
  vi.useFakeTimers();
  try {
    engine.setConnection("remote-1", "interrupted");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    await shell.settle();
  } finally {
    vi.useRealTimers();
  }
}

async function violations(): Promise<string[]> {
  const results = await axe.run(document.body, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.html).join(" | ")}`);
}

describe("axe", () => {
  it("finds no violations on the pre-join screen", async () => {
    await createShell();
    expect(await violations()).toEqual([]);
  });

  it("finds no violations while joining", async () => {
    const shell = await createShell({ engine: (engine) => (engine.joinOutcome = "pending") });
    await shell.user.click(screen.getByRole("button", { name: "Join meeting" }));
    await shell.settle();
    expect(screen.getByRole("button", { name: "Joining…" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  it("finds no violations with a failed join and blocked devices", async () => {
    const shell = await createShell({
      engine: (engine, index) => (engine.joinOutcome = index === 0 ? "service_unavailable" : "resolve"),
    });
    await shell.user.click(screen.getByRole("button", { name: "Join meeting" }));
    await shell.settle();
    expect(await violations()).toEqual([]);
  });

  it("finds no violations in the meeting with two participants and every popup open", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace Hopper", "participant"));
    engine.setRemoteMedia("remote-1", "camera", true, fakeStream("camera"));
    engine.setConnection("remote-1", "interrupted");
    await shell.settle();
    expect(await violations()).toEqual([]);

    await shell.user.click(screen.getByRole("button", { name: "Participants (2)" }));
    await shell.settle();
    expect(screen.getByRole("dialog", { name: "Participants" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);

    await shell.user.click(screen.getByRole("button", { name: "Choose camera" }));
    await shell.settle();
    expect(screen.getByRole("menu", { name: "Choose camera" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  it("finds no violations while sharing the screen, with the share tile and a failure notice", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    await shell.user.click(screen.getByRole("button", { name: "Share screen" }));
    await shell.settle();
    expect(screen.getByRole("listitem", { name: "Ada Lovelace (You), Shared screen" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);

    engine.mediaOutcomes.stopScreenShare = "not_permitted";
    await shell.user.click(screen.getByRole("button", { name: "Share screen" }));
    await shell.settle();
    expect(document.querySelector(".svk-meeting-message")).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it("finds no violations with the End meeting dialog open", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await shell.user.click(screen.getByRole("button", { name: "End meeting" }));
    await shell.settle();
    expect(screen.getByRole("dialog", { name: "End the meeting for everyone?" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  it.each(["light", "dark"] as const)("finds no violations with the connection banner in both tones (%s)", async (appearance) => {
    const { shell, engine } = await meetingWithRemote(appearance);
    await showReconnectingBanner(shell, engine);
    expect(document.querySelector('.svk-meeting-message[data-type="banner"][data-tone="warning"]')).not.toBeNull();
    expect(await violations()).toEqual([]);

    engine.setConnection("remote-1", "failed");
    await shell.settle();
    expect(document.querySelector('.svk-meeting-message[data-type="banner"][data-tone="danger"]')).not.toBeNull();
    expect(await violations()).toEqual([]);
  });

  it.each(["light", "dark"] as const)("finds no violations with a notice and its Dismiss button (%s)", async (appearance) => {
    const { shell, engine } = await meetingWithRemote(appearance);
    engine.emitError("not_permitted");
    await shell.settle();
    expect(document.querySelector('.svk-meeting-message[data-type="notice"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Dismiss message" })).toBeInTheDocument();
    expect(await violations()).toEqual([]);
  });

  it("finds no violations on the final screen", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await shell.user.click(screen.getByRole("button", { name: "Leave meeting" }));
    await shell.settle();
    expect(await violations()).toEqual([]);
  });
});
