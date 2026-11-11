import { screen, within } from "@testing-library/dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteAudio } from "../src/media/remote-audio.js";
import { participant } from "./support/fakeEngine.js";
import { fakeStream } from "./support/fakeMediaDevices.js";
import { createShell, joinMeeting } from "./support/fixture.js";

/** Records every audio element that starts playing, and lets the test refuse playback. */
function recordPlayback() {
  const played: HTMLAudioElement[] = [];
  const control = { allow: true };
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (this: HTMLMediaElement) {
    if (!(this instanceof HTMLAudioElement)) return Promise.resolve();
    if (!control.allow) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
    played.push(this);
    return Promise.resolve();
  });
  return { played, control, play };
}

describe("remote audio", () => {
  it("plays each remote microphone in its own audio element, outside the page", async () => {
    const { played } = recordPlayback();
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace"));
    engine.addParticipant(participant("remote-2", "Linus"));
    const grace = fakeStream("microphone");
    const linus = fakeStream("microphone");
    engine.setRemoteMedia("remote-1", "microphone", true, grace);
    engine.setRemoteMedia("remote-2", "microphone", true, linus);
    await shell.settle();

    expect(played).toHaveLength(2);
    expect(played.map((element) => element.srcObject)).toEqual([grace, linus]);
    expect(played.every((element) => !element.isConnected)).toBe(true);
    expect(document.querySelector("audio")).toBeNull();
    expect(screen.queryByRole("button", { name: "Turn on sound" })).toBeNull();
  });

  it("never plays the participant's own microphone", async () => {
    const { played } = recordPlayback();
    const shell = await createShell();
    await joinMeeting(shell);
    expect(shell.engines.last.localMediaState.microphone).toBe(true);
    expect(played).toEqual([]);
  });

  it("stops a participant's audio when they leave, and all audio when the meeting ends", async () => {
    const { played } = recordPlayback();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause");
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace"));
    engine.addParticipant(participant("remote-2", "Linus"));
    engine.setRemoteMedia("remote-1", "microphone", true, fakeStream("microphone"));
    engine.setRemoteMedia("remote-2", "microphone", true, fakeStream("microphone"));
    await shell.settle();
    const [grace, linus] = played;

    engine.removeParticipant("remote-1");
    await shell.settle();
    expect(grace?.srcObject).toBeNull();
    expect(pause.mock.contexts).toContain(grace);
    expect(linus?.srcObject).not.toBeNull();

    engine.close("meeting_ended");
    await shell.settle();
    expect(linus?.srcObject).toBeNull();
    expect(pause.mock.contexts).toContain(linus);
  });

  it("offers Turn on sound when the browser blocks playback, and retries on press", async () => {
    const { played, control, play } = recordPlayback();
    control.allow = false;
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace"));
    engine.setRemoteMedia("remote-1", "microphone", true, fakeStream("microphone"));
    await shell.settle();

    const toolbar = screen.getByRole("toolbar", { name: "Meeting controls" });
    const button = within(toolbar).getByRole("button", { name: "Turn on sound" });
    control.allow = true;
    const callsBefore = play.mock.calls.length;
    await shell.user.click(button);
    await shell.settle();
    expect(play.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(played).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Turn on sound" })).toBeNull();
  });
});

describe("speaker sink", () => {
  afterEach(() => {
    delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
  });

  it("applies a sink to current and later audio and restores the previous sink when rejected", async () => {
    const calls: string[] = [];
    (HTMLMediaElement.prototype as { setSinkId?: (sinkId: string) => Promise<void> }).setSinkId = function (sinkId: string) {
      calls.push(sinkId);
      if (sinkId === "speaker-9") return Promise.reject(new DOMException("browser said no", "NotAllowedError"));
      return Promise.resolve();
    };
    const audio = new RemoteAudio(() => undefined);
    const first = fakeStream("microphone");
    audio.sync([{ key: "a", stream: first }]);
    await audio.setSink("speaker-2");
    const later = fakeStream("microphone");
    audio.sync([
      { key: "a", stream: first },
      { key: "b", stream: later },
    ]);
    expect(calls).toEqual(["speaker-2", "speaker-2"]);
    await expect(audio.setSink("speaker-9")).rejects.toThrow(/^Couldn't switch speakers\.$/u);
    expect(calls.at(-1)).toBe("speaker-2");
    audio.dispose();
    expect(first.getTracks()[0]?.readyState).toBe("live");
  });

  it("assigns a player created during a sink change to the requested speaker", async () => {
    const calls: string[] = [];
    const held: { release: (() => void) | null } = { release: null };
    (HTMLMediaElement.prototype as { setSinkId?: (sinkId: string) => Promise<void> }).setSinkId = function (sinkId: string) {
      calls.push(sinkId);
      if (held.release) return Promise.resolve();
      return new Promise((resolve) => {
        held.release = resolve;
      });
    };
    const audio = new RemoteAudio(() => undefined);
    const first = fakeStream("microphone");
    audio.sync([{ key: "a", stream: first }]);
    const switching = audio.setSink("speaker-2");
    const later = fakeStream("microphone");
    audio.sync([
      { key: "a", stream: first },
      { key: "b", stream: later },
    ]);
    expect(calls).toEqual(["speaker-2", "speaker-2"]);
    held.release?.();
    await switching;
    audio.dispose();
  });

  it("rejects the sink change when a player added during the second wait fails", async () => {
    const calls: string[] = [];
    const held: Array<() => void> = [];
    let rejectNext = false;
    (HTMLMediaElement.prototype as { setSinkId?: (sinkId: string) => Promise<void> }).setSinkId = function (sinkId: string) {
      calls.push(sinkId);
      if (sinkId === "") return Promise.resolve();
      if (rejectNext) return Promise.reject(new DOMException("browser said no", "NotAllowedError"));
      return new Promise((resolve) => {
        held.push(resolve);
      });
    };
    const audio = new RemoteAudio(() => undefined);
    const first = fakeStream("microphone");
    audio.sync([{ key: "a", stream: first }]);
    const switching = audio.setSink("speaker-2");
    const second = fakeStream("microphone");
    audio.sync([
      { key: "a", stream: first },
      { key: "b", stream: second },
    ]);
    expect(calls).toEqual(["speaker-2", "speaker-2"]);
    held[0]?.();
    // Let the first assignment settle, so the next player is added during the following wait.
    await new Promise((resolve) => setTimeout(resolve, 0));
    rejectNext = true;
    audio.sync([
      { key: "a", stream: first },
      { key: "b", stream: second },
      { key: "c", stream: fakeStream("microphone") },
    ]);
    held[1]?.();
    await expect(switching).rejects.toThrow(/^Couldn't switch speakers\.$/u);
    expect(calls).toEqual(["speaker-2", "speaker-2", "speaker-2", "", "", ""]);
    audio.dispose();
  });
});
