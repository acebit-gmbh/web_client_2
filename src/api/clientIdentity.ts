// Use the existing package.json version shown in the footer; there is no separate build id.
// Send identity in authentication JSON so Server 19's CORS allowlist stays compatible.
// Server 20 binds this platform to the challenge/session for subsequent requests.
export const WEB_CLIENT_IDENTITY = {
  platform: 'web',
  version: __APP_VERSION__,
} as const
