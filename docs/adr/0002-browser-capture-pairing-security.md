# Browser-capture pairing: restricted channel, one-time token exchanged for a long-lived key

The server's default listen host flips to `127.0.0.1` (docker-compose keeps its explicit `HOST=0.0.0.0`), and the extension is authorized through pairing: the user generates a short-lived one-time token in the settings page; the extension exchanges it for a long-lived pairing key that authorizes only the `/api/browser/*` capture channel (transport fetches, task dispatch, status reports) — never the full control API; unpairing revokes the key.

Rationale: the token is not theater — a malicious web page can DNS-rebind to `127.0.0.1` and hit the local API same-origin, so the pairing secret is the actual line of defense for the local server. Scoping the key to the capture channel keeps the blast radius of a compromised extension down to capture operations, not the whole library.

## Considered Options

- **Token = full API access** — rejected: a compromised extension would control every write path (crawl, delete, export).
- **Re-pair per operation** — rejected: unusable for a walk that issues many fetches.
- **Loopback binding alone, no token** — rejected: does not stop DNS rebinding from web pages.
