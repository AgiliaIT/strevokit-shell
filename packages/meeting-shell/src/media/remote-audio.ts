import { errorName } from "./capture.js";

export interface RemoteAudioSource {
  readonly key: string;
  readonly stream: MediaStream;
}

interface Player {
  readonly stream: MediaStream;
  readonly element: HTMLAudioElement;
}

/** One speaker switch, including assignments started while it is still waiting. */
interface SinkRequest {
  readonly deviceId: string;
  readonly assignments: Promise<void>[];
}

/**
 * Plays every remote microphone stream through its own audio element. The elements are never attached to the
 * document: they have nothing to show, and keeping them out of the tree keeps them out of the accessibility tree.
 * `onBlocked` reports whether the browser refused to start playback until the user interacts with the page.
 */
export class RemoteAudio {
  readonly #players = new Map<string, Player>();
  readonly #onBlocked: (blocked: boolean) => void;
  /** The speaker chosen for this meeting, or `null` for the browser default. */
  #sinkId: string | null = null;
  /** The speaker switch in progress, or `null` once that request has settled. */
  #pending: SinkRequest | null = null;

  constructor(onBlocked: (blocked: boolean) => void) {
    this.#onBlocked = onBlocked;
  }

  /**
   * Sends meeting audio to `deviceId`. The call starts during this turn. A rejection leaves the previous speaker
   * (or the browser default) and rejects without the browser's own message.
   */
  setSink(deviceId: string): Promise<void> {
    const previous = this.#sinkId;
    const request: SinkRequest = { deviceId, assignments: [] };
    this.#pending = request;
    for (const player of [...this.#players.values()]) this.#enqueue(request, player.element);
    return this.#finish(request, previous);
  }

  /** Plays exactly the given streams: new ones start, changed ones restart, and missing ones stop. */
  sync(sources: readonly RemoteAudioSource[]): void {
    if (typeof Audio === "undefined") return;
    const wanted = new Map(sources.map((source) => [source.key, source.stream]));
    for (const [key, player] of this.#players) {
      if (wanted.get(key) !== player.stream) {
        this.#stop(player);
        this.#players.delete(key);
      }
    }
    for (const [key, stream] of wanted) {
      if (this.#players.has(key)) continue;
      const element = new Audio();
      element.autoplay = true;
      element.srcObject = stream;
      this.#players.set(key, { stream, element });
      if (this.#pending !== null) this.#enqueue(this.#pending, element);
      else if (this.#sinkId !== null) void this.#assign(element, this.#sinkId).catch(() => undefined);
      this.#play(element);
    }
  }

  /** Starts playback again; call it from a user gesture. */
  retry(): void {
    for (const player of this.#players.values()) this.#play(player.element);
  }

  /** Stops every stream. `sync()` starts them again. */
  dispose(): void {
    for (const player of this.#players.values()) this.#stop(player);
    this.#players.clear();
  }

  #play(element: HTMLAudioElement): void {
    element.play().then(
      () => {
        if (this.#owns(element)) this.#onBlocked(false);
      },
      (error: unknown) => {
        if (this.#owns(element) && errorName(error) === "NotAllowedError") this.#onBlocked(true);
      },
    );
  }

  /**
   * Waits until a pass adds no assignment. A rejection of one still in progress restores the previous speaker.
   * A newer switch leaves this request alone: success resolves, failure rejects, and neither commits nor rolls back.
   */
  async #finish(request: SinkRequest, previous: string | null): Promise<void> {
    let seen = 0;
    try {
      while (seen < request.assignments.length) {
        const batch = request.assignments.slice(seen);
        seen = request.assignments.length;
        await Promise.all(batch);
      }
    } catch {
      if (this.#pending !== request) throw new Error("Couldn't switch speakers.");
      this.#pending = null;
      await Promise.all(
        [...this.#players.values()].map((player) => this.#assign(player.element, previous ?? "").catch(() => undefined)),
      );
      throw new Error("Couldn't switch speakers.");
    }
    if (this.#pending !== request) return;
    this.#sinkId = request.deviceId;
    this.#pending = null;
  }

  /** Remembers an assignment on `request` so a rejection still fails that switch. */
  #enqueue(request: SinkRequest, element: HTMLAudioElement): void {
    const assignment = this.#assign(element, request.deviceId);
    void assignment.catch(() => undefined);
    request.assignments.push(assignment);
  }

  #assign(element: HTMLAudioElement, deviceId: string): Promise<void> {
    const setSinkId = (element as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> }).setSinkId;
    if (typeof setSinkId !== "function") return Promise.resolve();
    return setSinkId.call(element, deviceId);
  }

  #owns(element: HTMLAudioElement): boolean {
    for (const player of this.#players.values()) if (player.element === element) return true;
    return false;
  }

  #stop(player: Player): void {
    player.element.pause();
    player.element.srcObject = null;
  }
}
