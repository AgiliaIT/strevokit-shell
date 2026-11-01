import { screen, within } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { participant } from "./support/fakeEngine.js";
import { fakeStream } from "./support/fakeMediaDevices.js";
import { createShell, joinMeeting } from "./support/fixture.js";

function tilesList(): HTMLUListElement {
  return screen.getByRole("list", { name: "Participants' video" }) as HTMLUListElement;
}

describe("room layout", () => {
  it("marks a solo tile list with data-count 1 and no spotlight layout", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await shell.settle();
    const list = tilesList();
    expect(list).toHaveAttribute("data-count", "1");
    expect(list).not.toHaveAttribute("data-layout");
  });

  it("uses the default grid while nobody is sharing", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    shell.engines.last.addParticipant(participant("remote-1", "Grace Hopper"));
    await shell.settle();
    const list = tilesList();
    expect(list).toHaveAttribute("data-count", "2");
    expect(list).not.toHaveAttribute("data-layout");
  });

  it("switches to the spotlight layout while the local user is sharing, and back when the share ends", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.setLocalMedia("screen", true, fakeStream("screen"));
    await shell.settle();
    const list = tilesList();
    expect(list).toHaveAttribute("data-layout", "spotlight");
    expect(within(list).getByRole("listitem", { name: "Ada Lovelace (You), Shared screen" })).toBeInTheDocument();
    expect(within(list).getByRole("listitem", { name: "Ada Lovelace (You)" })).toBeInTheDocument();

    engine.setLocalMedia("screen", false, null);
    await shell.settle();
    expect(list).not.toHaveAttribute("data-layout");
    expect(within(list).queryByRole("listitem", { name: /Shared screen/u })).toBeNull();
  });

  it("switches to the spotlight layout while a remote participant is sharing, and back when it clears", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace Hopper"));
    engine.setRemoteMedia("remote-1", "camera", true, fakeStream("camera"));
    engine.setRemoteMedia("remote-1", "screen", true, fakeStream("screen"));
    await shell.settle();
    const list = tilesList();
    expect(list).toHaveAttribute("data-layout", "spotlight");
    expect(within(list).getByRole("listitem", { name: "Grace Hopper, Shared screen" })).toBeInTheDocument();
    expect(within(list).getByRole("listitem", { name: "Grace Hopper" })).toBeInTheDocument();

    engine.setRemoteMedia("remote-1", "screen", false, null);
    await shell.settle();
    expect(list).not.toHaveAttribute("data-layout");
    expect(within(list).queryByRole("listitem", { name: /Shared screen/u })).toBeNull();
  });
});
