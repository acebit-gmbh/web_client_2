# Password Depot Web Client

A modern web client for **Password Depot Enterprise Server**, built as a Single Page Application (SPA) that communicates with the PD Server exclusively via the REST API v2.0.

> 📖 **REST API documentation** — the Password Depot Server REST API v2.0 contract this client targets is documented at **https://github.com/acebit-gmbh/pd_rest_api**.

## Overview

The web client provides browser-based access to Password Depot vaults with support for:

- **Vault browsing** -- folder tree navigation, entry list with sorting, detail panel
- **Full CRUD** -- create, edit, move, and delete entries and folders
- **12 entry types** -- password, credit card, license, identity, information, banking, document, RDP, PuTTY, TeamViewer, custom, passkey (custom entries render with the password layout)
- **Document management** -- upload and download file attachments (up to 64 MB)
- **Search** -- full-text search across entries
- **6 authentication methods** -- Standard, SSPI, Windows SSO (Negotiate), Passkey (WebAuthn), OIDC, Azure AD
- **Two-factor authentication** -- TOTP setup and verification
- **Second password protection** -- per-entry/folder unlock with session caching
- **Database icons** -- shows the custom icons stored in a database on its entries and folders, falling back to the standard icon; the entry form has an icon picker (the 135 standard icons, the icons of the database, or a new image that is scaled to 64 × 64 pixels in the browser and uploaded) (Server 20.0.0+)
- **Recycle bin** -- deleting an entry or folder moves it to the database's recycle bin, and the sidebar opens a view of it: restore an item, delete one for good, or empty the bin. Shows the caller's own deletions, and other people's where the server says they may manage them (Server 20.0.0+)
- **Categories** -- the entry form offers the database's own category list as suggestions for a free-text field, the way the Windows client's editable combo box does (Server 20.0.0+)
- **One-time codes** -- shows an entry's current TOTP code on request, with countdown and 20-second clipboard auto-clear; the entry form sets, replaces or removes the secret (typed, or pasted as an `otpauth://` link) for password, credit card, license, banking and custom entries (Server 20.0.0+)
- **Session management** -- 10-minute inactivity timeout with warning, auto-logout
- **Responsive design** -- desktop, tablet, and mobile layouts
- **Internationalization** -- English, German, French, Spanish, and Dutch
- **Theming** -- light, dark, and system-preference modes

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React + TypeScript | 19.x / 5.9 |
| Build | Vite | 8.x |
| Routing | React Router | 7.x |
| State | Zustand | 5.x |
| Data Fetching | TanStack Query | 5.x |
| UI Components | shadcn/ui (Base UI + Tailwind) | -- |
| Forms & validation | Controlled components + Zod | 4.x |
| i18n | i18next + react-i18next | -- |
| Testing | Vitest + Testing Library | 4.x |

## Prerequisites

- **Node.js** 20 or later
- **npm** 10 or later (ships with Node.js 20+)
- **Password Depot Enterprise Server** 19.x running with REST API v2.0 enabled (20.0.0 or later for one-time codes and database icons)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure the development proxy

Point the dev-server proxy at your PD Server with an environment variable — no need to edit tracked source. Copy the example file and set the target:

```bash
cp .env.example .env.local
# then edit .env.local:
#   DEV_PROXY_TARGET=https://your-pd-server:8714
```

`npm run dev` forwards the `/v2.0`, `/file`, and `/temp` routes to `DEV_PROXY_TARGET` (defaults to `https://localhost:8714` when unset). The `/file` route serves the legacy icon files of servers older than 20.0.0 in development — it must be proxied or those icons will 404. (Standard icons are bundled with the client, and database icons of Server 20.0.0+ arrive through `/v2.0`.)

`.env.local` is gitignored, and `DEV_PROXY_TARGET` is **not** `VITE_`-prefixed, so it never reaches the client bundle. The dev proxy accepts the server's self-signed/private TLS certificate (`secure: false` in `vite.config.ts`); the production client always uses HTTPS against a properly-presented certificate.

### 3. Start the development server

```bash
npm run dev
```

