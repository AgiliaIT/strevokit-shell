import { screen, within } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SvkAnnouncer } from "../src/elements/svk-announcer.js";
import { participant } from "./support/fakeEngine.js";
import { createShell, joinMeeting, liveRegion } from "./support/fixture.js";

describe("announcer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops a repeat within 500 ms but reads it again later", async () => {
    vi.useFakeTimers();
    const announcer = document.createElement("svk-announcer") as SvkAnnouncer;
    expect(announcer).toBeInstanceOf(SvkAnnouncer);
    document.body.append(announcer);
    await announcer.updateComplete;
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");

    announcer.announce("Camera off");
    await announcer.updateComplete;
    const first = region.querySelector("p");
    expect(first).not.toBeNull();
    announcer.announce("Camera off");
    await announcer.updateComplete;
    expect(region.querySelector("p")).toBe(first);

    vi.advanceTimersByTime(600);
    announcer.announce("Camera off");
    await announcer.updateComplete;
    expect(region.querySelector("p")).not.toBe(first);
    expect(region).toHaveTextContent("Camera off");
  });

  it("reads messages announced before the next render together, in order", async () => {
    const announcer = document.createElement("svk-announcer") as SvkAnnouncer;
    document.body.append(announcer);
    await announcer.updateComplete;
    const region = screen.getByRole("status");

    announcer.announce("Reconnected");
    announcer.announce("You can't do that in this meeting.");
    await announcer.updateComplete;
    expect([...region.querySelectorAll("p")].map((node) => node.textContent)).toEqual([
      "Reconnected",
      "You can't do that in this meeting.",
    ]);

    announcer.announce("Camera off");
    await announcer.updateComplete;
    expect([...region.querySelectorAll("p")].map((node) => node.textContent)).toEqual(["Camera off"]);
  });
});

describe("shell announcements", () => {
  it("announces joining, own microphone and camera changes, and leaving, without moving focus", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    expect(liveRegion()).toHaveTextContent("Joined the meeting");

    const toolbar = screen.getByRole("toolbar", { name: "Meeting controls" });
    const microphone = within(toolbar).getByRole("button", { name: "Microphone" });
    const camera = within(toolbar).getByRole("button", { name: "Camera" });

    await shell.user.click(microphone);
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("Microphone muted");
    expect(microphone).toHaveFocus();

    await shell.user.click(microphone);
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("Microphone on");

    await shell.user.click(camera);
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("Camera off");
    expect(camera).toHaveFocus();

    await shell.user.click(camera);
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("Camera on");

    await shell.user.click(within(toolbar).getByRole("button", { name: "Leave meeting" }));
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("You left the meeting");
  });

  it("announces only Joined the meeting during the join handoff", async () => {
    const shell = await createShell();
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(liveRegion().textContent?.trim() ?? ""));
    observer.observe(liveRegion(), { childList: true, subtree: true, characterData: true });
    await joinMeeting(shell);
    await shell.settle();
    observer.disconnect();
    expect(seen.filter(Boolean)).toEqual(["Joined the meeting"]);
  });

  it("announces other participants joining and leaving by name", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace Hopper"));
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("Grace Hopper joined");
    engine.removeParticipant("remote-1");
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("Grace Hopper left");
  });

  it("announces the final state when the meeting ends", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    shell.engines.last.close("meeting_ended");
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("The meeting has ended.");
  });

  it("announces the participant's own screen sharing on and off, without moving focus", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const share = within(screen.getByRole("toolbar", { name: "Meeting controls" })).getByRole("button", {
      name: "Share screen",
    });
    await shell.user.click(share);
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("Screen sharing on");
    expect(share).toHaveFocus();

    await shell.user.click(share);
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("Screen sharing off");
    expect(share).toHaveFocus();
  });

  it("announces Screen sharing off when the engine ends the share on its own", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.setLocalMedia("screen", true);
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("Screen sharing on");
    engine.setLocalMedia("screen", false);
    await shell.settle();
    expect(liveRegion()).toHaveTextContent("Screen sharing off");
  });

  it("does not announce another participant's screen sharing as the participant's own", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace Hopper"));
    await shell.settle();
    engine.setRemoteMedia("remote-1", "screen", true);
    await shell.settle();
    expect(liveRegion()).not.toHaveTextContent("Screen sharing");
  });
});
