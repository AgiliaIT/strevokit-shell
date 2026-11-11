import type { MediaConnectionStatus } from "@strevokit/meeting-sdk";
import { ANNOUNCEMENTS, CONNECTION_BANNER, shownText, type BannerVariant } from "../copy.js";

/** How long audio and video must stay degraded before the banner appears. */
export const SHOW_AFTER_MS = 1000;
/** How long the connection must stay healthy before the banner clears. */
export const STABLE_MS = 1000;

/** The diagnostics code for a banner the participant has just seen. */
export type BannerFailureCode = "media_interrupted" | "browser_offline" | "media_connection_failed";

/** A one-shot effect for diagnostics: a banner was shown, or it cleared after recovery. */
export type BannerEffect =
  | { readonly type: "failure"; readonly code: BannerFailureCode }
  | { readonly type: "recovery"; readonly interruptedMs: number };

export interface ConnectionBannerOptions {
  /** The banner to show changed; `null` hides it. */
  readonly onChange: (variant: BannerVariant | null) => void;
  /** Text to read out politely. */
  readonly announce: (text: string) => void;
  readonly report: (effect: BannerEffect) => void;
  readonly setTimeout?: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout?: (handle: unknown) => void;
  readonly now?: () => number;
}

interface ParticipantRecord {
  status: MediaConnectionStatus;
  everConnected: boolean;
}

type Health =
  | { readonly kind: "failed" | "degraded"; readonly variant: BannerVariant }
  | { readonly kind: "connected" | "none" };

type State = "hidden" | "pending" | "reconnecting" | "failed" | "recovering";

/** The participant's own connection to the meeting service: healthy, being restored, or given up on. */
export type MeetingServiceStatus = "ok" | "reconnecting" | "failed";

function isFailed(variant: BannerVariant): boolean {
  return variant === "failed_reconnect" || variant === "failed_connect";
}

function failureCode(variant: BannerVariant): BannerFailureCode {
  if (isFailed(variant)) return "media_connection_failed";
  return variant === "reconnecting_offline" ? "browser_offline" : "media_interrupted";
}

/** Meeting-service recovery and offline are one family; flapping between them stays quiet. */
function isMeetingReconnectFamily(variant: BannerVariant): boolean {
  return variant === "reconnecting" || variant === "reconnecting_offline";
}

/**
 * Decides whether the "Connection lost" banner is shown, from each other participant's audio and video connection
 * and the browser's network status. Short interruptions are never shown, a failure is shown at once, and the banner
 * clears only once the connection has stayed healthy for a moment, so a flapping connection keeps one steady banner.
 */
export class ConnectionBanner {
  readonly #options: ConnectionBannerOptions;
  readonly #setTimeout: (callback: () => void, ms: number) => unknown;
  readonly #clearTimeout: (handle: unknown) => void;
  readonly #now: () => number;
  readonly #records = new Map<string, ParticipantRecord>();
  #offline = false;
  #meetingService: MeetingServiceStatus = "ok";
  /** Whether the meeting service connection has been unhealthy since the banner last cleared. */
  #meetingServiceDisrupted = false;
  #state: State = "hidden";
  #variant: BannerVariant | null = null;
  #shownAt = 0;
  #timer: unknown = null;

