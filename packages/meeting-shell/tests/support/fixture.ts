import { screen } from "@testing-library/dom";
import { userEvent } from "@testing-library/user-event";
import type { MeetingLogger } from "@strevokit/meeting-sdk";
import { ReactiveElement } from "lit";
import "../../src/index.js";
import type { StrevokitMeetingElement } from "../../src/index.js";
import type { MeetingShellAppearance, MeetingShellClosedEvent, MeetingShellJoinedEvent } from "../../src/types.js";
import { setEngineFactoryForTests } from "../../src/engine/engineFactory.js";
import { engineFactory } from "./fakeEngine.js";
import type { FakeEngine } from "./fakeEngine.js";
import { FakeMediaDevices, installMediaDevices } from "./fakeMediaDevices.js";

export const TOKEN = "test-token-test";
export const REALTIME_URL = "wss://realtime.example.test";

export interface ShellOptions {
  /** `null` leaves the token unset. */
  readonly token?: string | null;
  /** `null` leaves the realtime URL unset. */
  readonly realtimeUrl?: string | null;
  readonly appearance?: MeetingShellAppearance;
  /** Scripts each fake engine the shell creates. */
  readonly engine?: (engine: FakeEngine, index: number) => void;
  /** `null` leaves `navigator.mediaDevices` undefined. */
  readonly devices?: FakeMediaDevices | null;
  /** Set before the element renders, so it sees every entry. */
  readonly logger?: MeetingLogger;
}

const created = new Set<StrevokitMeetingElement>();

/** Lets pending promises, microtasks, and the updates of `element` and every element inside it run. */
export async function settle(element?: Element): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
    if (!element) continue;
    const elements = [element, ...element.querySelectorAll("*")].filter((node) => node instanceof ReactiveElement);
    await Promise.all(elements.map((node) => node.updateComplete));
  }
}

/**
 * Appends a `<strevokit-meeting>` to the document with a scripted engine and fake devices, and resolves once it has
 * rendered. Events it dispatches are recorded in `joined` and `closed`.
 */
export async function createShell(options: ShellOptions = {}) {
  const engines = engineFactory(options.engine);
  setEngineFactoryForTests(engines.factory);
  const devices = options.devices === null ? null : installMediaDevices(options.devices ?? new FakeMediaDevices());
  const joined: MeetingShellJoinedEvent[] = [];
  const closed: MeetingShellClosedEvent[] = [];

  const element = document.createElement("strevokit-meeting");
  element.addEventListener("svk-joined", (event) => joined.push(event.detail));
  element.addEventListener("svk-closed", (event) => closed.push(event.detail));
  if (options.appearance !== undefined) element.appearance = options.appearance;
  if (options.logger !== undefined) element.logger = options.logger;
  const realtimeUrl = options.realtimeUrl === undefined ? REALTIME_URL : options.realtimeUrl;
  if (realtimeUrl !== null) element.realtimeUrl = realtimeUrl;
  const token = options.token === undefined ? TOKEN : options.token;
  if (token !== null) element.token = token;
  created.add(element);
  document.body.append(element);
  await settle(element);

  return { element, engines, devices, joined, closed, user: userEvent.setup(), settle: () => settle(element) };
}

export type Shell = Awaited<ReturnType<typeof createShell>>;

/** Presses Join and waits for the meeting screen. */
export async function joinMeeting(shell: Pick<Shell, "user" | "settle">): Promise<void> {
  await shell.user.click(screen.getByRole("button", { name: "Join meeting" }));
  await shell.settle();
}

/** The shell's live region. */
export function liveRegion(): HTMLElement {
  return screen.getByRole("status");
}

/** Removes every shell created by `createShell` and restores the real engine factory. */
export async function cleanup(): Promise<void> {
  for (const element of created) element.remove();
  created.clear();
  document.body.replaceChildren();
  await Promise.resolve();
  setEngineFactoryForTests(null);
}
