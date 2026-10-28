import { createMeetingEngine, type MeetingEngine, type MeetingEngineOptions } from "@strevokit/meeting-sdk";

/** Creates the meeting engine for one shell. Internal: tests replace it with a scripted engine. */
export type EngineFactory = (options: MeetingEngineOptions) => MeetingEngine;

let factory: EngineFactory = createMeetingEngine;

/** The factory every `<strevokit-meeting>` uses to create its engine. */
export function getEngineFactory(): EngineFactory {
  return factory;
}

/** Test hook: replaces the factory, or restores the SDK's `createMeetingEngine` when passed `null`. */
export function setEngineFactoryForTests(next: EngineFactory | null): void {
  factory = next ?? createMeetingEngine;
}
