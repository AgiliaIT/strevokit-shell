import type { ReactiveController, ReactiveControllerHost } from "lit";
import { EMPTY_SNAPSHOT, type MeetingSnapshot, type MeetingStore } from "./meetingStore.js";

/**
 * Keeps a Lit element in sync with a meeting store: subscribes while the host is connected and requests an update on
 * every snapshot change. `snapshot` is empty while there is no store.
 */
export class MeetingStoreController implements ReactiveController {
  readonly #host: ReactiveControllerHost;
  #store: MeetingStore | null = null;
  #unsubscribe: (() => void) | null = null;
  #connected = false;

  constructor(host: ReactiveControllerHost) {
    this.#host = host;
    host.addController(this);
  }

  get snapshot(): MeetingSnapshot {
    return this.#store?.getSnapshot() ?? EMPTY_SNAPSHOT;
  }

  /** Follows `store` from now on (or nothing, with `null`), and renders its current snapshot. */
  setStore(store: MeetingStore | null): void {
    if (store === this.#store) return;
    this.#detach();
    this.#store = store;
    if (this.#connected) this.#attach();
    this.#host.requestUpdate();
  }

  hostConnected(): void {
    this.#connected = true;
    this.#attach();
  }

  hostDisconnected(): void {
    this.#connected = false;
    this.#detach();
  }

  #attach(): void {
    if (!this.#store || this.#unsubscribe) return;
    this.#unsubscribe = this.#store.subscribe(() => this.#host.requestUpdate());
  }

  #detach(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }
}
