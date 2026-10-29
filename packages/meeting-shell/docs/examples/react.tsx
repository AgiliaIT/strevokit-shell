// React 19: use <strevokit-meeting> directly in JSX, or call mount() in an effect. React 19 sets `token` and
// `appearance` as properties (the element defines them), passes `realtime-url` as an attribute, and binds
// `onsvk-joined` / `onsvk-closed` to the element's events.
// The page asks your own backend for a join token (see backend-token.md and ../backend-api.md).
import { useEffect, useRef, useState, type DetailedHTMLProps, type HTMLAttributes } from "react";
import {
  mount,
  type MeetingShellAppearance,
  type MeetingShellCloseReason,
  type MeetingShellEventMap,
  type StrevokitMeetingElement,
} from "@strevokit/shell";
import "@strevokit/shell/styles.css";

// TypeScript: describe the element for JSX once, for example in src/strevokit-meeting.d.ts.
type StrevokitMeetingProps = DetailedHTMLProps<HTMLAttributes<StrevokitMeetingElement>, StrevokitMeetingElement> & {
  token?: string | null;
  "realtime-url"?: string;
  appearance?: MeetingShellAppearance;
  "onsvk-joined"?: (event: MeetingShellEventMap["svk-joined"]) => void;
  "onsvk-closed"?: (event: MeetingShellEventMap["svk-closed"]) => void;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "strevokit-meeting": StrevokitMeetingProps;
    }
  }
}

const REALTIME_URL = "wss://realtime.example.com";

/** A join token is single-use: bump `attempt` to fetch a fresh one for a rejoin. */
function useJoinToken(meetingId: string, attempt: number): string | null {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setToken(null);
    fetch(`/api/meetings/${encodeURIComponent(meetingId)}/join-token`, { method: "POST", credentials: "include" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((body: { token: string }) => active && setToken(body.token))
      .catch((error: unknown) => console.error("couldn't get a join token", error));
    return () => {
      active = false;
    };
  }, [meetingId, attempt]);
  return token;
}

/** The element in JSX. */
export function MeetingPage({ meetingId }: { meetingId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [closed, setClosed] = useState<MeetingShellCloseReason | null>(null);
  const token = useJoinToken(meetingId, attempt);

  if (closed !== null) {
    return (
      <main>
        <p>The meeting has closed ({closed}).</p>
        <button
          type="button"
          onClick={() => {
            setClosed(null);
            setAttempt((n) => n + 1);
          }}
        >
          Rejoin
        </button>
      </main>
    );
  }
  if (token === null) return <p>Loading…</p>;

  return (
    <main style={{ height: "100dvh" }}>
      <strevokit-meeting
        token={token}
        realtime-url={REALTIME_URL}
        appearance="system"
        onsvk-joined={(event) => console.info("joined as", event.detail.role)}
        onsvk-closed={(event) => setClosed(event.detail.reason)}
      />
    </main>
  );
}

/** The same with mount(): create the shell in an effect and destroy it in the cleanup. */
export function MountedMeeting({ token, onClosed }: { token: string; onClosed: (reason: MeetingShellCloseReason) => void }) {
  const container = useRef<HTMLDivElement>(null);
  // The latest callback, so a new function from the parent doesn't re-create the shell (which starts a new meeting).
  const latestOnClosed = useRef(onClosed);
  useEffect(() => {
    latestOnClosed.current = onClosed;
  });

  useEffect(() => {
    if (!container.current) return;
    const shell = mount(container.current, {
      token,
      realtimeUrl: REALTIME_URL,
      onClosed: (event) => latestOnClosed.current(event.reason),
    });
    return () => shell.destroy();
  }, [token]);

  return <div ref={container} style={{ height: "100dvh" }} />;
}
