import { readFileSync } from "node:fs";
import { join } from "node:path";
import { screen, within } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { participant } from "./support/fakeEngine.js";
import { createShell, type Shell } from "./support/fixture.js";

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
    expect(screen.queryByRole("dialog", { name: "Participants" })).toBeNull();
    const panel = screen.getByRole("complementary", { name: "Participants" });
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Close participants" })).toBeInTheDocument();

    const close = within(panel).getByRole("button", { name: "Close participants" });
    const microphone = within(screen.getByRole("toolbar", { name: "Meeting controls" })).getByRole("button", {
      name: "Microphone",
    });
    microphone.focus();
    for (let step = 0; step < 16 && document.activeElement !== close; step += 1) {
      await shell.user.tab();
    }
    expect(close).toHaveFocus();

    await shell.user.keyboard("{Escape}");
    await shell.settle();
    expect(screen.queryByRole("complementary", { name: "Participants" })).toBeNull();
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

  it("tabs to the critical controls in visual order, including while sharing", async () => {
    installShellStyles();
    const shell = await createShell();
    await joinWithKeyboard(shell);
    const toolbar = screen.getByRole("toolbar", { name: "Meeting controls" });
    expect(within(toolbar).getByRole("button", { name: "Share screen" })).toBeInTheDocument();

    await expectCriticalTabOrder(shell);
    const share = within(toolbar).getByRole("button", { name: "Share screen" });
    share.focus();
    await shell.user.keyboard("{Enter}");
    await shell.settle();
    expect(share).toHaveAttribute("aria-pressed", "true");
    expect(shell.engines.last.localMedia.screen).not.toBeNull();
    await expectCriticalTabOrder(shell);

    const microphone = within(toolbar).getByRole("button", { name: "Microphone" });
    microphone.focus();
    await shell.user.keyboard(" ");
    await shell.settle();
    expect(microphone).toHaveAttribute("aria-pressed", "false");

    const camera = within(toolbar).getByRole("button", { name: "Camera" });
    camera.focus();
    await shell.user.keyboard("{Enter}");
    await shell.settle();
    expect(camera).toHaveAttribute("aria-pressed", "false");

    const participants = within(toolbar).getByRole("button", { name: /^Participants \(\d+\)$/u });
    participants.focus();
    await shell.user.keyboard(" ");
    await shell.settle();
    expect(participants).toHaveAttribute("aria-expanded", "true");

    const leave = within(toolbar).getByRole("button", { name: "Leave meeting" });
    leave.focus();
    await shell.user.keyboard("{Enter}");
    await shell.settle();
    expect(screen.getByRole("heading", { level: 2, name: "You left the meeting" })).toBeInTheDocument();
  });
});

const CRITICAL_NAMES = [/^Microphone$/u, /^Camera$/u, /^Participants \(\d+\)$/u, /^Leave meeting$/u] as const;

function installShellStyles(): void {
  if (document.querySelector("style[data-svk-keyboard-styles]")) return;
  const style = document.createElement("style");
  style.dataset.svkKeyboardStyles = "true";
  style.textContent = readFileSync(join(import.meta.dirname, "../src/styles/meeting.css"), "utf8");
  document.head.append(style);
}

/** Outline shorthand such as `2px solid var(--svk-focus)`. Longhands stay empty when the colour is a variable. */
function outlineWidth(rule: CSSStyleRule): number {
  const outline = rule.style.outline;
  if (!outline || outline === "none") return 0;
  return Number.parseFloat(outline);
}

/** The outline painted for keyboard focus. The test DOM does not match `:focus-visible`, so this reads that rule. */
function focusRingRule(): CSSStyleRule | null {
  for (const sheet of document.styleSheets) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (!rule.selectorText.includes(":focus-visible") || !rule.selectorText.includes("svk-")) continue;
      if (outlineWidth(rule) <= 0) continue;
      return rule;
    }
  }
  return null;
}

/** Tabbed controls use the shell focus ring: a visible outline, not colour alone. */
function expectVisibleFocusRing(control: HTMLElement): void {
  expect(control).toHaveFocus();
  const ring = focusRingRule();
  expect(ring).not.toBeNull();
  if (!ring) return;
  const selector = ring.selectorText.replaceAll(":focus-visible", "").trim();
  expect(control.matches(selector)).toBe(true);
  expect(outlineWidth(ring)).toBeGreaterThan(0);
  if (!control.matches(":focus-visible")) return;
  const style = getComputedStyle(control);
  expect(style.outlineStyle).not.toBe("none");
  expect(Number.parseFloat(style.outlineWidth)).toBeGreaterThan(0);
}

/** Tab reaches Microphone, Camera, Participants, and Leave in that visual order. */
async function expectCriticalTabOrder(shell: Shell): Promise<void> {
  const toolbar = screen.getByRole("toolbar", { name: "Meeting controls" });
  const targets = CRITICAL_NAMES.map((name) => within(toolbar).getByRole("button", { name }));
  for (let index = 1; index < targets.length; index += 1) {
    const earlier = targets[index - 1];
    const later = targets[index];
    if (!earlier || !later) throw new Error("missing critical control");
    expect(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  }

  const first = targets[0];
  if (!first) throw new Error("missing microphone");
  first.focus();
  await shell.user.tab({ shift: true });
  await shell.user.tab();

  for (const target of targets) {
    for (let step = 0; step < 12 && document.activeElement !== target; step += 1) {
      await shell.user.tab();
    }
    expect(document.activeElement).toBe(target);
    expectVisibleFocusRing(target);
  }
}
