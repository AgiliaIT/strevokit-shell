import { screen, within } from "@testing-library/dom";
import { LitElement, html, type TemplateResult } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { defineOnce } from "../src/define.js";
import { DevicesController } from "../src/media/DevicesController.js";
import { participant } from "./support/fakeEngine.js";
import { fakeStream, FakeMediaDevices, installMediaDevices } from "./support/fakeMediaDevices.js";
import { createShell, joinMeeting, liveRegion, settle, type Shell } from "./support/fixture.js";

/** Lists the device labels a `DevicesController` reports. */
class DeviceNames extends LitElement {
  readonly devices = new DevicesController(this);

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected override willUpdate(): void {
    this.devices.sync(true);
  }

  protected override render(): TemplateResult {
    const { camera, microphone } = this.devices.lists;
    return html`<ul>
      ${[...camera, ...microphone].map((option) => html`<li>${option.label}</li>`)}
    </ul>`;
  }
}

defineOnce("svk-test-device-names", DeviceNames);

async function renderDeviceNames(): Promise<DeviceNames> {
  const element = document.createElement("svk-test-device-names") as DeviceNames;
  document.body.append(element);
  await settle(element);
  return element;
}

function labels(): string[] {
  return screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
}

function toolbar(): HTMLElement {
  return screen.getByRole("toolbar", { name: "Meeting controls" });
}

