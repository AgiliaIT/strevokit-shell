import { screen } from "@testing-library/dom";
import { describe, expect, it, vi } from "vitest";
import { TOKEN, createShell, joinMeeting } from "./support/fixture.js";

function attributeValues(): string[] {
  return [...document.querySelectorAll("*")].flatMap((element) =>
    [...element.attributes].map((attribute) => `${attribute.name}=${attribute.value}`),
  );
}

describe("embedding", () => {
  describe("appearance", () => {
    it("follows the system appearance by default", async () => {
      const shell = await createShell();
      expect(shell.element.appearance).toBe("system");
      expect(shell.element).toHaveAttribute("data-svk-appearance", "system");
    });

    it("reflects the property to the appearance attribute and data-svk-appearance", async () => {
      const shell = await createShell();
      shell.element.appearance = "dark";
      await shell.settle();
      expect(shell.element).toHaveAttribute("appearance", "dark");
      expect(shell.element).toHaveAttribute("data-svk-appearance", "dark");
    });

    it("reads the appearance attribute from markup", async () => {
      const shell = await createShell();
      shell.element.setAttribute("appearance", "light");
      await shell.settle();
      expect(shell.element.appearance).toBe("light");
      expect(shell.element).toHaveAttribute("data-svk-appearance", "light");
    });

    it("falls back to system for an unknown appearance", async () => {
      const shell = await createShell({ appearance: "dark" });
      shell.element.setAttribute("appearance", "sepia");
      await shell.settle();
      expect(shell.element).toHaveAttribute("data-svk-appearance", "system");
    });
  });

  it("never exposes the token in the page, attributes, storage, events, or logs", async () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const shell = await createShell({
      engine: (engine) => engine.options.logger?.info?.("engine created", { state: "idle" }),
      token: null,
    });
    shell.element.logger = logger;
    shell.element.token = TOKEN;
    await shell.settle();
    expect(logger.info).toHaveBeenCalledWith("engine created", { state: "idle" });

    await joinMeeting(shell);
    await shell.user.click(screen.getByRole("button", { name: "Participants (1)" }));
    await shell.user.click(screen.getByRole("button", { name: "Choose camera" }));
    await shell.settle();
    expect(document.documentElement.outerHTML).not.toContain(TOKEN);
    expect(attributeValues().join("\n")).not.toContain(TOKEN);
    expect(shell.element.hasAttribute("token")).toBe(false);

    await shell.element.leave();
    await shell.settle();
    expect(shell.closed).toEqual([{ reason: "left" }]);
    expect(document.documentElement.outerHTML).not.toContain(TOKEN);
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    expect(JSON.stringify([shell.joined, shell.closed])).not.toContain(TOKEN);
    const calls = [logger.debug, logger.info, logger.warn, logger.error].map((spy) => spy.mock.calls);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
  });

  it("uses the latest logger without recreating the engine", async () => {
    const first = { info: vi.fn() };
    const second = { info: vi.fn() };
    const shell = await createShell({ token: null });
    shell.element.logger = first;
    shell.element.token = TOKEN;
    await shell.settle();
    shell.element.logger = second;
    await shell.settle();
    shell.engines.last.options.logger?.info?.("later");
    expect(shell.engines.engines).toHaveLength(1);
    expect(second.info).toHaveBeenCalledWith("later", undefined);
    expect(first.info).not.toHaveBeenCalled();
  });
});
