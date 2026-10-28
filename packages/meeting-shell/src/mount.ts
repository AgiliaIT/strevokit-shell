import type { MeetingShellEventMap, MountOptions, ShellHandle, ShellHandleEventMap } from "./types.js";

const NAME = "StrevokitShell.mount";

type Listeners = { [K in keyof ShellHandleEventMap]: Set<(event: ShellHandleEventMap[K]) => void> };

function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && (value as Partial<Node>).nodeType === 1;
}

function resolveTarget(target: unknown): Element {
  if (typeof target === "string") {
    const found = document.querySelector(target);
    if (!found) throw new TypeError(`${NAME}: no element matches ${target}`);
    return found;
  }
  if (isElement(target)) return target;
  throw new TypeError(`${NAME}: target must be a selector or an element`);
}

/**
 * Creates a `<strevokit-meeting>` inside `target` (a CSS selector or an element) and returns a handle to control it.
 * The target's other children are kept. Throws a `TypeError`, creating nothing, when the target can't be found or
 * the token is missing.
 *
 * @example
 * ```ts
 * import { mount } from "@strevokit/shell";
 * import "@strevokit/shell/styles.css";
 *
 * const shell = mount("#call-area", {
 *   token: tokenFromYourBackend,
 *   realtimeUrl: "wss://realtime.example.com",
 *   onClosed: (event) => console.log("meeting closed:", event.reason),
 * });
 * ```
 */
export function mount(target: string | HTMLElement, options: MountOptions): ShellHandle {
  const container = resolveTarget(target);
  const token: unknown = options?.token;
  if (typeof token !== "string" || token === "") throw new TypeError(`${NAME}: token is required`);

  const element = document.createElement("strevokit-meeting");
  if (options.appearance !== undefined) element.appearance = options.appearance;
  if (options.realtimeUrl !== undefined) element.realtimeUrl = options.realtimeUrl;
  if (options.logger !== undefined) element.logger = options.logger;
  if (options.hideEndMeeting !== undefined) element.hideEndMeeting = options.hideEndMeeting;
  element.token = token;

  const listeners: Listeners = { joined: new Set(), closed: new Set() };
  if (options.onJoined) listeners.joined.add(options.onJoined);
  if (options.onClosed) listeners.closed.add(options.onClosed);
  let destroyed = false;

  const onJoined = (event: MeetingShellEventMap["svk-joined"]): void => {
    if (!destroyed) for (const listener of [...listeners.joined]) listener(event.detail);
  };
  const onClosed = (event: MeetingShellEventMap["svk-closed"]): void => {
    if (!destroyed) for (const listener of [...listeners.closed]) listener(event.detail);
  };
  element.addEventListener("svk-joined", onJoined);
  element.addEventListener("svk-closed", onClosed);
  container.append(element);

  return {
    element,
    on<K extends keyof ShellHandleEventMap>(type: K, listener: (event: ShellHandleEventMap[K]) => void): () => void {
      if (destroyed) return () => {};
      const set = listeners[type] as Set<(event: ShellHandleEventMap[K]) => void>;
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    leave(): Promise<void> {
      return destroyed ? Promise.resolve() : element.leave();
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      listeners.joined.clear();
      listeners.closed.clear();
      element.removeEventListener("svk-joined", onJoined);
      element.removeEventListener("svk-closed", onClosed);
      element.remove();
    },
  };
}
