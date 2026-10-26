# jaist-vpn-auth

Obtain JAIST F5 VPN gateway sessions using `@signalridge/jaist-sso`. This package
owns the gateway's SAML request/callback and returns `MRHSession` and `F5_ST`.
It does **not** establish a tunnel, change routes, access gopass or run a daemon.

The package runs directly on Bun 1.4.4 or later under the MIT license. Its only
runtime dependency is `@signalridge/jaist-sso` at version `0.1.0`.

## Installation

```sh
bun add @signalridge/jaist-vpn-auth
bunx @signalridge/jaist-vpn-auth --help
```

The SSO dependency is installed normally; no sibling checkout, local link or
separate installation is needed by consumers.

## Development

```sh
bun install --frozen-lockfile
bun run check
bun run format
```

`check` runs Biome lint/format/import checks, strict TypeScript checking and tests.
Tests use this repository's own synthetic transaction fixtures and generate
in-memory test certificates using OpenSSL. They perform no real JAIST login.
CI checks Linux and macOS without credential secrets or cross-repository checkout.
To test an unpublished SSO change, register it with `bun link` in its checkout,
then use `bun link --no-save @signalridge/jaist-sso` here; do not commit local links.
The normal frozen install restores the published dependency.

## Library

```ts
import { authenticateVpn } from "@signalridge/jaist-vpn-auth";

const session = await authenticateVpn({
  method: "certificate",
  credentials: {
    username: async () => readUsername(),
    password: async () => readPassword(),
    certificate: async () => readCertificate(), // { pfx: Uint8Array, passphrase }
  },
  signal: abortController.signal,
});

// Submit session.cookies to your VPN client through its supported API.
// Do not log the cookies. Success here means a gateway session was issued;
// only the consuming client can confirm that a tunnel connected.
```

The `read*` functions and abort controller above are supplied by the application.
For OTP or email OTP, pass the matching `method` and either `credentials.otp` or
an `onChallenge` handler. Reuse `createTerminalHandler` from
`@signalridge/jaist-sso/terminal` for an interactive CLI or SSH terminal.

`beginVpn(session)` and `completeVpn(session, callback)` are also exported for
callers managing their own transaction. Both require the **same** `HttpSession`;
the initial gateway cookie must survive the SSO transaction. An externally
supplied session remains owned by its caller and must be closed by that caller.

Both `vpn.jaist.ac.jp` and its configured `vpn4.jaist.ac.jp` alias are allowed;
the default gateway is `vpn.jaist.ac.jp`. Other gateways are deliberately rejected.
Only the default gateway and certificate method have live validation. OTP and
email OTP have synthetic end-to-end tests and need live validation.

## CLI

```sh
bun src/cli.ts --method totp
bun src/cli.ts --method email-otp
```

The SSO package supplies terminal interaction and hides passwords/OTP. For
certificate/headless authentication, pass credential JSON through stdin or an
inherited descriptor:

```sh
your-credential-producer | bun src/cli.ts --method certificate --credentials-stdin
```

For interactive OTP with piped username/password, keep stdin attached to the TTY
and provide JSON through `--credentials-fd 3`. The JSON schema is described in the
SSO README. The core does not assume gopass paths or access a browser/password
store. Missing headless OTP input fails with `input-required`; authentication is
not repeatedly retried. `--url` can select the allowed JAIST gateway alias.

The default output is only a status line. `--session-json` explicitly writes
`{ gateway, cookies }` to redirected stdout/a pipe, refusing an interactive terminal.
The consumer must protect that pipe and avoid recording it in logs. Session
objects redact default string/JSON serialization; `.cookies` and `.cookieHeader()`
are explicit secret accessors.

## Deployment boundary

Keep sing-box API calls, selector monitoring, credential-store access, retry/pause
policy, launchd and systemd in the consuming application. Desktop and
headless use the same library; enable unattended login per host. Authentication
traffic must reach the gateway, SSO and certificate IdP before the VPN is connected;
preserve direct routing and working DNS for all three. Keep the same host and
network path through the transaction when the gateway binds sessions to source IP.

All certificates, cookies and SAML state stay in memory. No credentials are read
from environment variables or accepted as command-line arguments. Never commit
real credentials or diagnostic HTTP dumps. Pause after authentication rejection
instead of running an unattended failure loop.

## Releases

Run `bun run check` and `bun run pack:check` before creating a version tag.
The tag must equal `v` followed by the manifest version. `publish.yml` validates
the clean checkout, archive allowlist and npm integrity, publishes with npm Trusted
Publishing/OIDC and provenance, then creates the GitHub release. A published
version is reused only when its contents match; changed contents require a new
version. The first publication of a new npm name requires an authenticated
bootstrap, followed by a Trusted Publisher binding to this repository,
`publish.yml`, and the `npm-publish` environment. No long-lived npm token is used
by the workflow.
