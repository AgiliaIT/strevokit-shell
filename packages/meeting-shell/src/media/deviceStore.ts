import { LABELS } from "../copy.js";
import type { DeviceKind } from "../copy.js";

/** A camera or microphone the user can choose. `deviceId` is opaque and never shown. */
export interface DeviceOption {
  readonly deviceId: string;
  readonly label: string;
  /** False while the browser hides device names and `label` is a generic "Camera 1". */
  readonly named: boolean;
}

export interface DeviceLists {
  readonly camera: readonly DeviceOption[];
  readonly microphone: readonly DeviceOption[];
  /** Empty when this browser cannot choose where meeting audio plays. */
  readonly speaker: readonly DeviceOption[];
}

export const NO_DEVICES: DeviceLists = Object.freeze({
  camera: Object.freeze([]),
  microphone: Object.freeze([]),
  speaker: Object.freeze([]),
});

/** True when the browser can send meeting audio to a chosen speaker. */
export function canSelectAudioOutput(): boolean {
  return typeof HTMLMediaElement !== "undefined" && typeof HTMLMediaElement.prototype.setSinkId === "function";
}

/** The choosable devices of `kind` in `devices`, with generic labels while the browser hides the real ones. */
export function deviceOptions(devices: readonly MediaDeviceInfo[], kind: DeviceKind): DeviceOption[] {
  const type = kind === "camera" ? "videoinput" : "audioinput";
  return devices
    .filter((device) => device.kind === type && device.deviceId !== "")
    .map((device, index) => {
      const label = device.label.trim();
      return { deviceId: device.deviceId, label: label || LABELS.genericDevice(kind, index + 1), named: label !== "" };
    });
}

/** Speakers the user can choose. Empty ids are omitted. A hidden browser name becomes "Speaker N". */
export function outputOptions(devices: readonly MediaDeviceInfo[]): DeviceOption[] {
  return devices
    .filter((device) => device.kind === "audiooutput" && device.deviceId !== "")
    .map((device, index) => {
      const label = device.label.trim();
      return { deviceId: device.deviceId, label: label || LABELS.genericSpeaker(index + 1), named: label !== "" };
    });
}

export function sameDeviceOptions(a: readonly DeviceOption[], b: readonly DeviceOption[]): boolean {
  return (
    a.length === b.length &&
    a.every((option, i) => option.deviceId === b[i]?.deviceId && option.label === b[i]?.label && option.named === b[i]?.named)
  );
}

/**
 * The ID of the remembered device among `options`: the same ID when it is still listed, otherwise the device with the
 * same browser label (its ID changed), otherwise `null` (the browser default).
 */
export function resolveDevice(options: readonly DeviceOption[], saved: SavedDevice | null): string | null {
  if (saved === null) return null;
  if (options.some((option) => option.deviceId === saved.deviceId)) return saved.deviceId;
  if (saved.label === null) return null;
  return options.find((option) => option.named && option.label === saved.label)?.deviceId ?? null;
}

/** What to remember for `option`: its ID, plus its label when the browser shows real names. */
export function savedDevice(option: DeviceOption): SavedDevice {
  return { deviceId: option.deviceId, label: option.named ? option.label : null };
}

/**
 * A remembered device. Browsers may hand out new device IDs (after a reload, in private windows, after clearing site
 * data), so the browser's label is kept too and used to find the same device again. `label` is null when the browser
 * hid it (no permission yet).
 */
export interface SavedDevice {
  readonly deviceId: string;
  readonly label: string | null;
}

/** The remembered camera and microphone. `null` means the browser default. Holds device IDs and labels only. */
export interface DeviceChoice {
  readonly camera: SavedDevice | null;
  readonly microphone: SavedDevice | null;
}

export const STORAGE_KEY = "strevokit.meeting-shell.devices.v2";
export const NO_CHOICE: DeviceChoice = Object.freeze({ camera: null, microphone: null });

let memory: DeviceChoice = NO_CHOICE;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, i) => key === keys[i]);
}

function isSavedDevice(value: unknown): value is SavedDevice {
  if (value === null) return true;
  if (!hasExactKeys(value, ["deviceId", "label"])) return false;
  const label = value.label;
  return typeof value.deviceId === "string" && value.deviceId !== "" && (label === null || (typeof label === "string" && label !== ""));
}

function isChoice(value: unknown): value is DeviceChoice {
  return hasExactKeys(value, ["camera", "microphone"]) && isSavedDevice(value.camera) && isSavedDevice(value.microphone);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const copyDevice = (device: SavedDevice | null): SavedDevice | null =>
  device === null ? null : { deviceId: device.deviceId, label: device.label };

/** The remembered choice. Bad or unknown data is discarded; storage errors fall back to memory. */
export function loadDeviceChoice(): DeviceChoice {
  const store = storage();
  if (!store) return memory;
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (raw === null) return memory;
    const parsed = parseJson(raw);
    if (isChoice(parsed)) return { camera: copyDevice(parsed.camera), microphone: copyDevice(parsed.microphone) };
    store.removeItem(STORAGE_KEY);
    return memory;
  } catch {
    return memory;
  }
}

/** Remembers `device` for `kind`, keeping the other kind's choice. */
export function saveDeviceChoice(kind: DeviceKind, device: SavedDevice | null): DeviceChoice {
  const next: DeviceChoice = { ...loadDeviceChoice(), [kind]: copyDevice(device) };
  memory = next;
  const store = storage();
  try {
    store?.setItem(STORAGE_KEY, JSON.stringify({ camera: next.camera, microphone: next.microphone }));
  } catch {
    // Storage is full or blocked: the in-memory choice is used for the rest of the page.
  }
  return next;
}

/** Test hook: forgets the in-memory fallback. */
export function resetDeviceChoiceMemory(): void {
  memory = NO_CHOICE;
}
