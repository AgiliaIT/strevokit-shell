import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { diffApiReports, INPUT_TYPES } from "../scripts/apiDiff.mjs";

const REPORT = readFileSync(join(import.meta.dirname, "..", "etc", "shell.api.md"), "utf8").replace(/\r\n/g, "\n");

function edited(search: string | RegExp, replacement: string): string {
  const next = REPORT.replace(search, replacement);
  if (next === REPORT) throw new Error(`fixture edit did not apply: ${String(search)}`);
  return next;
}

describe("diffApiReports", () => {
  it("reports no change for the same report", () => {
    expect(diffApiReports(REPORT, REPORT)).toEqual({ breaking: [], additive: [] });
  });

  it("treats the types tenants construct as inputs", () => {
    expect([...INPUT_TYPES].sort()).toEqual(["MeetingLogger", "MountOptions"]);
  });

  it("treats removing an exported type as breaking", () => {
    const { breaking } = diffApiReports(REPORT, edited('export type ParticipantRole = "host" | "participant";\n', ""));
    expect(breaking).toEqual(["removed ParticipantRole"]);
  });

  it("treats removing a close reason as breaking and adding one as additive", () => {
    expect(diffApiReports(REPORT, edited('| "error";', ";")).breaking).toEqual(['removed MeetingShellCloseReason "error"']);
    expect(diffApiReports(REPORT, edited('| "error";', '| "error" | "kicked";')).additive).toEqual([
      'added MeetingShellCloseReason "kicked"',
    ]);
  });

  it("treats a new required mount() option as breaking and a new optional one as additive", () => {
    const anchor = "    readonly token: string;";
    expect(diffApiReports(REPORT, edited(anchor, `${anchor}\n    readonly room: string;`)).breaking).toEqual([
      "added required MountOptions.room",
    ]);
    expect(diffApiReports(REPORT, edited(anchor, `${anchor}\n    readonly room?: string;`))).toEqual({
      breaking: [],
      additive: ["added MountOptions.room"],
    });
  });

  it("treats removing an element property or a handle method as breaking", () => {
    expect(diffApiReports(REPORT, edited("    appearance: MeetingShellAppearance;\n", "")).breaking).toEqual([
      "removed StrevokitMeetingElement.appearance",
    ]);
    expect(diffApiReports(REPORT, edited("    destroy(): void;\n", "")).breaking).toEqual(["removed ShellHandle.destroy"]);
  });

  it("treats a new event as additive", () => {
    const anchor = '    "svk-joined": CustomEvent<MeetingShellJoinedEvent>;';
    expect(diffApiReports(REPORT, edited(anchor, `${anchor}\n    "svk-raised-hand": CustomEvent<Event>;`))).toEqual({
      breaking: [],
      additive: ['added MeetingShellEventMap."svk-raised-hand"'],
    });
  });
});
