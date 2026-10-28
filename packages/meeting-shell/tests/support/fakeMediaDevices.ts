export type FakeKind = "camera" | "microphone";

export class FakeTrack extends EventTarget {
  readonly id: string;
  enabled = true;
  readyState: "live" | "ended" = "live";
  stopCount = 0;

  constructor(
    readonly kind: "audio" | "video",
    readonly deviceId: string,
    readonly label: string,
  ) {
    super();
    this.id = `${kind}-track-${++FakeTrack.count}`;
  }

  static count = 0;

  getSettings(): { deviceId: string } {
    return { deviceId: this.deviceId };
  }

  stop(): void {
    this.stopCount += 1;
    this.readyState = "ended";
  }

  /** Simulates the device being unplugged. */
  end(): void {
    this.readyState = "ended";
    this.dispatchEvent(new Event("ended"));
  }
}

export class FakeStream {
  readonly id: string;
  constructor(readonly tracks: FakeTrack[]) {
    this.id = `stream-${++FakeStream.count}`;
  }

  static count = 0;

  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }

  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "video");
  }

  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === "audio");
  }
}

/** Builds a stream for tests that need one directly (for example remote media). */
export function fakeStream(kind: FakeKind | "screen", deviceId = `${kind}-remote`): MediaStream {
  return new FakeStream([new FakeTrack(kind === "microphone" ? "audio" : "video", deviceId, deviceId)]) as unknown as MediaStream;
}

interface FakeDevice {
  readonly deviceId: string;
  readonly label: string;
}

/**
 * A scripted `navigator.mediaDevices`: records every `getUserMedia` call, fails per kind with a DOMException name,
 * hides labels until a capture succeeds, and dispatches `devicechange`.
 */
export class FakeMediaDevices extends EventTarget {
  devices: Record<FakeKind, FakeDevice[]> = {
    camera: [
      { deviceId: "camera-1", label: "Front camera" },
      { deviceId: "camera-2", label: "USB camera" },
    ],
    microphone: [
      { deviceId: "mic-1", label: "Built-in microphone" },
      { deviceId: "mic-2", label: "Headset microphone" },
    ],
  };
  /** DOMException name to reject with, per kind. */
  failures: Partial<Record<FakeKind, string>> = {};
  /** The DOMException message for failures, so tests can prove it is never shown. */
  failureMessage: string | null = null;
  labelsVisible = false;
  /** When set, every request waits for it before answering, so tests can look at the screen mid-request. */
  pending: Promise<void> | null = null;
  readonly calls: MediaStreamConstraints[] = [];
  readonly tracks: FakeTrack[] = [];

  async getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    this.calls.push(constraints);
    if (this.pending) await this.pending;
    const kind: FakeKind = constraints.video ? "camera" : "microphone";
    const failure = this.failures[kind];
    if (failure) throw new DOMException(this.failureMessage ?? `${kind} failed`, failure);
    const requested = constraints.video ?? constraints.audio;
    const exact =
      typeof requested === "object" && requested !== null && typeof requested.deviceId === "object"
        ? (requested.deviceId as { exact?: string }).exact
        : undefined;
    const list = this.devices[kind];
    const device = exact === undefined ? list[0] : list.find((candidate) => candidate.deviceId === exact);
    if (!device) throw new DOMException("no such device", exact === undefined ? "NotFoundError" : "OverconstrainedError");
    this.labelsVisible = true;
    const track = new FakeTrack(kind === "camera" ? "video" : "audio", device.deviceId, device.label);
    this.tracks.push(track);
    return new FakeStream([track]) as unknown as MediaStream;
  }

  async enumerateDevices(): Promise<MediaDeviceInfo[]> {
    const entries = (kind: FakeKind): MediaDeviceInfo[] =>
      this.devices[kind].map(
        (device) =>
          ({
            deviceId: device.deviceId,
            groupId: "",
            kind: kind === "camera" ? "videoinput" : "audioinput",
            label: this.labelsVisible ? device.label : "",
            toJSON: () => ({}),
          }) as MediaDeviceInfo,
      );
    return [...entries("camera"), ...entries("microphone")];
  }

  /** Requests for one kind, in order. */
  requests(kind: FakeKind): MediaStreamConstraints[] {
    return this.calls.filter((call) => (kind === "camera" ? call.video : call.audio));
  }

  liveTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.readyState === "live");
  }

  /** Simulates plugging a device in. */
  addDevice(kind: FakeKind, device: FakeDevice): void {
    this.devices[kind] = [...this.devices[kind], device];
    this.dispatchEvent(new Event("devicechange"));
  }

  removeDevice(kind: FakeKind, deviceId: string): void {
    this.devices[kind] = this.devices[kind].filter((device) => device.deviceId !== deviceId);
    for (const track of this.tracks) if (track.deviceId === deviceId && track.readyState === "live") track.end();
    this.dispatchEvent(new Event("devicechange"));
  }
}

/** Installs `fake` as `navigator.mediaDevices`; the test setup removes it after each test. */
export function installMediaDevices(fake: FakeMediaDevices = new FakeMediaDevices()): FakeMediaDevices {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: fake });
  return fake;
}
