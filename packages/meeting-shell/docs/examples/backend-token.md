# Minting join tokens on your backend

The meeting shell (`<strevokit-meeting>` or `mount()`) needs a join token for each participant. Tokens are short-lived and single-use, and only your
backend can mint them, because minting needs your Strevokit API credential.

**Keep the API credential on your server.** Never ship it in browser code, environment variables exposed to the
browser (such as `VITE_*` or `NEXT_PUBLIC_*`), or mobile apps. The browser only ever receives the join token.

## Flow

1. The signed-in user opens a meeting page in your app.
2. The page asks your backend for a join token.
3. Your backend checks that this user may join, then calls the Strevokit API with its credential.
4. Your backend returns only the token to the page, which passes it to `mount()` or sets it as the element's `token`
   property.

## Example (Node.js with Express)

```ts
import express from "express";

const app = express();
const STREVOKIT_API = "https://api.example.com"; // your Strevokit API base URL
const API_CREDENTIAL = process.env.STREVOKIT_API_CREDENTIAL; // server-side secret, never sent to browsers

app.post("/api/meetings/:meetingId/join-token", requireSignedInUser, async (req, res) => {
  // Your own authorization: may this user join this meeting, and as which Strevokit participant?
  const participantPublicId = await participantFor(req.user, req.params.meetingId);
  if (!participantPublicId) return res.sendStatus(403);

  const response = await fetch(
    `${STREVOKIT_API}/v1/meetings/${encodeURIComponent(req.params.meetingId)}/join-token`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${API_CREDENTIAL}`, "Content-Type": "application/json" },
      body: JSON.stringify({ participant_public_id: participantPublicId }),
    },
  );
  if (!response.ok) return res.sendStatus(502);

  const { data } = await response.json(); // { token, expires_at, expires_in }
  res.set("Cache-Control", "no-store").json({ token: data.token });
});
```

`requireSignedInUser` and `participantFor` stand for your own session and authorization code.

## Notes

- Mint a new token for every join, including rejoining after the meeting UI closes.
- Send the response with `Cache-Control: no-store` so the token isn't cached.
- Don't log the token or put it in a URL. The shell keeps it in memory only and never writes it to an attribute.