The web client is available at `http://localhost:5173`. API requests to `/v2.0/*` are proxied to the PD Server.

### 4. Build for production

```bash
npm run build
```

Output is in the `dist/` directory -- static files ready to be served by any web server or bundled with the PD Server.

### 5. Preview the production build

```bash
npm run preview
```

## All npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | TypeScript check + Vite production build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |
| `npm run format` | Format source files with Prettier |
| `npm run test` | Run Vitest in watch mode |
| `npm run test:run` | Run Vitest once (CI-friendly) |

## Deployment Modes

The web client supports three deployment modes, controlled by `public/config.json`:

### Bundled (planned)

> **Not yet available.** Bundled mode requires the PD Server to serve static web-root files (the SPA `index.html` and assets), which the current server build does not implement — its HTTP listener only serves the `/v2.0`, `/v1.0`, `/file`, `/temp`, and `/shared` routes. Until that lands, deploy the web client in **Custom Server** or **Cloud Hosted** mode (below). The initial public rollout is cloud-hosted.

When supported, the compiled SPA is shipped as static files served by the PD Server itself. Same-origin deployment eliminates CORS issues and enables Windows SSO (Negotiate) out of the box.

```json
{
  "bundled": true
}
```

The server connection fields are hidden. All API calls use relative URLs (`/v2.0/...`).

### Custom Server

The web client is hosted separately (e.g., on a corporate web server) and connects to a PD Server specified by the user or pre-configured.

```json
{
  "bundled": false,
  "defaultServer": "pd-server.example.com",
  "defaultPort": "8714"
}
```

Requires CORS headers on the PD Server (configured in Server Manager).

### Cloud Hosted

Hosted at a public URL (e.g., `web.password-depot.de`) where each user connects to their own PD Server. No defaults are pre-filled.

```json
{
  "bundled": false,
  "defaultServer": "",
  "defaultPort": "8714"
}
```

## Configuration

### config.json

Place `config.json` in the `public/` directory (development) or alongside `index.html` (production). All fields are optional -- defaults are used for missing fields.

```json
{
  "bundled": false,
  "defaultServer": "",
  "defaultPort": "8714",
  "defaultAuthMethod": "standard",
  "disabledAuthModes": []
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `bundled` | boolean | `false` | When `true`, the web client is served by the PD Server (same origin) |
| `defaultServer` | string | `""` | Pre-filled server address (empty = user must enter) |
| `defaultPort` | string | `"8714"` | Default port number |
| `defaultAuthMethod` | string | `"standard"` | Default authentication method in the selector |
| `disabledAuthModes` | string[] | `[]` | Auth methods to hide (e.g., `["negotiate", "azure"]`) |

Valid values for `defaultAuthMethod` and `disabledAuthModes`: `"standard"`, `"sspi"`, `"negotiate"`, `"webauthn"`, `"oidc"`, `"azure"`.

### User Preferences

User preferences (language, theme, last-used server, last-used auth method, etc.) are stored in the browser's `localStorage` under the key `pd-options`. No sensitive data (passwords, second passwords) is ever stored in `localStorage`. The access token is held in tab-scoped `sessionStorage` (key `pd-auth`) so it survives an accidental refresh; it is cleared on logout and tab close (see "Security Model" below).

## Authentication Methods

### Standard (Username & Password)

Default method. User enters username and password, which are sent to `POST /v2.0/auth/login` with `auth: "standard"`.

### SSPI (Domain Login)

Kerberos/NTLM authentication with explicit domain credentials. User enters credentials in UPN format (`user@domain.com`) or down-level format (`DOMAIN\username`). Sent with `auth: "sspi"`.

### Windows SSO (Negotiate)

Passwordless authentication using the browser's HTTP Negotiate (SPNEGO/Kerberos) mechanism. The browser automatically sends the user's Windows credentials -- no username or password input required.

**Requirements:**

- The PD Server must have Integrated Windows Authentication (IWA) enabled
- The PD user must have the IWA auth method enabled with SAM or UPN populated
- The client machine must be domain-joined
- The browser must be configured to allow Negotiate authentication to the server (see below)

**Bundled mode:** Works out of the box if the server is in the browser's Local Intranet zone (same origin is typically trusted automatically).

**Cross-origin mode:** Requires the server to send proper CORS headers (`Access-Control-Allow-Credentials: true` with a specific origin, not `*`), and the browser must be configured to trust the server.

#### Configuring Google Chrome for Negotiate

Chrome requires an explicit policy to allow Negotiate authentication. Set the `AuthServerAllowlist` policy via the Windows Registry.

**Run as Administrator:**

```cmd
reg add "HKLM\SOFTWARE\Policies\Google\Chrome" /v AuthServerAllowlist /t REG_SZ /d "your-pd-server.example.com" /f
```

Multiple servers can be comma-separated. Wildcards are supported:

```cmd
reg add "HKLM\SOFTWARE\Policies\Google\Chrome" /v AuthServerAllowlist /t REG_SZ /d "*.example.com,pd-server.local" /f
```

**Restart Chrome** after setting the policy. Verify at `chrome://policy` -- the `AuthServerAllowlist` entry should appear.

