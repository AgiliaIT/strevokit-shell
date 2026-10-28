import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { resetDeviceChoiceMemory } from "../src/media/deviceStore.js";
import { restoreBrowser } from "./support/fakeBrowser.js";
import { cleanup } from "./support/fixture.js";

// jsdom has no media playback: resolve play() and ignore pause() so elements behave as in a browser that allows it.
Object.defineProperty(HTMLMediaElement.prototype, "play", {
  configurable: true,
  writable: true,
  value: () => Promise.resolve(),
});
Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, writable: true, value: () => {} });

afterEach(async () => {
  await cleanup();
  restoreBrowser();
  localStorage.clear();
  resetDeviceChoiceMemory();
  Reflect.deleteProperty(navigator, "mediaDevices");
});
