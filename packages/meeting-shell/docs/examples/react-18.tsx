// React 18: React 18 passes every JSX prop to a custom element as an attribute, and the join token must be a
// property, so create the shell with mount() in an effect and destroy it in the cleanup.
// The page asks your own backend for a join token (see backend-token.md and ../backend-api.md).
import { useEffect, useRef } from "react";
import { mount, type MeetingShellAppearance, type MeetingShellCloseReason, type ShellHandle } from "@strevokit/shell";
import "@strevokit/shell/styles.css";

interface MeetingProps {
  token: string;
  appearance?: MeetingShellAppearance;
  onClosed?: (reason: MeetingShellCloseReason) => void;
}

export function Meeting({ token, appearance = "system", onClosed }: MeetingProps) {
  const container = useRef<HTMLDivElement>(null);
  const shell = useRef<ShellHandle | null>(null);
  // The latest callback, so a new function from the parent doesn't re-create the shell (which starts a new meeting).
  const latestOnClosed = useRef(onClosed);
  useEffect(() => {
    latestOnClosed.current = onClosed;
  });

  // A new token starts a new meeting.
  useEffect(() => {
    if (!container.current) return;
    const handle = mount(container.current, {
      token,
      realtimeUrl: "wss://realtime.example.com",
      onJoined: (event) => console.info("joined as", event.role),
      onClosed: (event) => latestOnClosed.current?.(event.reason),
    });
    shell.current = handle;
    return () => {
      handle.destroy();
      shell.current = null;
    };
  }, [token]);

  // Appearance changes apply to the running meeting.
  useEffect(() => {
    if (shell.current) shell.current.element.appearance = appearance;
  }, [appearance, token]);

  return <div ref={container} style={{ height: "100dvh" }} />;
}