#### Configuring Microsoft Edge for Negotiate

Edge uses the same policy name but under a different registry key:

```cmd
reg add "HKLM\SOFTWARE\Policies\Microsoft\Edge" /v AuthServerAllowlist /t REG_SZ /d "your-pd-server.example.com" /f
```

**Restart Edge** after setting the policy. Verify at `edge://policy`.

#### Domain-Wide Deployment via Group Policy

For enterprise environments, use Group Policy instead of manual registry edits:

1. Open **Group Policy Management Console** (`gpmc.msc`)
2. Navigate to **Computer Configuration > Administrative Templates > Google Chrome** (or **Microsoft Edge**)
3. Enable **Authentication server allowlist**
4. Enter the PD Server hostname(s)

The Chrome/Edge ADMX templates must be installed. Download from:

- **Chrome:** https://chromeenterprise.google/browser/download/
- **Edge:** https://www.microsoft.com/en-us/edge/business/download

### Passkey (WebAuthn / FIDO2)

Passwordless authentication using biometric or hardware security keys. The user enters their username, then the browser's native passkey dialog appears.

**Note:** The web client supports passkey **login** (assertion) as well as passkey **registration and management** from the user profile panel (via `/me/passkeys/*`). Passkeys registered in the native Password Depot client and in the web client are interchangeable. (Registration requires the WebAuthn auth method to be enabled for the user on the server.)

### Identity Provider (OIDC)

OpenID Connect authentication via configured identity providers (Ping Identity, Entra ID, Auth0, generic OIDC). The available providers are fetched from the PD Server via `GET /v2.0/auth/oidc` and cached locally.

**Setup:**

1. Configure the OIDC provider in PD Server Manager
2. Register the web client's **base URL** (origin only — no path) as a valid redirect URI in the identity provider's app registration. Because the app uses hash-based routing, the route lives in the URL fragment, so the redirect URI is the base URL, **not** a `/login` path:
   - Development: `http://localhost:5173/`
   - Production: `https://your-web-client-host/`

   > The provider must include `id_token` in its allowed response types (the web client requests `id_token`, since the PD Server validates an id_token/access token rather than exchanging an authorization code). A provider configured for `code`-only response types will fail after the IdP round-trip.

### Azure AD / Entra ID (Deprecated)

Legacy Microsoft authentication using a fixed application client ID (`4d0af5fb-060c-40d5-bbf5-8b59f50d47ed`). This method is maintained for backward compatibility -- new deployments should use OIDC with an Entra ID provider instead.

The web client's URL must be registered as a redirect URI in the Azure AD app registration for the above application ID.

### Two-Factor Authentication (2FA)

2FA is handled transparently for all authentication methods:

- **HTTP 459** -- 2FA not yet activated. The web client displays the QR code for authenticator app setup, then prompts for the 6-digit code.
- **HTTP 460** -- 2FA code required. The web client prompts for the 6-digit verification code.
- **HTTP 401 with error.code 4012 / 4013** (Server 20+) -- the server cannot send the verification e-mail / the account has no e-mail address. Shown as a localized "contact your administrator" message, never as a wrong password; any other 401 shows the server's message.

