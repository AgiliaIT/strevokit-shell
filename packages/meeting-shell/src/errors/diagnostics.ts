import type { MeetingLogger } from "@strevokit/meeting-sdk";
import type { DeviceKind } from "../copy.js";
import type { MeetingShellCloseReason } from "../types.js";

/** Where the participant saw a failure. */
export type FailureSurface = "device" | "join" | "banner" | "notice" | "final";

/** The screen the participant was on when the failure was shown. */
export type ShellPhase = "prejoin" | "joining" | "in_meeting" | "final";

/** One shown failure. Every field is an enumerable value; messages, names, IDs, and the token never go here. */
export interface FailureEntry {
  readonly surface: FailureSurface;
  readonly phase: ShellPhase;
  readonly code?: string | undefined;
  readonly kind?: DeviceKind | undefined;
  readonly retry?: boolean | undefined;
  readonly reason?: MeetingShellCloseReason | undefined;
}

type Fields = Record<string, string | number | boolean>;

const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/u;

/** `code` when it is a short lower-case identifier, otherwise `"unknown"`, so no free text reaches the logger. */
export function safeCode(code: string): string {
  return SAFE_CODE.test(code) ? code : "unknown";
}

/** A tenant logger that throws must not break the meeting UI. */
function write(logger: MeetingLogger | null | undefined, level: "warn" | "info", message: string, fields: Fields): void {
  try {
    logger?.[level]?.(message, fields);
  } catch {
    // Diagnostics are best effort.
  }
}

/** Writes one `warn` entry for a failure the shell has just shown. */
export function reportFailure(logger: MeetingLogger | null | undefined, entry: FailureEntry): void {
  const fields: Fields = { surface: entry.surface, phase: entry.phase };
  if (entry.code !== undefined) fields["code"] = safeCode(entry.code);
  if (entry.kind !== undefined) fields["kind"] = entry.kind;
  if (entry.retry !== undefined) fields["retry"] = entry.retry;
  if (entry.reason !== undefined) fields["reason"] = entry.reason;
  write(logger, "warn", "meeting shell showed a failure", fields);
}

/** Writes one `info` entry when the connection banner clears after recovery. */
export function reportRecovery(logger: MeetingLogger | null | undefined, interruptedMs: number): void {
  write(logger, "info", "meeting shell connection recovered", {
    surface: "banner",
    phase: "in_meeting",
    interruptedMs: Math.max(0, Math.round(interruptedMs)),
  });
}
