import type { ReactiveController, ReactiveControllerHost } from "lit";
import { mediaDevices } from "./capture.js";
import { NO_DEVICES, deviceOptions, sameDeviceOptions, type DeviceLists } from "./deviceStore.js";

/**
 * The cameras and microphones available now. Listing starts once `sync(true)` is called while the host is in the
 * page, and is refreshed on `devicechange` and on `refresh()` (call it once permission is granted, so real labels
 * replace the generic ones).
 */
export class DevicesController implements ReactiveController {
  readonly #host: ReactiveControllerHost & HTMLElement;
  #lists: DeviceLists = NO_DEVICES;
  #devices: MediaDevices | null = null;
  /** Bumped on every refresh and on stop, so only the latest listing is applied. */
  #run = 0;

  constructor(host: ReactiveControllerHost & HTMLElement) {
    this.#host = host;
    host.addController(this);
  }

  get lists(): DeviceLists {
    return this.#lists;
  }

  /** Starts listing devices when `active` and the host is in the page; stops otherwise. */
  sync(active: boolean): void {
    if (active && this.#host.isConnected) this.#start();
    else this.#stop();
  }

  /** Lists the devices again. */
  refresh = (): void => {
    const devices = this.#devices;
    if (!devices) return;
    const run = (this.#run += 1);
    devices.enumerateDevices().then(
      (found) => {
        if (run !== this.#run) return;
        const next = { camera: deviceOptions(found, "camera"), microphone: deviceOptions(found, "microphone") };
        const previous = this.#lists;
        if (sameDeviceOptions(previous.camera, next.camera) && sameDeviceOptions(previous.microphone, next.microphone)) {
          return;
        }
        this.#lists = next;
        this.#host.requestUpdate();
      },
      () => {},
    );
  };

  hostDisconnected(): void {
    this.#stop();
  }

  #start(): void {
    if (this.#devices) return;
    const devices = mediaDevices();
    if (!devices || typeof devices.enumerateDevices !== "function") return;
    this.#devices = devices;
    devices.addEventListener("devicechange", this.refresh);
    this.refresh();
  }

  #stop(): void {
    this.#run += 1;
    this.#devices?.removeEventListener("devicechange", this.refresh);
    this.#devices = null;
  }
}
