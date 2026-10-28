type PermissionKind = "camera" | "microphone";
/** A state, `"reject"` to make the query reject, or a promise to answer later. */
type PermissionAnswer = PermissionState | "reject" | Promise<PermissionState>;

const restorers: (() => void)[] = [];

/** Overrides `navigator[name]` until the returned function (or `restoreBrowser()`) puts the original back. */
function overrideNavigator(name: string, descriptor: PropertyDescriptor): () => void {
  const previous = Object.getOwnPropertyDescriptor(navigator, name);
  Object.defineProperty(navigator, name, { configurable: true, ...descriptor });
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (previous) Object.defineProperty(navigator, name, previous);
    else Reflect.deleteProperty(navigator, name);
  };
  restorers.push(restore);
  return restore;
}

class FakePermissionStatus extends EventTarget {
  onchange = null;
  constructor(
    readonly name: string,
    public state: PermissionState,
  ) {
    super();
  }
}

let permissionStates: Partial<Record<PermissionKind, PermissionAnswer>> = {};
const issuedStatuses: FakePermissionStatus[] = [];

/**
 * Installs a fake `navigator.permissions.query` answering each kind with the given state (`"prompt"` when not given).
 * `"reject"` makes the query reject; `null` removes the Permissions API.
 */
export function stubPermissions(states: Partial<Record<PermissionKind, PermissionAnswer>> | null): () => void {
  if (states === null) return overrideNavigator("permissions", { value: undefined });
  permissionStates = { ...states };
  issuedStatuses.length = 0;
  const permissions = {
    query: async ({ name }: { name: string }): Promise<PermissionStatus> => {
      const answer = permissionStates[name as PermissionKind] ?? "prompt";
      if (answer === "reject") throw new TypeError("unsupported permission name");
      const status = new FakePermissionStatus(name, await answer);
      issuedStatuses.push(status);
      return status as unknown as PermissionStatus;
    },
  };
  return overrideNavigator("permissions", { value: permissions });
}

/** Changes the `kind` permission, as when the user changes the site setting, and fires `change` on its statuses. */
export function changePermission(kind: PermissionKind, state: PermissionState): void {
  permissionStates[kind] = state;
  for (const status of issuedStatuses) {
    if (status.name !== kind) continue;
    status.state = state;
    status.dispatchEvent(new Event("change"));
  }
}

/** Overrides `navigator.onLine` and dispatches `online` or `offline` on `window`. */
export function setBrowserOnline(online: boolean): () => void {
  const restore = overrideNavigator("onLine", { get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
  return restore;
}

/** Undoes every override made by this module, newest first. */
export function restoreBrowser(): void {
  for (const restore of restorers.splice(0).reverse()) restore();
  permissionStates = {};
  issuedStatuses.length = 0;
}
