#!/usr/bin/env bun
import { AuthenticationError } from "@signalridge/jaist-sso";
import {
  parseCLI,
  readCredentialInput,
  reportError,
} from "@signalridge/jaist-sso/cli-support";
import { createTerminalHandler } from "@signalridge/jaist-sso/terminal";
import { authenticateVpn } from "./index.ts";

export async function main(args = process.argv.slice(2)): Promise<void> {
  const options = parseCLI(args);
  if (options.help) {
    process.stdout.write(
      "Usage: jaist-vpn-auth [--method certificate|totp|email-otp]\n  [--url JAIST_VPN_GATEWAY] [--credentials-stdin | --credentials-fd N] [--session-json]\n",
    );
    return;
  }
  if (options.json && process.stdout.isTTY)
    throw new AuthenticationError(
      "invalid-input",
      "Session JSON requires a pipe or redirected stdout",
    );
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(180_000),
  ]);
  try {
    const credentials =
      options.fd === undefined
        ? undefined
        : await readCredentialInput(options.fd, signal);
    const result = await authenticateVpn({
      gateway: options.url,
      method: options.method,
      credentials,
      onChallenge: createTerminalHandler(),
      signal,
    });
    if (options.json)
      process.stdout.write(
        `${JSON.stringify({ gateway: result.gateway, cookies: result.cookies })}\n`,
      );
    else
      process.stdout.write(
        "JAIST VPN gateway session issued; tunnel connection is a separate step\n",
      );
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

if (import.meta.main)
  main().catch((error) => {
    process.exitCode = reportError(error);
  });