describe("device lists", () => {
  it("uses generic labels until permission is granted, then the real ones", async () => {
    const devices = installMediaDevices();
    const element = await renderDeviceNames();
    expect(labels()).toEqual(["Camera 1", "Camera 2", "Microphone 1", "Microphone 2"]);
    devices.labelsVisible = true;
    devices.dispatchEvent(new Event("devicechange"));
    await settle(element);
    expect(labels()).toEqual(["Front camera", "USB camera", "Built-in microphone", "Headset microphone"]);
  });

  it("refreshes on devicechange", async () => {
    const devices = installMediaDevices();
    const element = await renderDeviceNames();
    devices.removeDevice("camera", "camera-2");
    await settle(element);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("stops listening once the element leaves the page", async () => {
    const devices = installMediaDevices();
    const element = await renderDeviceNames();
    element.remove();
    await settle();
    devices.removeDevice("camera", "camera-2");
    await settle();
    expect(element.devices.lists.camera).toHaveLength(2);
  });
});

describe("pre-join device choice", () => {
  it("switches the preview to the chosen camera, stopping the old one", async () => {
    const shell = await createShell();
    const devices = shell.devices as FakeMediaDevices;
    const firstCamera = devices.tracks.find((track) => track.kind === "video");
    await shell.user.selectOptions(screen.getByRole("combobox", { name: "Camera device" }), "USB camera");
    await shell.settle();
    expect(devices.requests("camera").at(-1)).toEqual({ video: { deviceId: { exact: "camera-2" } } });
    expect(firstCamera?.readyState).toBe("ended");
    expect(devices.requests("microphone")).toHaveLength(1);
    expect(screen.getByRole("combobox", { name: "Camera device" })).toHaveValue("camera-2");
  });

  it("passes the chosen devices to the meeting after joining", async () => {
    const shell = await createShell();
    await shell.user.selectOptions(screen.getByRole("combobox", { name: "Camera device" }), "USB camera");
    await shell.user.selectOptions(screen.getByRole("combobox", { name: "Microphone device" }), "Headset microphone");
    await shell.settle();
    await joinMeeting(shell);
    expect(shell.engines.last.callsTo("enableCamera")[0]?.args).toEqual([{ deviceId: "camera-2" }]);
    expect(shell.engines.last.callsTo("unmute")[0]?.args).toEqual([{ deviceId: "mic-2" }]);
  });

  it("remembers the choice for the next visit", async () => {
    const first = await createShell();
    await first.user.selectOptions(screen.getByRole("combobox", { name: "Camera device" }), "USB camera");
    await first.settle();
    first.element.remove();
    await settle();

    const devices = new FakeMediaDevices();
    devices.labelsVisible = true;
    await createShell({ devices });
    expect(devices.requests("camera")[0]).toEqual({ video: { deviceId: { exact: "camera-2" } } });
    expect(screen.getByRole("combobox", { name: "Camera device" })).toHaveValue("camera-2");
  });

  it("finds the remembered devices by name when the browser gave them new IDs", async () => {
    const first = await createShell();
    await first.user.selectOptions(screen.getByRole("combobox", { name: "Camera device" }), "USB camera");
    await first.user.selectOptions(screen.getByRole("combobox", { name: "Microphone device" }), "Headset microphone");
    await first.settle();
    first.element.remove();
    await settle();

    const devices = new FakeMediaDevices();
    devices.labelsVisible = true;
    devices.devices.camera = devices.devices.camera.map((device) => ({ ...device, deviceId: `${device.deviceId}-new` }));
    devices.devices.microphone = devices.devices.microphone.map((device) => ({ ...device, deviceId: `${device.deviceId}-new` }));
    const shell = await createShell({ devices });
    expect(screen.getByRole("combobox", { name: "Camera device" })).toHaveValue("camera-2-new");
    expect(screen.getByRole("combobox", { name: "Microphone device" })).toHaveValue("mic-2-new");
    expect(devices.requests("camera").at(-1)).toEqual({ video: { deviceId: { exact: "camera-2-new" } } });
    await joinMeeting(shell);
    expect(shell.engines.last.callsTo("enableCamera")[0]?.args).toEqual([{ deviceId: "camera-2-new" }]);
    expect(shell.engines.last.callsTo("unmute")[0]?.args).toEqual([{ deviceId: "mic-2-new" }]);
  });

  it("falls back to the default camera when the remembered one is gone", async () => {
    const first = await createShell();
    await first.user.selectOptions(screen.getByRole("combobox", { name: "Camera device" }), "USB camera");
    await first.settle();
    first.element.remove();
    await settle();

    const devices = new FakeMediaDevices();
    devices.devices.camera = devices.devices.camera.filter((device) => device.deviceId !== "camera-2");
    const shell = await createShell({ devices });
    expect(devices.requests("camera")).toEqual([{ video: { deviceId: { exact: "camera-2" } } }, { video: true }]);
    expect(screen.getByRole("combobox", { name: "Camera device" })).toHaveValue("camera-1");
    await joinMeeting(shell);
    expect(shell.engines.last.callsTo("enableCamera")[0]?.args).toEqual([]);
  });
});

describe("in-meeting device menu", () => {
  it("lists devices as radio items and supports arrow keys and Escape", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const trigger = within(toolbar()).getByRole("button", { name: "Choose camera" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    trigger.focus();
    await shell.user.keyboard("{ArrowDown}");
    await shell.settle();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Choose camera" });
    expect(trigger).toHaveAttribute("aria-controls", menu.id);
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => [item.textContent, item.getAttribute("aria-checked")])).toEqual([
      ["Front camera", "true"],
      ["USB camera", "false"],
    ]);
    expect(items[0]).toHaveFocus();
    await shell.user.keyboard("{ArrowDown}");
    await shell.settle();
    expect(items[1]).toHaveFocus();
    await shell.user.keyboard("{ArrowDown}");
    await shell.settle();
    expect(items[0]).toHaveFocus();
    await shell.user.keyboard("{End}");
    await shell.settle();
    expect(items[1]).toHaveFocus();
    await shell.user.keyboard("{Escape}");
    await shell.settle();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(screen.getByRole("toolbar", { name: "Meeting controls" })).toBeInTheDocument();
  });

  it("switches the camera in place when it is on, and announces it", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Choose camera" }));
    await shell.settle();
    await shell.user.click(screen.getByRole("menuitemradio", { name: "USB camera" }));
    await shell.settle();
    expect(engine.callsTo("enableCamera").at(-1)?.args).toEqual([{ deviceId: "camera-2" }]);
    expect(engine.callsTo("disableCamera")).toHaveLength(0);
    expect(liveRegion()).toHaveTextContent("Switched to USB camera");
    expect(within(toolbar()).getByRole("button", { name: "Choose camera" })).toHaveFocus();

    await shell.user.click(within(toolbar()).getByRole("button", { name: "Choose camera" }));
    await shell.settle();
    expect(screen.getByRole("menuitemradio", { name: "USB camera" })).toHaveAttribute("aria-checked", "true");
  });

  it("only remembers the choice while the microphone is muted, and uses it on unmute", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Microphone" }));
    await shell.settle();
    const unmutesBefore = engine.callsTo("unmute").length;
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Choose microphone" }));
    await shell.settle();
    await shell.user.click(screen.getByRole("menuitemradio", { name: "Headset microphone" }));
    await shell.settle();
    expect(engine.callsTo("unmute")).toHaveLength(unmutesBefore);
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Microphone" }));
    await shell.settle();
    expect(engine.callsTo("unmute").at(-1)?.args).toEqual([{ deviceId: "mic-2" }]);
  });

  it("closes the menu when the pointer goes down outside it", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Choose camera" }));
    await shell.settle();
    expect(screen.getByRole("menu", { name: "Choose camera" })).toBeInTheDocument();
    await shell.user.click(screen.getByRole("list", { name: "Participants' video" }));
    await shell.settle();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("explains a disconnected camera and offers the remaining devices", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    const devices = shell.devices as FakeMediaDevices;
    devices.removeDevice("camera", "camera-1");
    engine.setLocalMedia("camera", false);
    await shell.settle();
    const room = screen.getByRole("region", { name: "Meeting" });
    expect(within(room).getByText("Your camera was disconnected. Reconnect it, then try again.")).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Your camera was disconnected. Reconnect it, then try again.");
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute(
      "aria-describedby",
      expect.stringContaining("camera-message"),
    );
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Choose camera" }));
    await shell.settle();
    expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["USB camera"]);
  });

  it("keeps the previous camera checked until the switch settles", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    const release = engine.holdNext("enableCamera");
    await pickDevice(shell, "Choose camera", "USB camera");
    expect(await checkedDevice(shell, "Choose camera")).toBe("Front camera");
    expect(liveRegion()).not.toHaveTextContent("Switched to");
    release();
    await shell.settle();
    expect(await checkedDevice(shell, "Choose camera")).toBe("USB camera");
    expect(liveRegion()).toHaveTextContent("Switched to USB camera");
  });

  it("returns to the checked camera when it is chosen again while a switch is pending", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    const before = engine.callsTo("enableCamera").length;
    const release = engine.holdNext("enableCamera");
    await pickDevice(shell, "Choose camera", "USB camera");
    expect(await checkedDevice(shell, "Choose camera")).toBe("Front camera");
    await pickDevice(shell, "Choose camera", "Front camera");
    expect(engine.callsTo("enableCamera").slice(before).map((call) => call.args[0])).toEqual([{ deviceId: "camera-2" }]);
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-busy", "true");
    release();
    await shell.settle();
    expect(engine.callsTo("enableCamera").slice(before).map((call) => call.args[0])).toEqual([
      { deviceId: "camera-2" },
      { deviceId: "camera-1" },
    ]);
    expect(await checkedDevice(shell, "Choose camera")).toBe("Front camera");
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-busy", "false");
  });

  it("keeps the checked camera when it is chosen again while reconnecting", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    const before = engine.callsTo("enableCamera").length;
    engine.startReconnecting();
    await shell.settle();
    await pickDevice(shell, "Choose camera", "USB camera");
    await pickDevice(shell, "Choose camera", "Front camera");
    engine.finishReconnecting();
    await shell.settle();
    expect(engine.callsTo("enableCamera")).toHaveLength(before);
    expect(await checkedDevice(shell, "Choose camera")).toBe("Front camera");
  });

  it("does not switch when the only listed camera is chosen", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    const devices = shell.devices as FakeMediaDevices;
    devices.devices.camera = [{ deviceId: "camera-1", label: "Front camera" }];
    const before = engine.callsTo("enableCamera").length;
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Choose camera" }));
    await shell.settle();
    await shell.user.click(screen.getByRole("menuitemradio", { name: "Front camera" }));
    await shell.settle();
    expect(engine.callsTo("enableCamera")).toHaveLength(before);
  });

  it("remembers a camera chosen while the camera is off and uses it the next time the camera turns on", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Camera" }));
    await shell.settle();
    const before = engine.callsTo("enableCamera").length;
    await pickDevice(shell, "Choose camera", "USB camera");
    expect(engine.callsTo("enableCamera")).toHaveLength(before);
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "false");
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Camera" }));
    await shell.settle();
    expect(engine.callsTo("enableCamera").at(-1)?.args).toEqual([{ deviceId: "camera-2" }]);
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the previous microphone checked until an unmuted switch settles", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    const release = engine.holdNext("unmute");
    await pickDevice(shell, "Choose microphone", "Headset microphone");
    expect(await checkedDevice(shell, "Choose microphone")).toBe("Built-in microphone");
    expect(liveRegion()).not.toHaveTextContent("Switched to");
    expect(within(toolbar()).getByRole("button", { name: "Microphone" })).toHaveAttribute("aria-pressed", "true");
    release();
    await shell.settle();
    expect(await checkedDevice(shell, "Choose microphone")).toBe("Headset microphone");
    expect(liveRegion()).toHaveTextContent("Switched to Headset microphone");
  });

  it("leaves the previous microphone checked and unmuted when the switch is rejected", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.mediaOutcomes.unmute = "device_not_found";
    await pickDevice(shell, "Choose microphone", "Headset microphone");
    expect(await checkedDevice(shell, "Choose microphone")).toBe("Built-in microphone");
    expect(within(toolbar()).getByRole("button", { name: "Microphone" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("region", { name: "Meeting" })).toHaveTextContent(
      "No microphone was found. Connect a microphone, then try again.",
    );
    expect(shell.element.textContent).not.toContain("NotFoundError");
  });

  it("leaves the previous camera checked when the switch is rejected and stays in the meeting", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    engine.mediaOutcomes.enableCamera = "device_not_found";
    await pickDevice(shell, "Choose camera", "USB camera");
    expect(await checkedDevice(shell, "Choose camera")).toBe("Front camera");
    expect(screen.getByRole("region", { name: "Meeting" })).toHaveTextContent(
      "No camera was found. Connect a camera, then try again.",
    );
    expect(shell.element.textContent).not.toContain("NotFoundError");
    expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
  });

  it("applies the later camera when two picks overlap and clears busy", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.devices.camera = [
      { deviceId: "camera-1", label: "Front camera" },
      { deviceId: "camera-2", label: "USB camera" },
      { deviceId: "camera-3", label: "Desk camera" },
    ];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    const engine = shell.engines.last;
    const release = engine.holdNext("enableCamera");
    await pickDevice(shell, "Choose camera", "USB camera");
    await pickDevice(shell, "Choose camera", "Desk camera");
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-busy", "true");
    release();
    await shell.settle();
    expect(engine.callsTo("enableCamera").slice(-2).map((call) => call.args[0])).toEqual([
      { deviceId: "camera-2" },
      { deviceId: "camera-3" },
    ]);
    expect(await checkedDevice(shell, "Choose camera")).toBe("Desk camera");
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-busy", "false");
  });

  it("clears busy when the queued camera is the one the switch just installed", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.devices.camera = [
      { deviceId: "camera-1", label: "Front camera" },
      { deviceId: "camera-2", label: "USB camera" },
      { deviceId: "camera-3", label: "Desk camera" },
    ];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    const engine = shell.engines.last;
    const before = engine.callsTo("enableCamera").length;
    const release = engine.holdNext("enableCamera");
    await pickDevice(shell, "Choose camera", "USB camera");
    await pickDevice(shell, "Choose camera", "Desk camera");
    await pickDevice(shell, "Choose camera", "USB camera");
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-busy", "true");
    release();
    await shell.settle();
    expect(engine.callsTo("enableCamera").slice(before).map((call) => call.args[0])).toEqual([{ deviceId: "camera-2" }]);
    expect(await checkedDevice(shell, "Choose camera")).toBe("USB camera");
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-busy", "false");
  });

  it("refreshes the list when a device menu opens", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.devices.camera = [{ deviceId: "camera-1", label: "Front camera" }];
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Choose camera" }));
    await shell.settle();
    expect(screen.getAllByRole("menuitemradio").map((item) => item.textContent)).toEqual(["Front camera"]);
  });

  it("checks a listed device when the live camera changes without a click", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    shell.engines.last.setLocalMedia("camera", true, fakeStream("camera", "camera-2"));
    await shell.settle();
    expect(await checkedDevice(shell, "Choose camera")).toBe("USB camera");
    expect(liveRegion()).toHaveTextContent("Switched to USB camera");
  });

  it("does not announce a live camera whose label is not listed", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    shell.engines.last.setLocalMedia("camera", true, fakeStream("camera", "camera-unknown"));
    await shell.settle();
    expect(liveRegion()).not.toHaveTextContent("Switched to");
  });

  it("waits to switch until the meeting is joined again and drops the request when the meeting ends", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    const before = engine.callsTo("enableCamera").length;
    engine.startReconnecting();
    await shell.settle();
    await pickDevice(shell, "Choose camera", "USB camera");
    expect(engine.callsTo("enableCamera")).toHaveLength(before);
    expect(shell.element.textContent).not.toMatch(/permission was denied|No camera was found|NotFoundError/u);
    engine.finishReconnecting();
    await shell.settle();
    expect(engine.callsTo("enableCamera").at(-1)?.args).toEqual([{ deviceId: "camera-2" }]);
    expect(await checkedDevice(shell, "Choose camera")).toBe("USB camera");
  });

  it("drops a switch chosen while reconnecting when the participant leaves", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const engine = shell.engines.last;
    const calls = engine.callsTo("enableCamera").length;
    engine.startReconnecting();
    await shell.settle();
    await pickDevice(shell, "Choose camera", "USB camera");
    await shell.element.leave();
    await shell.settle();
    engine.finishReconnecting();
    await shell.settle();
    expect(engine.callsTo("enableCamera")).toHaveLength(calls);
  });

  it("applies a switch chosen while reconnecting after the in-flight switch, in selection order", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.devices.camera = [
      { deviceId: "camera-1", label: "Front camera" },
      { deviceId: "camera-2", label: "USB camera" },
      { deviceId: "camera-3", label: "Desk camera" },
    ];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    const engine = shell.engines.last;
    const before = engine.callsTo("enableCamera").length;
    const release = engine.holdNext("enableCamera");
    await pickDevice(shell, "Choose camera", "USB camera");
    engine.startReconnecting();
    await shell.settle();
    await pickDevice(shell, "Choose camera", "Desk camera");
    engine.finishReconnecting();
    await shell.settle();
    expect(engine.callsTo("enableCamera").slice(before).map((call) => call.args[0])).toEqual([{ deviceId: "camera-2" }]);
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-busy", "true");
    release();
    await shell.settle();
    expect(engine.callsTo("enableCamera").slice(before).map((call) => call.args[0])).toEqual([
      { deviceId: "camera-2" },
      { deviceId: "camera-3" },
    ]);
    expect(await checkedDevice(shell, "Choose camera")).toBe("Desk camera");
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-busy", "false");
  });

  it("starts a device switch in a new meeting while the previous meeting's switch is still pending", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.devices.camera = [
      { deviceId: "camera-1", label: "Front camera" },
      { deviceId: "camera-2", label: "USB camera" },
      { deviceId: "camera-3", label: "Desk camera" },
    ];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    const first = shell.engines.last;
    const releaseFirst = first.holdNext("enableCamera");
    await pickDevice(shell, "Choose camera", "USB camera");
    shell.element.token = "next-token-test";
    await shell.settle();
    await joinMeeting(shell);
    const next = shell.engines.last;
    expect(next).not.toBe(first);
    const releaseNext = next.holdNext("enableCamera");
    const before = next.callsTo("enableCamera").length;
    await pickDevice(shell, "Choose camera", "USB camera");
    expect(next.callsTo("enableCamera").slice(before).map((call) => call.args[0])).toEqual([{ deviceId: "camera-2" }]);
    releaseFirst();
    await shell.settle();
    await pickDevice(shell, "Choose camera", "Desk camera");
    expect(next.callsTo("enableCamera").slice(before).map((call) => call.args[0])).toEqual([{ deviceId: "camera-2" }]);
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-busy", "true");
    releaseNext();
    await shell.settle();
    expect(next.callsTo("enableCamera").slice(before).map((call) => call.args[0])).toEqual([
      { deviceId: "camera-2" },
      { deviceId: "camera-3" },
    ]);
    expect(await checkedDevice(shell, "Choose camera")).toBe("Desk camera");
    expect(within(toolbar()).getByRole("button", { name: "Camera" })).toHaveAttribute("aria-busy", "false");
  });
});

