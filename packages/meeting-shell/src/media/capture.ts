import type { DeviceKind } from "../copy.js";

export function mediaDevices(): MediaDevices | null {
  if (typeof navigator === "undefined") return null;
  const devices = navigator.mediaDevices as MediaDevices | undefined;
  return devices && typeof devices.getUserMedia === "function" ? devices : null;
}

/** Captures one kind, from `deviceId` when given. A missing chosen device falls back to the default device. */
export async function captureKind(kind: DeviceKind, deviceId: string | null): Promise<MediaStream> {
  const devices = mediaDevices();
  if (!devices) throw new TypeError("unsupported");
  const constraint = deviceId ? { deviceId: { exact: deviceId } } : true;
  const constraints: MediaStreamConstraints = kind === "camera" ? { video: constraint } : { audio: constraint };
  try {
    return await devices.getUserMedia(constraints);
  } catch (error) {
    if (deviceId && errorName(error) === "OverconstrainedError") {
      return devices.getUserMedia(kind === "camera" ? { video: true } : { audio: true });
    }
    throw error;
  }
}

export function errorName(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "name" in error && typeof error.name === "string") {
    return error.name;
  }
  return undefined;
}

/**
 * The browser's permission state for `kind`, or `null` when the browser can't say (no Permissions API, a query that
 * rejects, or an unexpected answer). Never throws.
 */
export async function permissionState(kind: DeviceKind): Promise<PermissionState | null> {
  const status = await permissionStatus(kind);
  const state = status?.state;
  return state === "granted" || state === "denied" || state === "prompt" ? state : null;
}

async function permissionStatus(kind: DeviceKind): Promise<PermissionStatus | null> {
  try {
    const permissions = typeof navigator === "undefined" ? undefined : (navigator.permissions as Permissions | undefined);
    if (!permissions || typeof permissions.query !== "function") return null;
    return await permissions.query({ name: kind as PermissionName });
  } catch {
    return null;
  }
}

/** Whether the browser lists at least one device of `kind`. Never throws. */
export async function hasDevice(kind: DeviceKind): Promise<boolean> {
  const devices = mediaDevices();
  if (!devices || typeof devices.enumerateDevices !== "function") return false;
  try {
    const wanted = kind === "camera" ? "videoinput" : "audioinput";
    return (await devices.enumerateDevices()).some((device) => device.kind === wanted);
  } catch {
    return false;
  }
}

/**
 * Calls `onChange` once things settle after the browser's `kind` permission changes or devices are added or removed,
 * until the returned function is called. Browsers that can't report a change are simply not watched for it.
 */
export function watchDevice(kind: DeviceKind, onChange: () => void, settleMs = 300): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let status: PermissionStatus | null = null;
  const changed = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!stopped) onChange();
    }, settleMs);
  };
  const devices = mediaDevices();
  if (typeof devices?.addEventListener === "function") devices.addEventListener("devicechange", changed);
  void permissionStatus(kind).then((found) => {
    if (stopped || typeof found?.addEventListener !== "function") return;
    status = found;
    found.addEventListener("change", changed);
  });
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (typeof devices?.removeEventListener === "function") devices.removeEventListener("devicechange", changed);
    status?.removeEventListener("change", changed);
  };
}

export function stopStream(stream: MediaStream | null): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** The device a stream is captured from, as reported by its first track. */
export function streamDeviceId(stream: MediaStream | null): string | null {
  const track = stream?.getTracks()[0];
  const id = track && typeof track.getSettings === "function" ? track.getSettings().deviceId : undefined;
  return typeof id === "string" && id !== "" ? id : null;
}
