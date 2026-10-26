import { expect, test } from "bun:test";

test("CLI help has no runtime dependency on credentials", () => {
  const run = Bun.spawnSync([process.execPath, "src/cli.ts", "--help"], {
    cwd: `${import.meta.dir}/..`,
  });
  expect(run.exitCode).toBe(0);
  expect(run.stdout.toString()).toContain("jaist-vpn-auth");
});
test("headless invalid input terminates without printing credential contents", () => {
  const run = Bun.spawnSync(
    [process.execPath, "src/cli.ts", "--credentials-stdin"],
    {
      cwd: `${import.meta.dir}/..`,
      stdin: Buffer.from(
        '{"password":"synthetic-private-password","certificate":42}',
      ),
    },
  );
  expect(run.exitCode).toBe(1);
  expect(run.stdout.byteLength).toBe(0);
  expect(run.stderr.toString()).not.toContain("synthetic-private-password");
});
