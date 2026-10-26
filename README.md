# jaist-vpn-auth

[![npm](https://img.shields.io/npm/v/@signalridge/jaist-vpn-auth)](https://www.npmjs.com/package/@signalridge/jaist-vpn-auth)
[![CI](https://github.com/signalridge/jaist-vpn-auth/actions/workflows/ci.yml/badge.svg)](https://github.com/signalridge/jaist-vpn-auth/actions/workflows/ci.yml)

Obtain JAIST F5 VPN gateway sessions using `@signalridge/jaist-sso`. This package
owns the gateway's SAML request/callback and returns `MRHSession` and `F5_ST`.
It does **not** establish a tunnel, change routes, access gopass or run a daemon.

Requires Bun 1.4.4 or later.

## Installation

```sh
bun add @signalridge/jaist-vpn-auth
bunx @signalridge/jaist-vpn-auth --help
```

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
bunx @signalridge/jaist-vpn-auth --method totp
bunx @signalridge/jaist-vpn-auth --method email-otp
```

The SSO package supplies terminal interaction and hides passwords/OTP. For
certificate/headless authentication, pass credential JSON through stdin or an
inherited descriptor:

```sh
your-credential-producer | bunx @signalridge/jaist-vpn-auth --method certificate --credentials-stdin
```

For interactive OTP with piped username/password, keep stdin attached to the TTY
and provide JSON through `--credentials-fd 3`. The JSON schema is described in the
[SSO README](https://github.com/signalridge/jaist-sso#cli-and-credential-pipes). The core does not assume gopass paths or access a browser/password
store. Missing headless OTP input fails with `input-required`; authentication is
not repeatedly retried. `--url` can select the allowed JAIST gateway alias.

To pass a gateway session directly to a consuming VPN client:

```sh
your-credential-producer | bunx @signalridge/jaist-vpn-auth --method certificate --credentials-stdin --session-json | your-vpn-client-adapter
```

The producer emits credential JSON; the client adapter reads `{ gateway, cookies }`
and submits it to the VPN client's authentication API. These adapters belong to
the application and are not commands shipped by this package. The package can
obtain a session on a headless host, while the consuming client owns when to
request authentication and how to connect its tunnel.

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

## Development

```sh
bun install --frozen-lockfile
bun run check
```

See [CONTRIBUTING.md](https://github.com/signalridge/jaist-vpn-auth/blob/main/CONTRIBUTING.md)
for development, testing and the Changesets release workflow.
