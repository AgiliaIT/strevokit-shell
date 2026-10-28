import { screen, within } from "@testing-library/dom";
import type { MeetingErrorCode } from "@strevokit/meeting-sdk";
import { describe, expect, it } from "vitest";
import { createShell, joinMeeting, liveRegion } from "./support/fixture.js";

const FAILURES: [MeetingErrorCode, string][] = [
  ["screen_share_cancelled", "Screen sharing was cancelled."],
  [
    "permission_denied",
    "Screen sharing permission was denied. Allow screen sharing in your browser, then try again.",
  ],
  ["unsupported_environment", "Screen sharing isn't available in this meeting."],
  ["not_permitted", "You don't have permission to share your screen."],
];

function shareButton(): HTMLElement {
  return within(screen.getByRole("toolbar", { name: "Meeting controls" })).getByRole("button", { name: "Share screen" });
}

describe("screen share failures", () => {
  it.each(FAILURES)("%s shows a dismissible notice, not the final screen", async (code, text) => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.mediaOutcomes.startScreenShare = code;

    await shell.user.click(shareButton());
    await shell.settle();

    const message = document.querySelector(".svk-meeting-message");
    expect(message).toHaveAttribute("data-type", "notice");
    expect(message?.querySelector(".svk-meeting-message-text")).toHaveTextContent(text);
    expect(liveRegion()).toHaveTextContent(text);
    expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: /Unable to join|Something went wrong/u })).toBeNull();
    expect(shell.closed).toEqual([]);
    expect(shareButton()).toHaveAttribute("aria-pressed", "false");
    expect(shareButton()).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByRole("listitem", { name: /Shared screen/u })).toBeNull();

    await shell.user.click(screen.getByRole("button", { name: "Dismiss message" }));
    await shell.settle();
    expect(document.querySelector(".svk-meeting-message")).toBeNull();
  });

  it("lets the host try again after a failure", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.mediaOutcomes.startScreenShare = "screen_share_cancelled";
    await shell.user.click(shareButton());
    await shell.settle();
    delete engine.mediaOutcomes.startScreenShare;
    await shell.user.click(shareButton());
    await shell.settle();
    expect(engine.callsTo("startScreenShare")).toHaveLength(2);
    expect(shareButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("never shows the engine's message", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.mediaOutcomes.startScreenShare = "protocol_error";
    await shell.user.click(shareButton());
    await shell.settle();
    expect(document.querySelector(".svk-meeting-message")).toHaveTextContent(
      "Something went wrong in the meeting. If it stops working, leave and join again.",
    );
    expect(shell.element.textContent).not.toContain("protocol_error");
  });
});
