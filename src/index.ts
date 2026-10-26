import type {
  AuthMethod,
  ChallengeHandler,
  CredentialProvider,
  Navigation,
  ServiceCallback,
  SessionOptions,
} from "@signalridge/jaist-sso";
import {
  AuthenticationError,
  authenticate,
  HttpSession,
  httpsURL,
  samlForm,
} from "@signalridge/jaist-sso";

export const GATEWAY = "https://vpn.jaist.ac.jp";
const gateways = new Set([GATEWAY, "https://vpn4.jaist.ac.jp"]);
export type VpnCookies = Readonly<{ MRHSession: string; F5_ST: string }>;
export type VpnOptions = {
  gateway?: string;
  method?: AuthMethod;
  credentials?: CredentialProvider;
  onChallenge?: ChallengeHandler;
  signal?: AbortSignal;
  timeoutMs?: number;
  session?: HttpSession;
  transport?: SessionOptions["transport"];
};

/** Deliberately redacts accidental JSON/string serialization of the session. */
export class VpnSession {
  readonly gateway: string;
  #cookies: VpnCookies;
  constructor(gateway: string, cookies: VpnCookies) {
    this.gateway = gateway;
    this.#cookies = Object.freeze({ ...cookies });
  }
  get cookies(): VpnCookies {
    return this.#cookies;
  }
  cookieHeader(): string {
    return `MRHSession=${this.#cookies.MRHSession}; F5_ST=${this.#cookies.F5_ST}`;
  }
  toJSON(): string {
    return "[VpnSession]";
  }
  toString(): string {
    return "[VpnSession]";
  }
}

export async function beginVpn(
  session: HttpSession,
  gateway = GATEWAY,
  signal?: AbortSignal,
): Promise<Navigation> {
  const url = httpsURL(gateway);
  if (!gateways.has(url.origin) || session.serviceOrigin !== url.origin)
    throw new AuthenticationError(
      "unsafe-destination",
      "Unsupported JAIST VPN gateway",
    );
  const page = await session.request({ url: url.href }, signal);
  if (page.status !== 200)
    throw new AuthenticationError(
      page.status >= 500 ? "network" : "rejected",
      "VPN login page is unavailable",
    );
  const form = samlForm(page);
  if (
    !form?.fields.some(([name, value]) => name === "SAMLRequest" && value) ||
    new URL(form.url).origin !== "https://auth.jaist.ac.jp"
  ) {
    throw new AuthenticationError(
      "unsupported",
      "VPN did not provide the expected JAIST SAML request",
    );
  }
  session.allowedURL(form.url);
  return {
    url: form.url,
    method: "POST",
    body: new URLSearchParams(form.fields.map(([k, v]) => [k, v])).toString(),
  };
}

export async function completeVpn(
  session: HttpSession,
  callback: ServiceCallback,
  signal?: AbortSignal,
): Promise<VpnSession> {
  const target = httpsURL(callback.url);
  if (
    target.origin !== session.serviceOrigin ||
    !gateways.has(target.origin) ||
    callback.method !== "POST" ||
    callback.fields.filter(([name, value]) => name === "SAMLResponse" && value)
      .length !== 1
  ) {
    throw new AuthenticationError(
      "unsafe-destination",
      "Unexpected VPN SAML callback",
    );
  }
  const page = await session.request(
    {
      url: callback.url,
      method: "POST",
      body: new URLSearchParams(
        callback.fields.map(([k, v]) => [k, v]),
      ).toString(),
    },
    signal,
  );
  if (page.status !== 200)
    throw new AuthenticationError(
      "rejected",
      "VPN gateway rejected the SAML callback",
    );
  const values = session.cookies.values(`${target.origin}/`);
  if (!values.MRHSession || !values.F5_ST)
    throw new AuthenticationError(
      "rejected",
      "VPN gateway did not issue both session cookies",
    );
  return new VpnSession(target.origin, {
    MRHSession: values.MRHSession,
    F5_ST: values.F5_ST,
  });
}

/** Obtain gateway cookies, not a tunnel. Tunnel clients consume the result. */
export async function authenticateVpn(
  options: VpnOptions = {},
): Promise<VpnSession> {
  const gateway = httpsURL(options.gateway || GATEWAY).origin;
  if (!gateways.has(gateway))
    throw new AuthenticationError(
      "unsafe-destination",
      "Unsupported JAIST VPN gateway",
    );
  const timeoutMs = options.timeoutMs ?? 180_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000)
    throw new AuthenticationError(
      "invalid-input",
      "Invalid authentication timeout",
    );
  const signal = AbortSignal.any([
    ...(options.signal ? [options.signal] : []),
    AbortSignal.timeout(timeoutMs),
  ]);
  const session =
    options.session ||
    new HttpSession({ serviceOrigin: gateway, transport: options.transport });
  try {
    const request = await beginVpn(session, gateway, signal);
    const callback = await authenticate({
      session,
      request,
      credentials: options.credentials,
      method: options.method,
      onChallenge: options.onChallenge,
      signal,
      timeoutMs,
    });
    return await completeVpn(session, callback, signal);
  } finally {
    if (!options.session) session.close();
  }
}
