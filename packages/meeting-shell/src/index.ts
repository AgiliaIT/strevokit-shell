/**
 * A ready-made meeting UI for any web app. Importing this module defines the `<strevokit-meeting>` element; create
 * one in markup or with `mount()`, and import `@strevokit/shell/styles.css` once as well.
 *
 * @packageDocumentation
 */
import { defineOnce } from "./define.js";
import { StrevokitMeetingElement } from "./elements/strevokit-meeting.js";

defineOnce("strevokit-meeting", StrevokitMeetingElement);

export { StrevokitMeetingElement };
export { mount } from "./mount.js";
export type {
  MeetingShellAppearance,
  MeetingShellCloseReason,
  MeetingShellClosedEvent,
  MeetingShellEventMap,
  MeetingShellJoinedEvent,
  MountOptions,
  ShellHandle,
  ShellHandleEventMap,
} from "./types.js";
export type { MeetingLogger, ParticipantRole } from "@strevokit/meeting-sdk";
