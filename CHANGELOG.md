# Changelog

## 0.1.0

- Add JAIST F5 gateway authentication using `@signalridge/jaist-sso`.
- Preserve the gateway session through SAML initiation and callback submission.
- Require fresh ticket issuance so stale cookies cannot produce false success.
- Add an interactive/headless CLI with explicit piped session output.
- Return gateway session cookies without creating a VPN tunnel.

Certificate authentication has live validation against the default JAIST VPN
gateway. OTP methods have synthetic transaction tests and need live validation.
