# Browser extension is transport-only; site parsing stays in the server SpiderAdapter

The browser-extension capture bridge exists to reach sites the server cannot connect to directly (e.g. Cloudflare access verification). We decided the extension only renders pages in a real top-level tab, serializes the rendered DOM, and returns it to the server through the existing `SpiderHtmlFetcher` seam; all site parsing (metadata, chapter index, chapter body) stays in the existing server-side `SpiderAdapter`s. The extension never parses site structure, never forwards or stores site session cookies or verification credentials, and declares no site permissions beyond those the user grants per site (optional host permissions).

## Considered Options

- **In-extension parser registry** — rejected: duplicates parsing logic in a second runtime, splits one parsing implementation into two that must stay in sync, and makes existing syosetu/syosetu18/kakuyomu adapters unusable through the bridge.
- **Hybrid (known sites via fetcher, unknown sites captured whole)** — deferred: a generic whole-page capture mode may come later, but the v1 bridge is transport-only.

## Consequences

- Capturing a new site still means writing a server-side adapter per existing conventions; such adapters register as browser-transport capable. That is the "site parser extension point" — it lives server-side, not in the extension.
- The extension's only contract is: navigate to a URL in a visible tab, wait for rendering, return the serialized DOM (or a typed challenge/rate-limit signal).
