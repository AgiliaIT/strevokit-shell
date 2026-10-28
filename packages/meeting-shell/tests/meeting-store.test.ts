import type { MeetingEngineOptions } from "@strevokit/meeting-sdk";
import { describe, expect, it, vi } from "vitest";
import { connectionView, createMeetingStore, deriveParticipants, displayName } from "../src/engine/meetingStore.js";
import { FakeEngine, participant } from "./support/fakeEngine.js";
import { fakeStream } from "./support/fakeMediaDevices.js";

const OPTIONS: MeetingEngineOptions = { token: "t", realtimeUrl: "wss://realtime.example.test" };

async function joinedEngine(): Promise<FakeEngine> {
  const engine = new FakeEngine(OPTIONS);
  engine.selfRole = "participant";
  engine.participants = [
    participant("p-1", "Zed"),
    participant("h-1", "Hana", "host"),
    participant("p-2", "Amy"),
  ];
  await engine.join();
  return engine;
}

describe("participant derivation", () => {
  it("puts self first, then hosts, then others in join order", async () => {
    const engine = await joinedEngine();
    expect(deriveParticipants(engine).map((view) => [view.name, view.isSelf, view.role])).toEqual([
      ["Ada Lovelace", true, "participant"],
      ["Hana", false, "host"],
      ["Zed", false, "participant"],
      ["Amy", false, "participant"],
    ]);
  });

  it.each([
    ["connected", "connected"],
    [null, "connecting"],
    ["connecting", "connecting"],
    ["interrupted", "interrupted"],
    ["failed", "interrupted"],
  ] as const)("maps media connection %s to %s", (status, view) => {
    expect(connectionView(status)).toBe(view);
  });

  it("always shows self as connected, with local media and no audio stream", async () => {
    const engine = await joinedEngine();
    engine.statuses.set("self-id-1", "failed");
    engine.setLocalMedia("camera", true);
    const [self] = deriveParticipants(engine);
    expect(self).toMatchObject({ isSelf: true, connection: "connected", cameraOn: true, audioStream: null });
    expect(self?.cameraStream).toBe(engine.localMedia.camera);
  });

  it("derives self's screen from local media state and the local screen stream", async () => {
    const engine = await joinedEngine();
    expect(deriveParticipants(engine)[0]).toMatchObject({ screenOn: false, screenStream: null });
    engine.setLocalMedia("screen", true);
    const [self] = deriveParticipants(engine);
    expect(self).toMatchObject({ isSelf: true, screenOn: true });
    expect(self?.screenStream).toBe(engine.localMedia.screen);
    expect(self?.screenStream).not.toBeNull();
    engine.setLocalMedia("screen", false);
    expect(deriveParticipants(engine)[0]).toMatchObject({ screenOn: false, screenStream: null });
  });

  it("derives a remote participant's screen from their media flag and remote screen stream", async () => {
    const engine = await joinedEngine();
    const screen = fakeStream("screen");
    const find = () => deriveParticipants(engine).find((view) => view.key === "h-1");
    expect(find()).toMatchObject({ screenOn: false, screenStream: null });
    engine.setRemoteMedia("h-1", "screen", true);
    expect(find()).toMatchObject({ screenOn: true, screenStream: null });
    engine.setRemoteMedia("h-1", "screen", true, screen);
    expect(find()?.screenStream).toBe(screen);
    engine.setRemoteMedia("h-1", "screen", false, null);
    expect(find()).toMatchObject({ screenOn: false, screenStream: null });
  });

  it("keeps the camera and screen of one participant apart", async () => {
    const engine = await joinedEngine();
    const camera = fakeStream("camera");
    const screen = fakeStream("screen");
    engine.setRemoteMedia("h-1", "camera", true, camera);
    engine.setRemoteMedia("h-1", "screen", true, screen);
    const hana = deriveParticipants(engine).find((view) => view.key === "h-1");
    expect(hana?.cameraStream).toBe(camera);
    expect(hana?.screenStream).toBe(screen);
  });

  it("falls back to Guest for missing or blank names", () => {
    expect(displayName(undefined)).toBe("Guest");
    expect(displayName("   ")).toBe("Guest");
    expect(displayName("  Ada ")).toBe("Ada");
  });

  it("uses remote streams for others", async () => {
    const engine = await joinedEngine();
    const camera = fakeStream("camera");
    const microphone = fakeStream("microphone");
    engine.setRemoteMedia("p-1", "camera", true, camera);
    engine.setRemoteMedia("p-1", "microphone", true, microphone);
    const zed = deriveParticipants(engine).find((view) => view.key === "p-1");
    expect(zed).toMatchObject({ cameraOn: true, microphoneOn: true, cameraStream: camera, audioStream: microphone });
  });
});

describe("meeting store", () => {
  it("publishes a new frozen snapshot on every engine event", async () => {
    const engine = await joinedEngine();
    const store = createMeetingStore(engine);
    const listener = vi.fn();
    store.subscribe(listener);
    const initial = store.getSnapshot();
    expect(Object.isFrozen(initial)).toBe(true);
    expect(store.getSnapshot()).toBe(initial);

    engine.addParticipant(participant("p-3", "Lin"));
    expect(store.getSnapshot().participants.map((view) => view.name)).toContain("Lin");

    engine.setRemoteMedia("p-3", "microphone", true);
    expect(store.getSnapshot().participants.find((view) => view.key === "p-3")?.microphoneOn).toBe(true);

    engine.setConnection("p-3", "interrupted");
    expect(store.getSnapshot().participants.find((view) => view.key === "p-3")?.connection).toBe("interrupted");

    engine.emit("participant_reconnected", { participantId: "p-3" });
    engine.setConnection("p-3", "connected");
    expect(store.getSnapshot().participants.find((view) => view.key === "p-3")?.connection).toBe("connected");

    engine.removeParticipant("p-3");
    expect(store.getSnapshot().participants.map((view) => view.name)).not.toContain("Lin");
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(store.getSnapshot()).not.toBe(initial);
  });

  it("stops listening on destroy", async () => {
    const engine = await joinedEngine();
    const before = engine.listenerCount();
    const store = createMeetingStore(engine);
    expect(engine.listenerCount()).toBe(before + 11);
    const listener = vi.fn();
    store.subscribe(listener);
    store.destroy();
    expect(engine.listenerCount()).toBe(before);
    engine.addParticipant(participant("p-9", "Late"));
    expect(listener).not.toHaveBeenCalled();
  });
});
