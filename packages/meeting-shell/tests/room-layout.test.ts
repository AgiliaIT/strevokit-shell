import { screen, within } from "@testing-library/dom";
import { describe, expect, it } from "vitest";
import { participant } from "./support/fakeEngine.js";
import { fakeStream } from "./support/fakeMediaDevices.js";
import { createShell, joinMeeting } from "./support/fixture.js";

function tilesList(): HTMLUListElement {
  return screen.getByRole("list", { name: "Participants' video" }) as HTMLUListElement;
}

function tileNames(): string[] {
  return within(tilesList())
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label") ?? "");
}

function cameraNames(): string[] {
  return tileNames().filter((name) => !name.includes("Shared screen"));
}

function participantsButton(): HTMLElement {
  return screen.getByRole("button", { name: /^Participants \(\d+\)$/u });
}

describe("room layout", () => {
  it("marks a solo tile list with data-count 1 and no share layout", async () => {
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

  it("gives the stage to the local share and restores the camera tile when the share ends", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.setLocalMedia("screen", true, fakeStream("screen"));
    await shell.settle();
    const list = tilesList();
    expect(list).toHaveAttribute("data-layout", "share");
    expect(list).not.toHaveAttribute("data-count");
    expect(tileNames()).toEqual(["Ada Lovelace (You), Shared screen"]);
    expect(cameraNames()).toEqual([]);

    engine.setLocalMedia("screen", false, null);
    await shell.settle();
    expect(list).not.toHaveAttribute("data-layout");
    expect(list).toHaveAttribute("data-count", "1");
    expect(within(list).queryByRole("listitem", { name: /Shared screen/u })).toBeNull();
    expect(tileNames()).toEqual(["Ada Lovelace (You)"]);
  });

  it("gives the stage to a remote share and restores both camera tiles when it clears", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace Hopper"));
    engine.setRemoteMedia("remote-1", "camera", true, fakeStream("camera"));
    engine.setRemoteMedia("remote-1", "screen", true, fakeStream("screen"));
    await shell.settle();
    const list = tilesList();
    expect(list).toHaveAttribute("data-layout", "share");
    expect(list).not.toHaveAttribute("data-count");
    expect(tileNames()).toEqual(["Grace Hopper, Shared screen"]);
    expect(cameraNames()).toEqual([]);

    engine.setRemoteMedia("remote-1", "screen", false, null);
    await shell.settle();
    expect(list).not.toHaveAttribute("data-layout");
    expect(list).toHaveAttribute("data-count", "2");
    expect(within(list).queryByRole("listitem", { name: /Shared screen/u })).toBeNull();
    expect(tileNames()).toEqual(["Ada Lovelace (You)", "Grace Hopper"]);
  });

  it("leaves an open participants panel open when a share starts", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const trigger = participantsButton();
    await shell.user.click(trigger);
    await shell.settle();
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    shell.engines.last.setLocalMedia("screen", true, fakeStream("screen"));
    await shell.settle();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(tilesList()).toHaveAttribute("data-layout", "share");
    expect(cameraNames()).toEqual([]);
  });

  it("does not open a closed participants panel when a share starts", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const trigger = participantsButton();
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    shell.engines.last.setLocalMedia("screen", true, fakeStream("screen"));
    await shell.settle();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(tilesList()).toHaveAttribute("data-layout", "share");
  });

  it("marks three or more people with data-count many and keeps a cell when a camera is off", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.addParticipant(participant("remote-1", "Grace Hopper"));
    engine.addParticipant(participant("remote-2", "Linus"));
    await shell.settle();
    const list = tilesList();
    expect(list).toHaveAttribute("data-count", "many");
    expect(list).not.toHaveAttribute("data-layout");
    expect(cameraNames()).toEqual(["Ada Lovelace (You)", "Grace Hopper", "Linus"]);

    engine.setLocalMedia("camera", false);
    await shell.settle();
    expect(list).toHaveAttribute("data-count", "many");
    expect(list).not.toHaveAttribute("data-layout");
    expect(cameraNames()).toEqual(["Ada Lovelace (You)", "Grace Hopper", "Linus"]);
    const self = within(list).getByRole("listitem", { name: "Ada Lovelace (You)" });
    expect(self.querySelector(".svk-avatar")).not.toBeNull();
    expect(self.querySelector("video")).toBeNull();

    for (let index = 3; index <= 10; index += 1) {
      engine.addParticipant(participant(`remote-${index}`, `Person ${index}`));
    }
    await shell.settle();
    expect(list).toHaveAttribute("data-count", "many");
    expect(list).not.toHaveAttribute("data-layout");
    expect(within(list).getAllByRole("listitem")).toHaveLength(11);

    engine.setLocalMedia("screen", true, fakeStream("screen"));
    await shell.settle();
    expect(list).toHaveAttribute("data-layout", "share");
    expect(list).not.toHaveAttribute("data-count");
    expect(cameraNames()).toEqual([]);
  });

  it("keeps the control bar outside the stage and the layout row", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await shell.settle();
    const room = shell.element.querySelector(".svk-room");
    const layout = shell.element.querySelector(".svk-layout");
    const stage = shell.element.querySelector(".svk-stage");
    const bar = shell.element.querySelector("svk-control-bar");
    expect(room).not.toBeNull();
    expect(layout).not.toBeNull();
    expect(stage).not.toBeNull();
    expect(bar).not.toBeNull();
    expect(layout?.contains(stage)).toBe(true);
    expect(layout?.contains(bar)).toBe(false);
    expect(stage?.contains(bar)).toBe(false);
    expect(bar?.parentElement).toBe(room);
  });

  it("does not add a camera tile when someone joins, leaves, mutes, or turns a camera off during a share", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.setLocalMedia("screen", true, fakeStream("screen"));
    await shell.settle();
    expect(cameraNames()).toEqual([]);

    engine.addParticipant(participant("remote-1", "Grace Hopper"));
    await shell.settle();
    expect(tileNames()).toEqual(["Ada Lovelace (You), Shared screen"]);
    expect(cameraNames()).toEqual([]);

    engine.setRemoteMedia("remote-1", "microphone", false);
    engine.setRemoteMedia("remote-1", "camera", false, null);
    engine.setLocalMedia("microphone", false);
    engine.setLocalMedia("camera", false);
    await shell.settle();
    expect(cameraNames()).toEqual([]);
    expect(tileNames()).toEqual(["Ada Lovelace (You), Shared screen"]);

    engine.removeParticipant("remote-1");
    await shell.settle();
    expect(cameraNames()).toEqual([]);
    expect(tileNames()).toEqual(["Ada Lovelace (You), Shared screen"]);
  });
});