describe("speaker menu", () => {
  afterEach(() => {
    delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
  });

  it("does not offer a speaker when output selection is missing", async () => {
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.outputs = [
      { deviceId: "speaker-1", label: "Speakers" },
      { deviceId: "speaker-2", label: "Headphones" },
    ];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    expect(screen.queryByRole("button", { name: "Choose speaker" })).toBeNull();
    expect(liveRegion()).not.toHaveTextContent("Switched to");
  });

  it("switches to another speaker from the click and leaves the meeting up", async () => {
    const calls = installSpeakers();
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.labelsVisible = true;
    devices.outputs = [
      { deviceId: "speaker-1", label: "Speakers" },
      { deviceId: "speaker-2", label: "Headphones" },
    ];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    const speaker = within(toolbar()).getByRole("button", { name: "Choose speaker" });
    expect(speaker).toHaveClass("svk-menu-button-labeled");
    expect(within(speaker).getByText("Speaker")).toBeInTheDocument();
    expect(speaker.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await playRemote(shell);
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Share screen" }));
    await shell.settle();
    const before = calls.length;
    await pickDevice(shell, "Choose speaker", "Headphones");
    expect(calls.slice(before)).toEqual(["speaker-2"]);
    expect(await checkedDevice(shell, "Choose speaker")).toBe("Headphones");
    await pickDevice(shell, "Choose speaker", "Headphones");
    expect(calls.slice(before)).toEqual(["speaker-2"]);
    expect(screen.getByRole("region", { name: "Meeting" })).toBeInTheDocument();
    expect(within(toolbar()).getByRole("button", { name: "Share screen" })).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the checked speaker when it is chosen again while a switch is pending", async () => {
    const held = holdSpeakers();
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.labelsVisible = true;
    devices.outputs = [
      { deviceId: "speaker-1", label: "Speakers" },
      { deviceId: "speaker-2", label: "Headphones" },
    ];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    await playRemote(shell);
    await pickDevice(shell, "Choose speaker", "Speakers");
    expect(held.calls).toEqual([]);
    await pickDevice(shell, "Choose speaker", "Headphones");
    expect(held.calls).toEqual(["speaker-2"]);
    expect(await checkedDevice(shell, "Choose speaker")).toBe("Speakers");
    await pickDevice(shell, "Choose speaker", "Speakers");
    expect(held.calls).toEqual(["speaker-2"]);
    held.release();
    await shell.settle();
    expect(held.calls).toEqual(["speaker-2", "speaker-1"]);
    expect(await checkedDevice(shell, "Choose speaker")).toBe("Speakers");
  });

  it("ignores a speaker switch that finishes after the meeting is replaced", async () => {
    const held = holdSpeakers();
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.labelsVisible = true;
    devices.outputs = [
      { deviceId: "speaker-1", label: "Speakers" },
      { deviceId: "speaker-2", label: "Headphones" },
    ];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    await playRemote(shell);
    await pickDevice(shell, "Choose speaker", "Headphones");
    expect(held.calls).toEqual(["speaker-2"]);
    shell.element.token = "next-token-test";
    await shell.settle();
    await joinMeeting(shell);
    held.release();
    await shell.settle();
    expect(await checkedDevice(shell, "Choose speaker")).toBe("Speakers");
    expect(held.calls).toEqual(["speaker-2"]);
  });

  it("does not switch when the only speaker is chosen", async () => {
    const calls = installSpeakers();
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.labelsVisible = true;
    devices.outputs = [{ deviceId: "speaker-1", label: "Speakers" }];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    await shell.user.click(within(toolbar()).getByRole("button", { name: "Choose speaker" }));
    await shell.settle();
    await shell.user.click(screen.getByRole("menuitemradio", { name: "Speakers" }));
    await shell.settle();
    expect(calls).toEqual([]);
    expect(await checkedDevice(shell, "Choose speaker")).toBe("Speakers");
  });

  it("shows speaker failure copy and keeps the previous speaker when the switch is rejected", async () => {
    const calls = installSpeakers((sinkId) =>
      sinkId === "speaker-2" ? Promise.reject(new DOMException("browser said no", "NotAllowedError")) : Promise.resolve(),
    );
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.labelsVisible = true;
    devices.outputs = [
      { deviceId: "speaker-1", label: "Speakers" },
      { deviceId: "speaker-2", label: "Headphones" },
    ];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    await playRemote(shell);
    await pickDevice(shell, "Choose speaker", "Headphones");
    expect(screen.getByRole("region", { name: "Meeting" })).toHaveTextContent("Couldn't switch speakers.");
    expect(shell.element.textContent).not.toContain("browser said no");
    expect(await checkedDevice(shell, "Choose speaker")).toBe("Speakers");
    expect(calls).toContain("speaker-2");
  });

  it("tries one other speaker when the chosen one disappears and does not keep trying", async () => {
    const calls = installSpeakers((sinkId) =>
      sinkId === "speaker-1" ? Promise.reject(new DOMException("browser said no", "NotAllowedError")) : Promise.resolve(),
    );
    const shell = await createShell();
    await joinMeeting(shell);
    const devices = shell.devices as FakeMediaDevices;
    devices.labelsVisible = true;
    devices.outputs = [
      { deviceId: "speaker-1", label: "Speakers" },
      { deviceId: "speaker-2", label: "Headphones" },
    ];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    await playRemote(shell);
    await pickDevice(shell, "Choose speaker", "Headphones");
    devices.outputs = [{ deviceId: "speaker-1", label: "Speakers" }];
    devices.dispatchEvent(new Event("devicechange"));
    await shell.settle();
    await shell.settle();
    const fallbacks = calls.filter((sinkId) => sinkId === "speaker-1");
    expect(fallbacks).toEqual(["speaker-1"]);
    expect(screen.getByRole("region", { name: "Meeting" })).toHaveTextContent("Couldn't switch speakers.");
  });
});

async function playRemote(shell: Shell): Promise<void> {
  const engine = shell.engines.last;
  engine.addParticipant(participant("remote-1", "Grace"));
  engine.setRemoteMedia("remote-1", "microphone", true, fakeStream("microphone"));
  await shell.settle();
}

function installSpeakers(result?: (sinkId: string) => Promise<void>): string[] {
  const calls: string[] = [];
  (HTMLMediaElement.prototype as { setSinkId?: (sinkId: string) => Promise<void> }).setSinkId = function (sinkId: string) {
    calls.push(sinkId);
    return result ? result(sinkId) : Promise.resolve();
  };
  return calls;
}

/** Holds the first speaker change and lets every later change finish immediately. */
function holdSpeakers(): { calls: string[]; release: () => void } {
  let release = (): void => undefined;
  let holding = true;
  const calls = installSpeakers(
    () =>
      new Promise((resolve) => {
        if (!holding) {
          resolve();
          return;
        }
        holding = false;
        release = resolve;
      }),
  );
  return { calls, release: () => release() };
}

async function pickDevice(shell: Shell, menu: string, name: string): Promise<void> {
  await shell.user.click(within(toolbar()).getByRole("button", { name: menu }));
  await shell.settle();
  await shell.user.click(screen.getByRole("menuitemradio", { name }));
  await shell.settle();
}

async function checkedDevice(shell: Shell, menu: string): Promise<string> {
  await shell.user.click(within(toolbar()).getByRole("button", { name: menu }));
  await shell.settle();
  const checked = within(screen.getByRole("menu", { name: menu }))
    .getAllByRole("menuitemradio")
    .find((item) => item.getAttribute("aria-checked") === "true");
  const label = checked?.textContent ?? "";
  await shell.user.keyboard("{Escape}");
  await shell.settle();
  return label;
}
