import { afterEach, describe, expect, it, vi } from "vitest";
import { STORAGE_KEY, loadDeviceChoice, outputOptions, resolveDevice, saveDeviceChoice, savedDevice } from "../src/media/deviceStore.js";

const usb = { deviceId: "camera-2", label: "USB camera" };
const mic = { deviceId: "mic-1", label: "Built-in microphone" };

describe("device store", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with the browser defaults", () => {
    expect(loadDeviceChoice()).toEqual({ camera: null, microphone: null });
  });

  it("writes and reads the versioned key", () => {
    saveDeviceChoice("camera", usb);
    saveDeviceChoice("microphone", mic);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({ camera: usb, microphone: mic });
    expect(loadDeviceChoice()).toEqual({ camera: usb, microphone: mic });
    expect(STORAGE_KEY).toBe("strevokit.meeting-shell.devices.v2");
  });

  it.each([
    ["bad JSON", "{not json"],
    ["an array", "[]"],
    ["an extra key", JSON.stringify({ camera: null, microphone: null, token: "x" })],
    ["a missing key", JSON.stringify({ camera: usb })],
    ["the old ID-only shape", JSON.stringify({ camera: "camera-1", microphone: null })],
    ["a non-string ID", JSON.stringify({ camera: { deviceId: 7, label: null }, microphone: null })],
    ["an empty ID", JSON.stringify({ camera: { deviceId: "", label: null }, microphone: null })],
    ["an extra device field", JSON.stringify({ camera: { ...usb, groupId: "g" }, microphone: null })],
    ["a non-string label", JSON.stringify({ camera: { deviceId: "camera-1", label: 3 }, microphone: null })],
  ])("discards %s", (_label, raw) => {
    localStorage.setItem(STORAGE_KEY, raw);
    expect(loadDeviceChoice()).toEqual({ camera: null, microphone: null });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("falls back to memory when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => saveDeviceChoice("microphone", mic)).not.toThrow();
    expect(loadDeviceChoice()).toEqual({ camera: null, microphone: mic });
  });

  it("stores device IDs and labels and nothing else", () => {
    saveDeviceChoice("camera", usb);
    expect(Object.keys(localStorage)).toEqual([STORAGE_KEY]);
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["camera", "microphone"]);
    expect(Object.keys(stored.camera as object).sort()).toEqual(["deviceId", "label"]);
  });
});

describe("output options", () => {
  const info = (deviceId: string, label: string, kind = "audiooutput"): MediaDeviceInfo =>
    ({ deviceId, label, kind, groupId: "", toJSON: () => ({}) }) as MediaDeviceInfo;

  it("lists speakers, drops an empty id, and names a hidden speaker", () => {
    expect(outputOptions([info("speaker-1", "Headphones"), info("", "Ignored"), info("speaker-2", "  ")])).toEqual([
      { deviceId: "speaker-1", label: "Headphones", named: true },
      { deviceId: "speaker-2", label: "Speaker 2", named: false },
    ]);
  });

  it("does not write a speaker into device storage", () => {
    saveDeviceChoice("camera", usb);
    outputOptions([info("speaker-1", "Headphones")]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")).toEqual({ camera: usb, microphone: null });
    expect(loadDeviceChoice()).toEqual({ camera: usb, microphone: null });
  });
});

describe("resolveDevice", () => {
  const named = (deviceId: string, label: string) => ({ deviceId, label, named: true });
  const options = [named("camera-1", "Front camera"), named("camera-9", "USB camera")];

  it("uses the browser default when nothing is remembered", () => {
    expect(resolveDevice(options, null)).toBeNull();
  });

  it("keeps the remembered ID while it is listed", () => {
    expect(resolveDevice(options, { deviceId: "camera-1", label: "Front camera" })).toBe("camera-1");
  });

  it("finds the same device by label when its ID changed", () => {
    expect(resolveDevice(options, usb)).toBe("camera-9");
  });

  it("uses the default when the device is gone or only its ID was known", () => {
    expect(resolveDevice(options, { deviceId: "camera-gone", label: "Desk camera" })).toBeNull();
    expect(resolveDevice(options, { deviceId: "camera-gone", label: null })).toBeNull();
  });

  it("never matches generic labels shown before permission", () => {
    const hidden = [{ deviceId: "camera-7", label: "Camera 1", named: false }];
    expect(resolveDevice(hidden, { deviceId: "camera-gone", label: "Camera 1" })).toBeNull();
    expect(savedDevice(hidden[0]!)).toEqual({ deviceId: "camera-7", label: null });
    expect(savedDevice(options[1]!)).toEqual({ deviceId: "camera-9", label: "USB camera" });
  });
});