  constructor(options: ConnectionBannerOptions) {
    this.#options = options;
    this.#setTimeout = options.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
    this.#clearTimeout =
      options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>));
    this.#now = options.now ?? (() => Date.now());
  }

  /** The banner shown now, or `null`. */
  get variant(): BannerVariant | null {
    return this.#variant;
  }

  /** A participant's audio and video connection changed; `null` means there is no connection any more. */
  participantStatus(id: string, status: MediaConnectionStatus | null): void {
    if (status === null) {
      this.#records.delete(id);
    } else {
      const record = this.#records.get(id) ?? { status, everConnected: false };
      record.status = status;
      if (status === "connected") record.everConnected = true;
      this.#records.set(id, record);
    }
    this.#evaluate();
  }

  participantGone(id: string): void {
    this.#records.delete(id);
    this.#evaluate();
  }

  network(online: boolean): void {
    this.#offline = !online;
    this.#evaluate();
  }

  /**
   * The participant's own connection to the meeting service changed. Being restored counts as an interruption, giving
   * up counts as a failure, and `"ok"` withdraws both; the banner then clears once everything has stayed healthy.
   */
  meetingServiceStatus(status: MeetingServiceStatus): void {
    this.#meetingService = status;
    if (status !== "ok") this.#meetingServiceDisrupted = true;
    this.#evaluate();
  }

  /** Forgets everything and hides the banner, without emitting anything. */
  reset(): void {
    this.#stopTimer();
    this.#records.clear();
    this.#offline = false;
    this.#meetingService = "ok";
    this.#meetingServiceDisrupted = false;
    this.#state = "hidden";
    this.#variant = null;
  }

  #health(): Health {
    let failed: ParticipantRecord | null = null;
    let peerDegraded = false;
    // A restored meeting service connection counts as healthy, so the banner waits out the stable period.
    let connected = this.#meetingServiceDisrupted && this.#meetingService === "ok";
    for (const record of this.#records.values()) {
      if (record.status === "failed" && (failed === null || record.everConnected)) failed = record;
      if (record.status === "interrupted" || (record.status === "connecting" && record.everConnected)) {
        peerDegraded = true;
      }
      if (record.status === "connected") connected = true;
    }
    if (this.#meetingService === "failed") return { kind: "failed", variant: "failed_reconnect" };
    if (failed) return { kind: "failed", variant: failed.everConnected ? "failed_reconnect" : "failed_connect" };
    // Local causes first: offline, then this client's meeting-service recovery, then peer media only.
    if (this.#offline) return { kind: "degraded", variant: "reconnecting_offline" };
    if (this.#meetingService === "reconnecting") return { kind: "degraded", variant: "reconnecting" };
    if (peerDegraded) return { kind: "degraded", variant: "peer_reconnecting" };
    return { kind: connected ? "connected" : "none" };
  }

  #evaluate(): void {
    const health = this.#health();
    switch (health.kind) {
      case "failed":
        this.#stopTimer();
        this.#state = "failed";
        this.#show(health.variant);
        return;
      case "degraded":
        if (this.#state === "hidden") {
          this.#state = "pending";
          this.#startTimer(SHOW_AFTER_MS, this.#showAfterDelay);
        } else if (this.#state !== "pending") {
          this.#stopTimer();
          this.#state = "reconnecting";
          this.#show(health.variant);
        }
        return;
      case "connected":
        if (this.#state === "pending") {
          this.#stopTimer();
          this.#state = "hidden";
          this.#meetingServiceDisrupted = false;
        } else if (this.#state === "reconnecting" || this.#state === "failed") {
          this.#state = "recovering";
          this.#startTimer(STABLE_MS, this.#clearAfterRecovery);
        }
        return;
      case "none":
        this.#stopTimer();
        this.#state = "hidden";
        this.#meetingServiceDisrupted = false;
        this.#setVariant(null);
        return;
    }
  }

  #showAfterDelay = (): void => {
    this.#timer = null;
    const health = this.#health();
    if (health.kind !== "degraded") return;
    this.#state = "reconnecting";
    this.#show(health.variant);
  };

  #clearAfterRecovery = (): void => {
    this.#timer = null;
    const interruptedMs = this.#now() - this.#shownAt;
    this.#state = "hidden";
    this.#meetingServiceDisrupted = false;
    this.#options.announce(ANNOUNCEMENTS.reconnected);
    this.#options.report({ type: "recovery", interruptedMs });
    this.#setVariant(null);
  };

  /**
   * Shows `variant`. Announces and reports on first show and when crossing failed/degraded.
   * Distinct degraded variants (for example meeting-service vs audio/video) are announced; meeting-service
   * ↔ offline stays quiet. Diagnostics report again only when the failure code changes.
   */
  #show(variant: BannerVariant): void {
    const previous = this.#variant;
    if (previous === variant) return;
    if (previous === null) this.#shownAt = this.#now();
    this.#setVariant(variant);
    if (previous !== null && isFailed(previous) === isFailed(variant)) {
      if (isFailed(variant)) return;
      if (isMeetingReconnectFamily(previous) && isMeetingReconnectFamily(variant)) return;
      this.#options.announce(shownText(CONNECTION_BANNER[variant]));
      if (failureCode(previous) !== failureCode(variant)) {
        this.#options.report({ type: "failure", code: failureCode(variant) });
      }
      return;
    }
    this.#options.announce(shownText(CONNECTION_BANNER[variant]));
    this.#options.report({ type: "failure", code: failureCode(variant) });
  }

  #setVariant(variant: BannerVariant | null): void {
    if (this.#variant === variant) return;
    this.#variant = variant;
    this.#options.onChange(variant);
  }

  #startTimer(ms: number, callback: () => void): void {
    this.#stopTimer();
    this.#timer = this.#setTimeout(callback, ms);
  }

  #stopTimer(): void {
    if (this.#timer === null) return;
    this.#clearTimeout(this.#timer);
    this.#timer = null;
  }
}
