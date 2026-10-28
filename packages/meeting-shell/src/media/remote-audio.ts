import { errorName } from "./capture.js";

export interface RemoteAudioSource {
  readonly key: string;
  readonly stream: MediaStream;
}

interface Player {
  readonly stream: MediaStream;
  readonly element: HTMLAudioElement;
}

/**
 * Plays every remote microphone stream through its own audio element. The elements are never attached to the
 * document: they have nothing to show, and keeping them out of the tree keeps them out of the accessibility tree.
 * `onBlocked` reports whether the browser refused to start playback until the user interacts with the page.
 */
export class RemoteAudio {
  readonly #players = new Map<string, Player>();
  readonly #onBlocked: (blocked: boolean) => void;

  constructor(onBlocked: (blocked: boolean) => void) {
    this.#onBlocked = onBlocked;
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

  #owns(element: HTMLAudioElement): boolean {
    for (const player of this.#players.values()) if (player.element === element) return true;
    return false;
  }

  #stop(player: Player): void {
    player.element.pause();
    player.element.srcObject = null;
  }
}
