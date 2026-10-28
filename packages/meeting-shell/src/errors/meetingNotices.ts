import type { CatalogueCopy } from "../copy.js";

/** A repeat of the current notice within this window is merged without a new announcement. */
export const NOTICE_BURST_MS = 5000;

export interface MeetingNoticesOptions {
  /** The visible notice changed; `null` hides it. */
  readonly onChange: (copy: CatalogueCopy | null) => void;
  /** A notice became visible for the first time, or was reported again after a quiet burst window. */
  readonly shown: (code: string, copy: CatalogueCopy) => void;
  readonly now?: () => number;
}

interface Notice {
  readonly code: string;
  readonly copy: CatalogueCopy;
  lastAt: number;
  shown: boolean;
}

/**
 * The meeting's one notice slot. A new code replaces the current notice, and repeats of the same code are merged.
 * While hidden (under the connection banner) the latest notice is kept, and it is shown when the banner clears.
 */
export class MeetingNotices {
  readonly #options: MeetingNoticesOptions;
  readonly #now: () => number;
  #current: Notice | null = null;
  #hidden = false;

  constructor(options: MeetingNoticesOptions) {
    this.#options = options;
    this.#now = options.now ?? (() => Date.now());
  }

  /** The notice shown now, or `null`. */
  get visible(): CatalogueCopy | null {
    return this.#current && !this.#hidden ? this.#current.copy : null;
  }

  report(code: string, copy: CatalogueCopy): void {
    const now = this.#now();
    const current = this.#current;
    if (current && current.code === code) {
      const quiet = now - current.lastAt > NOTICE_BURST_MS;
      current.lastAt = now;
      if (quiet && current.shown && !this.#hidden) this.#options.shown(code, current.copy);
      return;
    }
    this.#current = { code, copy, lastAt: now, shown: false };
    if (!this.#hidden) this.#reveal();
  }

  setHidden(hidden: boolean): void {
    if (this.#hidden === hidden) return;
    this.#hidden = hidden;
    if (!this.#current) return;
    if (hidden) this.#options.onChange(null);
    else this.#reveal();
  }

  dismiss(): void {
    if (!this.#current) return;
    this.#current = null;
    if (!this.#hidden) this.#options.onChange(null);
  }

  /** Forgets the notice without emitting anything. */
  reset(): void {
    this.#current = null;
    this.#hidden = false;
  }

  #reveal(): void {
    const current = this.#current;
    if (!current) return;
    this.#options.onChange(current.copy);
    if (current.shown) return;
    current.shown = true;
    this.#options.shown(current.code, current.copy);
  }
}
