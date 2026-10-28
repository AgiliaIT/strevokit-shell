import { screen, within } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { SvkVideoTile, initials } from "../src/elements/svk-video-tile.js";
import type { ParticipantView } from "../src/engine/meetingStore.js";
import { participant } from "./support/fakeEngine.js";
import { fakeStream } from "./support/fakeMediaDevices.js";
import { createShell, joinMeeting } from "./support/fixture.js";

function view(overrides: Partial<ParticipantView> = {}): ParticipantView {
  return {
    key: "participant-id-7f3a",
    isSelf: false,
    name: "Grace Hopper",
    role: "participant",
    connection: "connected",
    microphoneOn: true,
    cameraOn: true,
    cameraStream: fakeStream("camera"),
    screenOn: false,
    screenStream: null,
    audioStream: null,
    ...overrides,
  };
}

/** Renders one tile inside a list, inside a shell-styled element, as the room does. */
async function renderTile(participantView: ParticipantView, variant: "camera" | "screen" = "camera"): Promise<SvkVideoTile> {
  const list = document.createElement("ul");
  const tile = document.createElement("svk-video-tile") as SvkVideoTile;
  expect(tile).toBeInstanceOf(SvkVideoTile);
  tile.participant = participantView;
  tile.variant = variant;
  list.append(tile);
  document.body.append(list);
  await tile.updateComplete;
  return tile;
}

