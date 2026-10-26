import { expect, test } from "bun:test";
import { AuthenticationError, HttpSession } from "@signalridge/jaist-sso";
import {
  fixture,
  SERVICE,
  syntheticPfx,
} from "../../jaist-sso/test/fixture.ts";
import {
  authenticateVpn,
  beginVpn,
  completeVpn,
  VpnSession,
} from "../src/index.ts";

const credentials = {
  username: async () => "synthetic-user",
  password: async () => "synthetic-password",
};
for (const method of ["totp", "email-otp"] as const) {
  test(`gateway → ${method} → SAML callback → F5 session`, async () => {
    const mock = fixture();
    const result = await authenticateVpn({
      transport: mock.transport,
      method,
      credentials: {
        ...credentials,
        otp: async () => (method === "totp" ? "123456" : "12345678"),
      },
    });
    expect(result.cookies).toEqual({
      MRHSession: "synthetic-vpn-session",
      F5_ST: "synthetic-ticket",
    });
    expect(JSON.stringify(result)).toBe('"[VpnSession]"');
    expect(String(result)).toBe("[VpnSession]");
    expect(result.cookieHeader()).toBe(
      "MRHSession=synthetic-vpn-session; F5_ST=synthetic-ticket",
    );
    expect(
      mock.calls.filter((x) => x.url === `${SERVICE}/saml/acs`),
    ).toHaveLength(1);
  });
}
test("certificate flow completes at the gateway in one shared session", async () => {
  const mock = fixture();
  const pfx = syntheticPfx();
  try {
    const result = await authenticateVpn({
      transport: mock.transport,
      method: "certificate",
      credentials: {
        ...credentials,
        certificate: async () => ({ pfx, passphrase: "synthetic-test" }),
      },
    });
    expect(result.cookies.F5_ST).toBe("synthetic-ticket");
  } finally {
    pfx.fill(0);
  }
});
test("initial MRHSession without F5_ST is never treated as success", async () => {
  const mock = fixture({ missingTicket: true });
  await expect(
    authenticateVpn({
      transport: mock.transport,
      method: "totp",
      credentials: {
        ...credentials,
        otp: async () => "123456",
      },
    }),
  ).rejects.toMatchObject({ code: "rejected" });
});
test("unsupported gateway is rejected before requesting credentials or making requests", async () => {
  let read = false;
  let sent = false;
  await expect(
    authenticateVpn({
      gateway: "https://untrusted.invalid",
      transport: async () => {
        sent = true;
        throw Error();
      },
      credentials: {
        username: async () => {
          read = true;
          return "synthetic";
        },
      },
    }),
  ).rejects.toMatchObject({ code: "unsafe-destination" });
  expect(read).toBe(false);
  expect(sent).toBe(false);
});
test("callback cannot be forwarded to another service", async () => {
  let sent = false;
  const session = new HttpSession({
    serviceOrigin: SERVICE,
    transport: async () => {
      sent = true;
      throw Error();
    },
  });
  await expect(
    completeVpn(session, {
      url: "https://auth.jaist.ac.jp/receive",
      method: "POST",
      fields: [["SAMLResponse", "synthetic"]],
    }),
  ).rejects.toMatchObject({ code: "unsafe-destination" });
  expect(sent).toBe(false);
});
test("VPN begin rejects an unrelated form without asking for credentials", async () => {
  const session = new HttpSession({
    serviceOrigin: SERVICE,
    transport: async () => ({
      status: 200,
      body: '<form method="POST" action="https://untrusted.invalid"><input type="hidden" name="SAMLRequest" value="synthetic"></form>',
    }),
  });
  await expect(beginVpn(session)).rejects.toBeInstanceOf(AuthenticationError);
});
test("externally owned sessions remain usable after the adapter returns", async () => {
  const mock = fixture();
  const session = new HttpSession({
    serviceOrigin: SERVICE,
    transport: mock.transport,
  });
  const result = await authenticateVpn({
    session,
    method: "totp",
    credentials: { ...credentials, otp: async () => "123456" },
  });
  expect(result).toBeInstanceOf(VpnSession);
  expect(session.cookies.values(`${SERVICE}/`).F5_ST).toBe("synthetic-ticket");
  session.close();
});
test("non-interactive OTP flow returns input-required and does not submit the gateway callback", async () => {
  const mock = fixture();
  await expect(
    authenticateVpn({
      transport: mock.transport,
      method: "email-otp",
      credentials,
    }),
  ).rejects.toMatchObject({ code: "input-required" });
  expect(mock.calls.some((x) => x.url === `${SERVICE}/saml/acs`)).toBe(false);
});
