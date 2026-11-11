import { screen, within } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FULL_SCREEN_REFUSAL } from "../src/copy.js";
import { participant } from "./support/fakeEngine.js";
import { fakeStream } from "./support/fakeMediaDevices.js";
import { createShell, joinMeeting, liveRegion } from "./support/fixture.js";

function toolbar(): HTMLElement {
  return screen.getByRole("toolbar", { name: "Meeting controls" });
}

function room(): HTMLElement {
  return document.querySelector(".svk-room") as HTMLElement;
}

function tilesList(): HTMLElement {
  return screen.getByRole("list", { name: "Participants' video" });
}

async function startLocalShare(shell: Awaited<ReturnType<typeof createShell>>): Promise<void> {
  shell.engines.last.setLocalMedia("screen", true, fakeStream("screen"));
  await shell.settle();
}

function setFullscreenElement(element: Element | null): void {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => element,
  });
}

function installBrowserFullscreen(meeting: HTMLElement): {
  readonly request: ReturnType<typeof vi.fn>;
  readonly exit: ReturnType<typeof vi.fn>;
} {
  const request = vi.fn().mockImplementation(async () => {
    setFullscreenElement(meeting);
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  const exit = vi.fn().mockImplementation(async () => {
    setFullscreenElement(null);
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  meeting.requestFullscreen = request;
  document.exitFullscreen = exit;
  return { request, exit };
}

describe("full screen presentation", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("does not render Full screen on pre-join, the gallery, or the final screen", async () => {
    const shell = await createShell();
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show controls" })).toBeNull();

    await joinMeeting(shell);
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    expect(tilesList()).not.toHaveAttribute("data-layout");

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Leave meeting" }));
    await shell.settle();
    expect(screen.getByRole("heading", { level: 2, name: "You left the meeting" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Exit full screen" })).toBeNull();
  });

  it("shows Full screen for a host and a participant while a share is on stage", async () => {
    const host = await createShell();
    await joinMeeting(host);
    await startLocalShare(host);
    expect(within(toolbar()).getByRole("button", { name: "Full screen" })).toBeInTheDocument();
    host.element.remove();

    const guest = await createShell({
      engine: (engine) => {
        engine.selfRole = "participant";
      },
    });
    await joinMeeting(guest);
    guest.engines.last.addParticipant(participant("remote-1", "Ada Lovelace", "host"));
    guest.engines.last.setRemoteMedia("remote-1", "screen", true, fakeStream("screen"));
    await guest.settle();
    expect(within(toolbar()).getByRole("button", { name: "Full screen" })).toBeInTheDocument();
    expect(within(toolbar()).queryByRole("button", { name: "Share screen" })).toBeNull();
  });

  it("enters presentation, announces without moving focus, and renames the button to Exit full screen", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    const meeting = shell.element;
    const request = vi.fn().mockResolvedValue(undefined);
    meeting.requestFullscreen = request;

    const button = within(toolbar()).getByRole("button", { name: "Full screen" });
    button.focus();
    await shell.user.click(button);
    await shell.settle();

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.instances[0]).toBe(meeting);
    expect(room()).toHaveAttribute("data-presentation", "true");
    expect(liveRegion()).toHaveTextContent("Full screen on");
    expect(button).toHaveFocus();
    expect(button).toHaveAccessibleName("Exit full screen");
    expect(within(toolbar()).getByRole("button", { name: "Show controls" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reveals and hides the essential controls with Show controls", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    shell.element.requestFullscreen = vi.fn().mockResolvedValue(undefined);

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();

    const show = within(toolbar()).getByRole("button", { name: "Show controls" });
    expect(show).toHaveAttribute("aria-pressed", "false");
    expect(within(toolbar()).queryByRole("button", { name: "Microphone" })).toBeNull();

    await shell.user.click(show);
    await shell.settle();
    expect(show).toHaveAttribute("aria-pressed", "true");
    expect(within(toolbar()).getByRole("button", { name: "Microphone" })).toBeInTheDocument();
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toBeInTheDocument();
    expect(within(toolbar()).getByRole("button", { name: /^Participants/u })).toBeInTheDocument();
    expect(within(toolbar()).getByRole("button", { name: "Leave meeting" })).toBeInTheDocument();
    expect(within(toolbar()).getByRole("button", { name: "Share screen" })).toBeInTheDocument();
    expect(within(toolbar()).getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();
    expect(show).toBeInTheDocument();

    await shell.user.click(show);
    await shell.settle();
    expect(show).toHaveAttribute("aria-pressed", "false");
    expect(within(toolbar()).queryByRole("button", { name: "Microphone" })).toBeNull();
    expect(within(toolbar()).getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();
    expect(within(toolbar()).getByRole("button", { name: "Show controls" })).toBeInTheDocument();
  });

  it("still hides the toolbar and shows the refusal sentence when requestFullscreen is missing", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    Reflect.deleteProperty(shell.element, "requestFullscreen");
    // jsdom may still expose the prototype method; force a missing call path.
    Object.defineProperty(shell.element, "requestFullscreen", {
      configurable: true,
      value: undefined,
    });

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();

    expect(room()).toHaveAttribute("data-presentation", "true");
    expect(screen.getByText(FULL_SCREEN_REFUSAL)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/NotAllowedError|TypeError|fullscreen/i);
    expect(within(toolbar()).queryByRole("button", { name: "Microphone" })).toBeNull();
    expect(within(toolbar()).getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();
  });

  it("still hides the toolbar and shows the refusal sentence when requestFullscreen rejects", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    shell.element.requestFullscreen = vi.fn().mockRejectedValue(new DOMException("Denied", "NotAllowedError"));

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();

    expect(room()).toHaveAttribute("data-presentation", "true");
    expect(screen.getByText(FULL_SCREEN_REFUSAL)).toBeInTheDocument();
    expect(screen.queryByText(/NotAllowedError/u)).toBeNull();
    expect(within(toolbar()).queryByRole("button", { name: "Microphone" })).toBeNull();
    expect(within(toolbar()).getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();
  });

  it("exits presentation, restores the panel snapshot from entry, and announces without moving focus", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    shell.element.requestFullscreen = vi.fn().mockRejectedValue(new Error("refused"));

    await shell.user.click(within(toolbar()).getByRole("button", { name: /^Participants/u }));
    await shell.settle();
    expect(within(toolbar()).getByRole("button", { name: /^Participants/u })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const enter = within(toolbar()).getByRole("button", { name: "Full screen" });
    await shell.user.click(enter);
    await shell.settle();
    expect(room()).toHaveAttribute("data-presentation", "true");

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Show controls" }));
    await shell.settle();
    await shell.user.click(within(toolbar()).getByRole("button", { name: /^Participants/u }));
    await shell.settle();
    expect(within(toolbar()).getByRole("button", { name: /^Participants/u })).toHaveAttribute(
      "aria-expanded",
      "false",
    );

    const exit = within(toolbar()).getByRole("button", { name: "Exit full screen" });
    exit.focus();
    await shell.user.click(exit);
    await shell.settle();

    expect(room()).not.toHaveAttribute("data-presentation");
    expect(screen.queryByText(FULL_SCREEN_REFUSAL)).toBeNull();
    expect(tilesList()).toHaveAttribute("data-layout", "share");
    expect(within(toolbar()).getByRole("button", { name: /^Participants/u })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByRole("complementary", { name: "Participants" })).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Full screen off");
    expect(exit).toHaveFocus();
    expect(exit).toHaveAccessibleName("Full screen");
  });

  it("Escape closes an open panel first and only leaves presentation when the panel is closed", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    shell.element.requestFullscreen = vi.fn().mockRejectedValue(new Error("refused"));

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Show controls" }));
    await shell.settle();
    await shell.user.click(within(toolbar()).getByRole("button", { name: /^Participants/u }));
    await shell.settle();
    expect(screen.getByRole("complementary", { name: "Participants" })).toBeInTheDocument();

    await shell.user.keyboard("{Escape}");
    await shell.settle();
    expect(room()).toHaveAttribute("data-presentation", "true");
    expect(screen.queryByRole("complementary", { name: "Participants" })).toBeNull();
    expect(within(toolbar()).getByRole("button", { name: /^Participants/u })).toHaveFocus();

    await shell.user.keyboard("{Escape}");
    await shell.settle();
    expect(room()).not.toHaveAttribute("data-presentation");
    expect(within(toolbar()).getByRole("button", { name: "Full screen" })).toBeInTheDocument();
  });

  it("leaves presentation through fullscreenchange when the meeting was browser-fullscreen", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    installBrowserFullscreen(shell.element);

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();
    expect(room()).toHaveAttribute("data-presentation", "true");

    setFullscreenElement(null);
    document.dispatchEvent(new Event("fullscreenchange"));
    await shell.settle();
    expect(room()).not.toHaveAttribute("data-presentation");
  });

  it("Exit full screen calls document.exitFullscreen when the meeting is browser-fullscreen", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    const { exit } = installBrowserFullscreen(shell.element);

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();
    expect(room()).toHaveAttribute("data-presentation", "true");
    expect(document.fullscreenElement).toBe(shell.element);

    const exitButton = within(toolbar()).getByRole("button", { name: "Exit full screen" });
    exitButton.focus();
    await shell.user.click(exitButton);
    await shell.settle();

    expect(exit).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(room()).not.toHaveAttribute("data-presentation");
    expect(liveRegion()).toHaveTextContent("Full screen off");
    expect(exitButton).toHaveFocus();
    expect(exitButton).toHaveAccessibleName("Full screen");
  });

  it("reveals controls on room hover and hides them after a short idle", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    shell.element.requestFullscreen = vi.fn().mockResolvedValue(undefined);

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();
    expect(room()).not.toHaveAttribute("data-controls-revealed");
    expect(within(toolbar()).queryByRole("button", { name: "Microphone" })).toBeNull();

    vi.useFakeTimers();
    room().dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    await shell.settle();
    expect(room()).toHaveAttribute("data-controls-revealed", "true");
    expect(within(toolbar()).getByRole("button", { name: "Microphone" })).toBeInTheDocument();

    room().dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    await shell.settle();
    expect(room()).toHaveAttribute("data-controls-revealed", "true");

    vi.advanceTimersByTime(499);
    await shell.settle();
    expect(room()).toHaveAttribute("data-controls-revealed", "true");

    vi.advanceTimersByTime(1);
    await shell.settle();
    expect(room()).not.toHaveAttribute("data-controls-revealed");
    expect(within(toolbar()).queryByRole("button", { name: "Microphone" })).toBeNull();
    expect(within(toolbar()).getByRole("button", { name: "Exit full screen" })).toBeInTheDocument();
  });

  it("keeps controls revealed when the pointer re-enters before the hide idle ends", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    shell.element.requestFullscreen = vi.fn().mockResolvedValue(undefined);

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();

    vi.useFakeTimers();
    room().dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    await shell.settle();
    room().dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    await shell.settle();
    vi.advanceTimersByTime(200);
    await shell.settle();
    expect(room()).toHaveAttribute("data-controls-revealed", "true");

    room().dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));
    await shell.settle();
    vi.advanceTimersByTime(500);
    await shell.settle();
    expect(room()).toHaveAttribute("data-controls-revealed", "true");
    expect(within(toolbar()).getByRole("button", { name: "Microphone" })).toBeInTheDocument();
  });

  it("leaves presentation when the screen stream clears and restores the gallery", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    shell.element.requestFullscreen = vi.fn().mockRejectedValue(new Error("refused"));

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();
    expect(room()).toHaveAttribute("data-presentation", "true");

    shell.engines.last.setLocalMedia("screen", false, null);
    await shell.settle();
    expect(room()).not.toHaveAttribute("data-presentation");
    expect(tilesList()).not.toHaveAttribute("data-layout");
    expect(tilesList()).toHaveAttribute("data-count", "1");
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
  });

  it("exits browser fullscreen when the screen stream clears during presentation", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    const { exit } = installBrowserFullscreen(shell.element);

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();
    expect(room()).toHaveAttribute("data-presentation", "true");
    expect(document.fullscreenElement).toBe(shell.element);

    shell.engines.last.setLocalMedia("screen", false, null);
    await shell.settle();

    expect(exit).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(room()).not.toHaveAttribute("data-presentation");
    expect(tilesList()).not.toHaveAttribute("data-layout");
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
  });

  it("exits a late requestFullscreen success after presentation has already left", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);

    let resolveRequest!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveRequest = resolve;
    });
    const request = vi.fn().mockReturnValue(pending);
    const exit = vi.fn().mockImplementation(async () => {
      setFullscreenElement(null);
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    shell.element.requestFullscreen = request;
    document.exitFullscreen = exit;

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();
    expect(room()).toHaveAttribute("data-presentation", "true");
    expect(request).toHaveBeenCalledTimes(1);

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Show controls" }));
    await shell.settle();
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Exit full screen" }));
    await shell.settle();
    expect(room()).not.toHaveAttribute("data-presentation");

    setFullscreenElement(shell.element);
    resolveRequest();
    await shell.settle();

    expect(exit).toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(room()).not.toHaveAttribute("data-presentation");
    expect(screen.queryByText(FULL_SCREEN_REFUSAL)).toBeNull();
  });

  it("does not show the refusal notice when a late requestFullscreen rejects after leave", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);

    let rejectRequest!: (reason?: unknown) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectRequest = reject;
    });
    shell.element.requestFullscreen = vi.fn().mockReturnValue(pending);

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();
    expect(room()).toHaveAttribute("data-presentation", "true");

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Show controls" }));
    await shell.settle();
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Exit full screen" }));
    await shell.settle();
    expect(room()).not.toHaveAttribute("data-presentation");
    expect(screen.queryByText(FULL_SCREEN_REFUSAL)).toBeNull();

    rejectRequest(new DOMException("Denied", "NotAllowedError"));
    await shell.settle();

    expect(room()).not.toHaveAttribute("data-presentation");
    expect(screen.queryByText(FULL_SCREEN_REFUSAL)).toBeNull();
  });

  it("does not leave presentation when the panel opens or closes during presentation", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await startLocalShare(shell);
    shell.element.requestFullscreen = vi.fn().mockRejectedValue(new Error("refused"));

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Full screen" }));
    await shell.settle();
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Show controls" }));
    await shell.settle();

    await shell.user.click(within(toolbar()).getByRole("button", { name: /^Participants/u }));
    await shell.settle();
    expect(room()).toHaveAttribute("data-presentation", "true");
    expect(screen.getByRole("complementary", { name: "Participants" })).toBeInTheDocument();

    await shell.user.click(within(toolbar()).getByRole("button", { name: /^Participants/u }));
    await shell.settle();
    expect(room()).toHaveAttribute("data-presentation", "true");
    expect(screen.queryByRole("complementary", { name: "Participants" })).toBeNull();
  });
});
