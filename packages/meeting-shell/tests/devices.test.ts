import { screen, within } from "@testing-library/dom";
import { LitElement, html, type TemplateResult } from "lit";
import { describe, expect, it } from "vitest";
import { defineOnce } from "../src/define.js";
import { DevicesController } from "../src/media/DevicesController.js";
import { FakeMediaDevices, installMediaDevices } from "./support/fakeMediaDevices.js";
import { createShell, joinMeeting, liveRegion, settle } from "./support/fixture.js";

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
});
