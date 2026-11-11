import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BannerVariant } from "../src/copy.js";
import { ConnectionBanner, SHOW_AFTER_MS, STABLE_MS, type BannerEffect } from "../src/errors/connectionBanner.js";

const RECONNECTING = "Meeting connection lost — reconnecting…";
const PEER_RECONNECTING = "Audio and video interrupted — reconnecting…";
const RECONNECTING_OFFLINE = "Meeting connection lost — reconnecting… Check your internet connection.";
const FAILED_RECONNECT = "Audio and video couldn't reconnect. Leave the meeting, then join again.";
const FAILED_CONNECT = "Audio and video couldn't connect. Leave the meeting, then join again.";

function createBanner() {
  const changes: (BannerVariant | null)[] = [];
  const announcements: string[] = [];
  const effects: BannerEffect[] = [];
  const banner = new ConnectionBanner({
    onChange: (variant) => changes.push(variant),
    announce: (text) => announcements.push(text),
    report: (effect) => effects.push(effect),
  });
  return { banner, changes, announcements, effects };
}

/** A banner with one remote participant whose media is connected. */
function connectedBanner() {
  const setup = createBanner();
  setup.banner.participantStatus("remote-1", "connected");
  return setup;
}

describe("ConnectionBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows nothing for an interruption shorter than the threshold", () => {
    const { banner, changes, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "interrupted");
    vi.advanceTimersByTime(SHOW_AFTER_MS - 1);
    banner.participantStatus("remote-1", "connected");
    vi.advanceTimersByTime(SHOW_AFTER_MS * 5);
    expect(banner.variant).toBeNull();
    expect(changes).toEqual([]);
    expect(announcements).toEqual([]);
    expect(effects).toEqual([]);
  });

  it("shows peer reconnecting once the interruption lasts the threshold, announcing and reporting once", () => {
    const { banner, changes, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "interrupted");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    expect(banner.variant).toBe("peer_reconnecting");
    expect(changes).toEqual(["peer_reconnecting"]);
    expect(announcements).toEqual([PEER_RECONNECTING]);
    expect(effects).toEqual([{ type: "failure", code: "media_interrupted" }]);
  });

  it("counts connecting as degraded only after the participant was connected", () => {
    const fresh = createBanner();
    fresh.banner.participantStatus("remote-1", "connecting");
    vi.advanceTimersByTime(SHOW_AFTER_MS * 3);
    expect(fresh.banner.variant).toBeNull();

    const { banner } = connectedBanner();
    banner.participantStatus("remote-1", "connecting");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    expect(banner.variant).toBe("peer_reconnecting");
  });

  it("clears after a stable period with one Reconnected and a recovery effect", () => {
    const { banner, changes, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "interrupted");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    vi.advanceTimersByTime(500);
    banner.participantStatus("remote-1", "connected");
    vi.advanceTimersByTime(STABLE_MS - 1);
    expect(banner.variant).toBe("peer_reconnecting");
    vi.advanceTimersByTime(1);
    expect(banner.variant).toBeNull();
    expect(changes).toEqual(["peer_reconnecting", null]);
    expect(announcements).toEqual([PEER_RECONNECTING, "Reconnected"]);
    expect(effects).toEqual([
      { type: "failure", code: "media_interrupted" },
      { type: "recovery", interruptedMs: 500 + STABLE_MS },
    ]);
  });

  it("keeps one steady banner while the connection flaps", () => {
    const { banner, changes, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "interrupted");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    for (let i = 0; i < 4; i += 1) {
      banner.participantStatus("remote-1", "connected");
      vi.advanceTimersByTime(STABLE_MS / 2);
      banner.participantStatus("remote-1", "interrupted");
      vi.advanceTimersByTime(STABLE_MS / 2);
    }
    expect(changes).toEqual(["peer_reconnecting"]);
    banner.participantStatus("remote-1", "connected");
    vi.advanceTimersByTime(STABLE_MS);
    expect(changes).toEqual(["peer_reconnecting", null]);
    expect(announcements).toEqual([PEER_RECONNECTING, "Reconnected"]);
    expect(effects.filter((effect) => effect.type === "failure")).toHaveLength(1);
    expect(effects.filter((effect) => effect.type === "recovery")).toHaveLength(1);
  });

  it("shows a failure immediately: couldn't reconnect after having been connected", () => {
    const { banner, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "failed");
    expect(banner.variant).toBe("failed_reconnect");
    expect(announcements).toEqual([FAILED_RECONNECT]);
    expect(effects).toEqual([{ type: "failure", code: "media_connection_failed" }]);
  });

  it("shows a failure immediately: couldn't connect when never connected", () => {
    const { banner, announcements } = createBanner();
    banner.participantStatus("remote-1", "connecting");
    banner.participantStatus("remote-1", "failed");
    expect(banner.variant).toBe("failed_connect");
    expect(announcements).toEqual([FAILED_CONNECT]);
  });

  it("goes from peer reconnecting to failed with a new announcement and report", () => {
    const { banner, changes, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "interrupted");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    banner.participantStatus("remote-1", "failed");
    expect(changes).toEqual(["peer_reconnecting", "failed_reconnect"]);
    expect(announcements).toEqual([PEER_RECONNECTING, FAILED_RECONNECT]);
    expect(effects.map((effect) => effect.type === "failure" && effect.code)).toEqual([
      "media_interrupted",
      "media_connection_failed",
    ]);
  });

  it("clears a failure after recovery with Reconnected", () => {
    const { banner, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "failed");
    banner.participantStatus("remote-1", "connected");
    vi.advanceTimersByTime(STABLE_MS);
    expect(banner.variant).toBeNull();
    expect(announcements).toEqual([FAILED_RECONNECT, "Reconnected"]);
    expect(effects.at(-1)).toEqual({ type: "recovery", interruptedMs: STABLE_MS });
  });

  it("goes from failed back to peer reconnecting with a new announcement and report", () => {
    const { banner, changes, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "failed");
    banner.participantStatus("remote-1", "interrupted");
    expect(changes).toEqual(["failed_reconnect", "peer_reconnecting"]);
    expect(announcements).toEqual([FAILED_RECONNECT, PEER_RECONNECTING]);
    expect(effects.map((effect) => effect.type === "failure" && effect.code)).toEqual([
      "media_connection_failed",
      "media_interrupted",
    ]);
  });

  it("shows the offline variant when the browser is offline", () => {
    const { banner, announcements, effects } = connectedBanner();
    banner.network(false);
    vi.advanceTimersByTime(SHOW_AFTER_MS - 1);
    expect(banner.variant).toBeNull();
    vi.advanceTimersByTime(1);
    expect(banner.variant).toBe("reconnecting_offline");
    expect(announcements).toEqual([RECONNECTING_OFFLINE]);
    expect(effects).toEqual([{ type: "failure", code: "browser_offline" }]);
  });

  it("keeps meeting-service ↔ offline switches quiet", () => {
    const { banner, changes, announcements, effects } = connectedBanner();
    banner.meetingServiceStatus("reconnecting");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    banner.network(false);
    expect(banner.variant).toBe("reconnecting_offline");
    banner.network(true);
    expect(banner.variant).toBe("reconnecting");
    expect(changes).toEqual(["reconnecting", "reconnecting_offline", "reconnecting"]);
    expect(announcements).toEqual([RECONNECTING]);
    expect(effects).toHaveLength(1);
  });

  it("announces when audio and video interruption replaces meeting-service recovery", () => {
    const { banner, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "interrupted");
    banner.meetingServiceStatus("reconnecting");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    expect(banner.variant).toBe("reconnecting");
    expect(announcements).toEqual([RECONNECTING]);
    banner.meetingServiceStatus("ok");
    expect(banner.variant).toBe("peer_reconnecting");
    expect(announcements).toEqual([RECONNECTING, PEER_RECONNECTING]);
    expect(effects).toEqual([{ type: "failure", code: "media_interrupted" }]);
  });

  it("announces and reports when offline replaces an audio and video interruption", () => {
    const { banner, changes, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "interrupted");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    banner.network(false);
    expect(banner.variant).toBe("reconnecting_offline");
    banner.network(true);
    expect(banner.variant).toBe("peer_reconnecting");
    expect(changes).toEqual(["peer_reconnecting", "reconnecting_offline", "peer_reconnecting"]);
    expect(announcements).toEqual([PEER_RECONNECTING, RECONNECTING_OFFLINE, PEER_RECONNECTING]);
    expect(effects).toEqual([
      { type: "failure", code: "media_interrupted" },
      { type: "failure", code: "browser_offline" },
      { type: "failure", code: "media_interrupted" },
    ]);
  });

  it("prefers local meeting-service recovery over peer media interruption", () => {
    const { banner, announcements } = connectedBanner();
    banner.participantStatus("remote-1", "interrupted");
    banner.meetingServiceStatus("reconnecting");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    expect(banner.variant).toBe("reconnecting");
    expect(announcements).toEqual([RECONNECTING]);
    banner.meetingServiceStatus("ok");
    expect(banner.variant).toBe("peer_reconnecting");
    expect(announcements).toEqual([RECONNECTING, PEER_RECONNECTING]);
  });

  it("clears silently when the affected participant leaves", () => {
    const { banner, changes, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "interrupted");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    banner.participantGone("remote-1");
    expect(banner.variant).toBeNull();
    expect(changes).toEqual(["peer_reconnecting", null]);
    expect(announcements).toEqual([PEER_RECONNECTING]);
    expect(effects).toHaveLength(1);
  });

  it("clears silently when the participant's connection goes away", () => {
    const { banner, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "failed");
    banner.participantStatus("remote-1", null);
    vi.advanceTimersByTime(STABLE_MS * 3);
    expect(banner.variant).toBeNull();
    expect(announcements).toEqual([FAILED_RECONNECT]);
    expect(effects).toHaveLength(1);
  });

  it("stays degraded while any participant is degraded", () => {
    const { banner } = connectedBanner();
    banner.participantStatus("remote-2", "connected");
    banner.participantStatus("remote-1", "interrupted");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    expect(banner.variant).toBe("peer_reconnecting");
    banner.participantStatus("remote-2", "connected");
    vi.advanceTimersByTime(STABLE_MS * 2);
    expect(banner.variant).toBe("peer_reconnecting");
  });

  it("emits nothing on reset, and pending timers never fire afterwards", () => {
    const { banner, changes, announcements, effects } = connectedBanner();
    banner.participantStatus("remote-1", "interrupted");
    banner.reset();
    vi.advanceTimersByTime(SHOW_AFTER_MS * 5);
    expect(banner.variant).toBeNull();
    expect(changes).toEqual([]);

    banner.participantStatus("remote-1", "connected");
    banner.participantStatus("remote-1", "interrupted");
    vi.advanceTimersByTime(SHOW_AFTER_MS);
    banner.participantStatus("remote-1", "connected");
    const before = { changes: changes.length, announcements: announcements.length, effects: effects.length };
    banner.reset();
    vi.advanceTimersByTime(STABLE_MS * 5);
    expect(banner.variant).toBeNull();
    expect(changes).toHaveLength(before.changes);
    expect(announcements).toHaveLength(before.announcements);
    expect(effects).toHaveLength(before.effects);
  });

  describe("meeting service connection", () => {
    it("shows nothing for a recovery shorter than the threshold", () => {
      const { banner, changes, announcements, effects } = connectedBanner();
      banner.meetingServiceStatus("reconnecting");
      vi.advanceTimersByTime(SHOW_AFTER_MS - 1);
      banner.meetingServiceStatus("ok");
      vi.advanceTimersByTime(SHOW_AFTER_MS * 5);
      expect(banner.variant).toBeNull();
      expect(changes).toEqual([]);
      expect(announcements).toEqual([]);
      expect(effects).toEqual([]);
    });

    it("shows reconnecting once the recovery lasts the threshold, announcing and reporting once", () => {
      const { banner, changes, announcements, effects } = connectedBanner();
      banner.meetingServiceStatus("reconnecting");
      vi.advanceTimersByTime(SHOW_AFTER_MS - 1);
      expect(banner.variant).toBeNull();
      vi.advanceTimersByTime(1);
      expect(banner.variant).toBe("reconnecting");
      expect(changes).toEqual(["reconnecting"]);
      expect(announcements).toEqual([RECONNECTING]);
      expect(effects).toEqual([{ type: "failure", code: "media_interrupted" }]);
    });

    it("works without any other participant", () => {
      const { banner, changes } = createBanner();
      banner.meetingServiceStatus("reconnecting");
      vi.advanceTimersByTime(SHOW_AFTER_MS);
      expect(banner.variant).toBe("reconnecting");
      banner.meetingServiceStatus("ok");
      vi.advanceTimersByTime(STABLE_MS - 1);
      expect(banner.variant).toBe("reconnecting");
      vi.advanceTimersByTime(1);
      expect(banner.variant).toBeNull();
      expect(changes).toEqual(["reconnecting", null]);
    });

    it("clears after a stable period with one Reconnected and a recovery effect", () => {
      const { banner, changes, announcements, effects } = connectedBanner();
      banner.meetingServiceStatus("reconnecting");
      vi.advanceTimersByTime(SHOW_AFTER_MS + 500);
      banner.meetingServiceStatus("ok");
      vi.advanceTimersByTime(STABLE_MS - 1);
      expect(banner.variant).toBe("reconnecting");
      vi.advanceTimersByTime(1);
      expect(banner.variant).toBeNull();
      expect(changes).toEqual(["reconnecting", null]);
      expect(announcements).toEqual([RECONNECTING, "Reconnected"]);
      expect(effects).toEqual([
        { type: "failure", code: "media_interrupted" },
        { type: "recovery", interruptedMs: 500 + STABLE_MS },
      ]);
    });

    it("keeps one steady banner while the recovery flaps", () => {
      const { banner, changes, announcements } = connectedBanner();
      banner.meetingServiceStatus("reconnecting");
      vi.advanceTimersByTime(SHOW_AFTER_MS);
      for (let i = 0; i < 4; i += 1) {
        banner.meetingServiceStatus("ok");
        vi.advanceTimersByTime(STABLE_MS / 2);
        banner.meetingServiceStatus("reconnecting");
        vi.advanceTimersByTime(STABLE_MS / 2);
      }
      expect(changes).toEqual(["reconnecting"]);
      banner.meetingServiceStatus("ok");
      vi.advanceTimersByTime(STABLE_MS);
      expect(changes).toEqual(["reconnecting", null]);
      expect(announcements).toEqual([RECONNECTING, "Reconnected"]);
    });

    it("shows a failed recovery immediately as couldn't reconnect", () => {
      const { banner, announcements, effects } = createBanner();
      banner.meetingServiceStatus("failed");
      expect(banner.variant).toBe("failed_reconnect");
      expect(announcements).toEqual([FAILED_RECONNECT]);
      expect(effects).toEqual([{ type: "failure", code: "media_connection_failed" }]);
    });

    it("goes from reconnecting to failed with a new announcement and report", () => {
      const { banner, changes, announcements } = connectedBanner();
      banner.meetingServiceStatus("reconnecting");
      vi.advanceTimersByTime(SHOW_AFTER_MS);
      banner.meetingServiceStatus("failed");
      expect(changes).toEqual(["reconnecting", "failed_reconnect"]);
      expect(announcements).toEqual([RECONNECTING, FAILED_RECONNECT]);
    });

    it("takes precedence over healthy remote media", () => {
      const { banner } = connectedBanner();
      banner.meetingServiceStatus("failed");
      banner.participantStatus("remote-1", "connected");
      expect(banner.variant).toBe("failed_reconnect");
    });

    it("stays up while remote media is still degraded after the meeting service recovers", () => {
      const { banner } = connectedBanner();
      banner.meetingServiceStatus("reconnecting");
      banner.participantStatus("remote-1", "interrupted");
      vi.advanceTimersByTime(SHOW_AFTER_MS);
      expect(banner.variant).toBe("reconnecting");
      banner.meetingServiceStatus("ok");
      vi.advanceTimersByTime(STABLE_MS * 3);
      expect(banner.variant).toBe("peer_reconnecting");
    });

    it("shows the offline variant while the browser is offline", () => {
      const { banner } = connectedBanner();
      banner.meetingServiceStatus("reconnecting");
      banner.network(false);
      vi.advanceTimersByTime(SHOW_AFTER_MS);
      expect(banner.variant).toBe("reconnecting_offline");
    });

    it("forgets the status on reset, and pending timers never fire afterwards", () => {
      const { banner, changes } = connectedBanner();
      banner.meetingServiceStatus("reconnecting");
      banner.reset();
      vi.advanceTimersByTime(SHOW_AFTER_MS * 5);
      expect(banner.variant).toBeNull();
      expect(changes).toEqual([]);
      banner.participantStatus("remote-1", "interrupted");
      banner.participantStatus("remote-1", "connected");
      vi.advanceTimersByTime(SHOW_AFTER_MS * 5);
      expect(changes).toEqual([]);
    });

    it("does not announce Reconnected when a participant leaves after a short blip", () => {
      const { banner, announcements } = connectedBanner();
      banner.meetingServiceStatus("reconnecting");
      banner.meetingServiceStatus("ok");
      banner.participantStatus("remote-1", "interrupted");
      vi.advanceTimersByTime(SHOW_AFTER_MS);
      banner.participantGone("remote-1");
      vi.advanceTimersByTime(STABLE_MS * 3);
      expect(banner.variant).toBeNull();
      expect(announcements).toEqual([PEER_RECONNECTING]);
    });
  });
});