describe("video tile", () => {
  it("plays the camera stream in a muted video, mirroring the self view only", async () => {
    const self = await renderTile(view({ isSelf: true }));
    const selfVideo = self.querySelector("video");
    expect(selfVideo).toHaveClass("svk-mirrored");
    expect(selfVideo?.muted).toBe(true);
    expect(selfVideo?.srcObject).toBe(self.participant?.cameraStream);
    self.remove();
    const remote = await renderTile(view());
    expect(remote.querySelector("video")).not.toHaveClass("svk-mirrored");
  });

  it("is a list item named after the participant, with (You) for self", async () => {
    await renderTile(view({ isSelf: true, name: "Ada Lovelace" }));
    const tile = screen.getByRole("listitem", { name: "Ada Lovelace (You)" });
    expect(within(tile).getByText("Ada Lovelace (You)")).toBeInTheDocument();
  });

  it("shows initials and the full name while the camera is off", async () => {
    const tile = await renderTile(view({ cameraOn: false, cameraStream: null }));
    expect(tile.querySelector("video")).toBeNull();
    const item = screen.getByRole("listitem", { name: "Grace Hopper" });
    expect(within(item).getByText("GH")).toHaveAttribute("aria-hidden", "true");
    expect(within(item).getByText("Grace Hopper")).toBeInTheDocument();
  });

  it("shows the placeholder when the camera is on but its stream hasn't arrived", async () => {
    const tile = await renderTile(view({ cameraOn: true, cameraStream: null }));
    expect(tile.querySelector("video")).toBeNull();
    expect(within(tile).getByText("GH")).toBeInTheDocument();
  });

  it("swaps the video for the placeholder and back as the camera changes", async () => {
    const tile = await renderTile(view());
    tile.participant = view({ cameraOn: false, cameraStream: null });
    await tile.updateComplete;
    expect(tile.querySelector("video")).toBeNull();
    const stream = fakeStream("camera", "camera-2");
    tile.participant = view({ cameraStream: stream });
    await tile.updateComplete;
    expect(tile.querySelector("video")?.srcObject).toBe(stream);
  });

  it("marks a muted microphone with hidden text", async () => {
    const tile = await renderTile(view({ microphoneOn: false }));
    expect(within(tile).getByText("microphone off")).toHaveClass("svk-visually-hidden");
    tile.participant = view({ microphoneOn: true });
    await tile.updateComplete;
    expect(within(tile).queryByText("microphone off")).toBeNull();
  });

  it("overlays a remote tile while its connection is not up", async () => {
    const tile = await renderTile(view({ connection: "connecting" }));
    expect(tile).toHaveAttribute("data-connection", "connecting");
    expect(within(tile).getByText("Connecting…").closest(".svk-tile-overlay")).not.toBeNull();
    expect(tile.querySelector(".svk-tile-overlay svg")).toBeNull();

    tile.participant = view({ connection: "interrupted" });
    await tile.updateComplete;
    expect(tile).toHaveAttribute("data-connection", "interrupted");
    expect(within(tile).getByText("Connection interrupted").closest(".svk-tile-overlay")).not.toBeNull();
    expect(tile.querySelector(".svk-tile-overlay svg")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("listitem", { name: "Grace Hopper" })).toBe(tile);

    tile.participant = view({ connection: "connected" });
    await tile.updateComplete;
    expect(tile.querySelector(".svk-tile-overlay")).toBeNull();
  });

  it("never overlays the self view", async () => {
    const tile = await renderTile(view({ isSelf: true, name: "Ada Lovelace", connection: "interrupted" }));
    expect(tile.querySelector(".svk-tile-overlay")).toBeNull();
  });

  it("shows the overlay on a remote tile in the room", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    shell.engines.last.addParticipant(participant("remote-1", "Grace Hopper"));
    shell.engines.last.setConnection("remote-1", "interrupted");
    await shell.settle();
    const tile = screen.getByRole("listitem", { name: "Grace Hopper" });
    expect(within(tile).getByText("Connection interrupted")).toBeInTheDocument();
  });

  it("never renders participant IDs", async () => {
    const tile = await renderTile(view());
    expect(tile.outerHTML).not.toContain("participant-id-7f3a");
  });

  it("builds initials from the first and last words", () => {
    expect(initials("ada")).toBe("A");
    expect(initials("Ada King Lovelace")).toBe("AL");
    expect(initials("  ")).toBe("");
  });

  it("shows Guest for a participant without a name, and lists self first", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    shell.engines.last.addParticipant(participant("remote-1", "   "));
    await shell.settle();
    const tiles = within(screen.getByRole("list", { name: "Participants' video" })).getAllByRole("listitem");
    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual(["Ada Lovelace (You)", "Guest"]);
    expect(document.body.innerHTML).not.toContain("remote-1");
    expect(document.body.innerHTML).not.toContain("self-id-1");
  });

  describe("shared screen", () => {
    it("is a list item named after the participant and Shared screen, with the share unmirrored", async () => {
      const screenStream = fakeStream("screen");
      const tile = await renderTile(view({ screenOn: true, screenStream }), "screen");
      expect(screen.getByRole("listitem", { name: "Grace Hopper, Shared screen" })).toBe(tile);
      expect(tile).toHaveAttribute("data-variant", "screen");
      const video = tile.querySelector("video");
      expect(video?.srcObject).toBe(screenStream);
      expect(video).not.toHaveClass("svk-mirrored");
      expect(video?.muted).toBe(true);
      expect(within(tile).getByText("Grace Hopper")).toBeInTheDocument();
      expect(within(tile).getByText("Shared screen")).toBeInTheDocument();
    });

    it("never mirrors the self share, while the self camera stays mirrored", async () => {
      const self = view({ isSelf: true, name: "Ada Lovelace", screenOn: true, screenStream: fakeStream("screen") });
      const camera = await renderTile(self);
      const share = await renderTile(self, "screen");
      expect(camera.querySelector("video")).toHaveClass("svk-mirrored");
      expect(share.querySelector("video")).not.toHaveClass("svk-mirrored");
      expect(screen.getByRole("listitem", { name: "Ada Lovelace (You), Shared screen" })).toBe(share);
    });

    it("is distinguishable from the camera tile of the same participant", async () => {
      const participantView = view({ screenOn: true, screenStream: fakeStream("screen") });
      const camera = await renderTile(participantView);
      const share = await renderTile(participantView, "screen");
      expect(camera.getAttribute("aria-label")).toBe("Grace Hopper");
      expect(share.getAttribute("aria-label")).toBe("Grace Hopper, Shared screen");
      expect(camera).toHaveAttribute("data-variant", "camera");
      expect(share).toHaveAttribute("data-variant", "screen");
      expect(within(camera).queryByText("Shared screen")).toBeNull();
    });

    it("shows no overlay or microphone badge on the shared screen tile", async () => {
      const tile = await renderTile(
        view({ connection: "interrupted", microphoneOn: false, screenStream: fakeStream("screen") }),
        "screen",
      );
      expect(tile.querySelector(".svk-tile-overlay")).toBeNull();
      expect(within(tile).queryByText("microphone off")).toBeNull();
    });

    it("renders nothing while there is no screen stream", async () => {
      const tile = await renderTile(view(), "screen");
      expect(tile.querySelector("video")).toBeNull();
    });

    it("adds a Shared screen tile next to the camera tile in the room, and removes it when the share ends", async () => {
      const shell = await createShell();
      await joinMeeting(shell);
      const engine = shell.engines.last;
      engine.setLocalMedia("screen", true);
      await shell.settle();
      const tiles = within(screen.getByRole("list", { name: "Participants' video" })).getAllByRole("listitem");
      expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toEqual([
        "Ada Lovelace (You)",
        "Ada Lovelace (You), Shared screen",
      ]);
      expect(tiles[0]?.querySelector("video")).toHaveClass("svk-mirrored");
      expect(tiles[1]?.querySelector("video")).not.toHaveClass("svk-mirrored");

      engine.setLocalMedia("screen", false);
      await shell.settle();
      expect(screen.queryByRole("listitem", { name: /Shared screen/u })).toBeNull();
      expect(screen.getByRole("listitem", { name: "Ada Lovelace (You)" })).toBeInTheDocument();
    });

    it("shows a remote participant's share as its own tile while their camera tile stays", async () => {
      const shell = await createShell();
      await joinMeeting(shell);
      const engine = shell.engines.last;
      engine.addParticipant(participant("remote-1", "Grace Hopper"));
      engine.setRemoteMedia("remote-1", "camera", true, fakeStream("camera"));
      engine.setRemoteMedia("remote-1", "screen", true, fakeStream("screen"));
      await shell.settle();
      expect(screen.getByRole("listitem", { name: "Grace Hopper" })).toBeInTheDocument();
      const share = screen.getByRole("listitem", { name: "Grace Hopper, Shared screen" });
      expect(share.querySelector("video")).not.toHaveClass("svk-mirrored");

      engine.setRemoteMedia("remote-1", "screen", false, null);
      await shell.settle();
      expect(screen.queryByRole("listitem", { name: "Grace Hopper, Shared screen" })).toBeNull();
      expect(screen.getByRole("listitem", { name: "Grace Hopper" })).toBeInTheDocument();
    });
  });
});