The full original login request (including OIDC/Azure tokens) is preserved and resent with the `tfacode` field appended.

## Security Model

- **Server-side decryption** -- the API returns plaintext data over HTTPS. No client-side cryptography is needed.
- **HTTPS-only transport** -- the client always builds the API origin with the `https://` scheme; user-supplied server addresses are sanitized to strip any scheme prefix or path so the connection cannot be downgraded.
- **Tab-scoped token storage** -- the access token is held in a Zustand store backed by `sessionStorage` (key `pd-auth`). It survives a page refresh in the same tab so the user does not lose their session on accidental F5, and it is cleared on logout, on tab close, and after 10 minutes of server-side inactivity. It is never written to `localStorage` or cookies. Logout fans out across all open tabs via a `BroadcastChannel`, so signing out in one tab also clears the others.
- **10-minute session timeout** -- the server invalidates the token after 10 minutes of inactivity. Each API call resets the timer. The web client shows a warning at 8 minutes and auto-logs out at 10.
- **Second password** -- entries and folders protected with a second password require an additional password prompt. The second password is sent via the `X-Second-Password` header (Base64-encoded) and cached in memory for the session duration.
- **OIDC / Azure callback validation** -- the OAuth `state` and `nonce` values are generated with `crypto.getRandomValues`. On callback the `state` is verified against the value saved during the authorization request, and when the IdP returns an `id_token` directly its `nonce` claim is verified before the token is forwarded to the PD Server. Error callbacks are only honored when an OIDC flow is actually in progress, and only the machine-readable error code (never the IdP's free-text description) is shown, to prevent text-injection via crafted `?error=` links.
- **No-store responses** -- API requests are issued with `cache: 'no-store'` so entry-detail responses (which contain plaintext passwords) are never written to the browser's persistent disk cache.
- **Content-Security-Policy** -- `index.html` ships a baseline CSP meta tag (`object-src 'none'`, `frame-ancestors 'none'`, scoped `connect-src`, etc.). For standalone/cloud deployments, **also serve a stricter nonce/hash-based CSP as a real HTTP header** at your web server (a meta tag cannot set `frame-ancestors`, and a static tag can't carry a per-build nonce), and tighten `connect-src` to your specific PD Server origin. Database icons need **no CSP change**: the server sends them as base64 inside JSON and the client displays them as `data:` URLs, which `img-src 'self' data: https:` already allows. Do **not** add `blob:` to `img-src` for them — the client never creates object URLs for display, and the image type is allow-listed to PNG and BMP (SVG is never rendered from server data). The icon upload needs nothing either: the chosen file is decoded with `createImageBitmap` (which is not subject to `img-src`), drawn on a canvas, and both its preview and the uploaded PNG come from that canvas as a `data:` URL / base64 — again no `blob:`. SVG files are not accepted as an upload source.

## Project Structure

```
src/
  api/              API client layer (fetch wrapper, endpoint functions, types)
  components/
    auth/           Login form, auth method fields, TFA, OIDC provider select
    common/         Shared components (confirm dialog, copy button, password generator)
    database/       Database selector
    entries/        Entry list, detail views (12 types), entry form
    folders/        Folder form, folder picker
    icons/          Database icon image (first link of the icon fallback chain), icon picker and upload
    layout/         AppBar, breadcrumbs, status bar, vault shell
    profile/        User profile panel, change password
    recyclebin/     Recycle bin view: what the bin holds, restore and delete for good
    search/         Search results
    session/        Session expiry warning
    tree/           Folder tree, tree node
    ui/             Base UI / shadcn components (button, dialog, select, etc.)
  hooks/            React Query hooks, WebAuthn, session watchdog, sorting
  i18n/             i18next config + locale JSON files (en, de, fr, es, nl)
  lib/              Utilities (config, clipboard, dates, OIDC, base64, debounce)
  pages/            Route-level components (LoginPage, VaultPage, NotFoundPage)
  stores/           Zustand stores (auth, navigation, connection, options, second password)
public/
  config.json       Deployment configuration
  logo.svg          Application logo
```

## REST API

The web client targets the **Password Depot Enterprise Server REST API v2.0** (client scope).

Full API documentation: **https://github.com/acebit-gmbh/pd_rest_api** (also published at https://www.password-depot.de/en/documentation/rest-api/v2.0/).

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/login` | Authenticate (all methods) |
| POST | `/auth/logout` | End session |
| GET | `/auth/oidc` | Discover OIDC providers |
| POST | `/auth/webauthn/begin` | Begin passkey assertion |
| POST | `/auth/webauthn/complete` | Complete passkey assertion |
| GET | `/me` | Current user profile |
| POST | `/me/password` | Change password |
| GET | `/databases` | List accessible databases |
| GET | `/databases/{db}/children` | Root-level folders and entries |
| GET | `/databases/{db}/folders/{id}/children` | Folder contents |
| GET | `/databases/{db}/entries/{id}` | Full entry details |
| GET | `/databases/{db}/entries/{id}/otp` | Current one-time code (Server 20.0.0+) |
| POST | `/databases/{db}/entries` | Create entry |
| PATCH | `/databases/{db}/entries/{id}` | Update entry |
| DELETE | `/databases/{db}/entries/{id}` | Delete entry |
| POST | `/databases/{db}/entries/{id}/move` | Move entry |
| GET | `/databases/{db}/entries/{id}/content` | Download document |
| PUT | `/databases/{db}/entries/{id}/content` | Upload document |
| POST | `/databases/{db}/folders` | Create folder |
| PATCH | `/databases/{db}/folders/{id}` | Update folder |
| DELETE | `/databases/{db}/folders/{id}` | Delete folder |
| POST | `/databases/{db}/folders/{id}/move` | Move folder |
| GET | `/databases/{db}/search` | Search entries |
| GET | `/databases/{db}/icons` | Icons stored in the database: `id`, `name`, `version` (Server 20.0.0+) |
| GET | `/databases/{db}/icons?ids=…&include=data` | Database icon images, batched (Server 20.0.0+) |
| GET | `/databases/{db}/icons/{id}` | One database icon image (Server 20.0.0+) |
| POST | `/databases/{db}/icons` | Upload a database icon: JSON `{name, data}` with a base64 PNG (Server 20.0.0+) |
| GET | `/databases/{db}/categories` | The database's own category list (Server 20.0.0+) |
| GET | `/databases/{db}/recyclebin` | What the recycle bin holds, of what the caller may see (Server 20.0.0+) |
| POST | `/databases/{db}/recyclebin/{id}/restore` | Put one item back (Server 20.0.0+) |
| DELETE | `/databases/{db}/recyclebin/{id}` | Delete one item for good (Server 20.0.0+) |
| DELETE | `/databases/{db}/recyclebin` | Empty the recycle bin (Server 20.0.0+) |
| GET | `/users/{id}` | One user, to put a name on an id a response carries |

### API Constraints

- **No flat entry list** -- browsing is exclusively via `/children` endpoints (folder tree navigation)
- **No server-side sorting** -- the client implements sorting locally
- **Compact vs. full representations** -- list endpoints return compact objects (no passwords); detail endpoints return full objects
- **Pagination** -- all list endpoints support `offset` and `limit` query parameters
- **One-time codes on request only** -- `/otp` is an audited read that fires "password accessed" alerts, so the client fetches a code only when the user clicks *Show code*, never on a timer or on tab focus. Codes are never computed client-side; the seed stays on the server. Entries carry `has_otp` (and `totp`) only on Server 20.0.0+, so their absence means the feature is unavailable.
- **Database icons are JSON, batched, and cached by version** -- on Server 20.0.0+ a row's `database_icon` (`id`, `name`, `version`) points at an icon of the row's own database. There is no image URL: the image arrives as base64 inside JSON, is requested for all rows of a listing at once (`?ids=` in chunks of `icons.batch_max`, at most three requests in flight; a `deferred` item is fetched with the single-icon route) and is cached in memory per (database, id, version) - never refetched while in use, dropped after 30 unused minutes and on logout. The display chain is database icon → bundled standard icon named by `icon` → type glyph; an unusable or missing icon is remembered and the fallback shown. Support is detected by the `icons` object on the database — without it the client never calls `/icons`, and rows without a `database_icon` never trigger a request.
- **Icon changes travel only when made, uploads are always 64 × 64 PNG** -- the entry form (entries only; folders just display their icon) sends `image_custom` / `image_index` / `image_name` only when the user changed the icon, in one of three forms: `{image_custom: true, image_name}` for an icon of the database (never a client-computed position), `{image_custom: false, image_index: 0..134}` for a standard icon, `{image_custom: false, image_index: -1}` for the type default. The picker labels the standard icons 1..135 for the user, so *Standard icon 13* in the UI is `image_index: 12` on the wire and in the server's audit record — an offset of one when a support case names an icon. An upload is a request of its own, made before the entry is saved: the picked PNG/JPEG/GIF/WebP/BMP file (never SVG) is drawn contain-fit on a transparent 64 × 64 canvas — the native size of a Password Depot icon; there is no ladder of smaller sizes — and refused locally if the PNG exceeds `icons.max_bytes`. The entry is then saved with the `name` **the server answered** (a different picture under a taken name is stored as `name (2)`). REST has no icon delete, so an upload is not rolled back when the entry save fails; the icon stays selected for the retry. The *Upload* tab exists only while `icons.can_upload` is true, the whole picker only while the database carries `icons`. Refusals are explained inline by (status, `error.code`): 400/4007 (the chosen icon no longer exists — the list is re-read and the picker reopened), 400/4008, 403/4034, 413/4131, a plain 403 (mirror server); an upload that fails without any HTTP answer is reported as "too large or connection lost", because the server's header-stage 413 carries no CORS headers.
- **A delete is a move to the recycle bin, and the bin has rights of its own** -- on Server 20.0.0+ `DELETE` takes `?mode=recycle|permanent` and defaults to `recycle`, so the client sends no mode at all; the one place it asks for `permanent` is cleaning up an entry whose document upload failed, which never existed for the user. The `recycle_bin` object on the database is the feature test: without it the client shows no bin and calls no `/recyclebin` route. Its `can_manage` says only whether the caller also sees what OTHER people deleted - their own deletions are always theirs to see. Restoring and deleting for good rest on different rights and neither follows from having deleted the item, so both are offered on every row and a refusal is reported when it comes. Emptying the bin destroys what the caller may delete, leaves the rest and still answers 204, so the listing is always re-read rather than cleared locally. A row carries `deleted_by` (a user id, resolved through `/users/{id}`) and no deletion timestamp, so a bin cannot be ordered or labelled by when things were deleted. Two more things the bin does on its own: it holds at most `recycle_bin.keep` items and drops the oldest at the next save without telling anyone, which is why the view names that limit beside the count; and an item whose original folder has itself been deleted is restored into the database root instead, which no response reports, so a restore cannot be reported as landing anywhere in particular.
- **One-time code secrets are write-only** -- no route ever returns a stored seed, so the entry form shows only the stored parameters and a *Replace* means typing or pasting a whole new secret. The `totp` request key is sent only when the server has shown it accepts it (the loaded entry, or any listed entry of the database, carries `totp`); it is omitted when untouched, `null` to remove, and carries all four members whenever a secret is sent. Unknown request keys are ignored by older servers, so the client never probes by writing.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, coding conventions, and the pull-request checklist. In short: keep the API layering intact, add user-facing strings to **all** locale files (`en`, `de`, `fr`, `es`, `nl`), and make sure `npm run lint`, `npm run build`, and `npm run test:run` pass before opening a PR.

## Security

This is a client for a password manager, so security reports are taken seriously. **Please do not open a public issue for vulnerabilities** — follow the responsible-disclosure process in [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE). Copyright © 2026 AceBIT GmbH.
