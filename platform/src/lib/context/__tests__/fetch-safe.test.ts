import { describe, expect, it } from "vitest";
import { assertSafeUrl, isPrivateIp, UnsafeUrlError } from "../fetch-safe";

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "0.0.0.0",
    "100.64.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1", "ff02::1", "not-an-ip",
  ])("rejects %s", (ip) => expect(isPrivateIp(ip)).toBe(true));

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.0.1", "93.184.216.34", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "allows public %s", (ip) => expect(isPrivateIp(ip)).toBe(false));
});

describe("assertSafeUrl", () => {
  const pub = async () => ["93.184.216.34"];
  const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return e instanceof UnsafeUrlError ? e.code : "other"; } };

  it("accepts a public https host", async () => {
    expect((await assertSafeUrl("https://example.com/a", pub)).hostname).toBe("example.com");
  });
  it("rejects non-http schemes", async () => {
    expect(await code(assertSafeUrl("file:///etc/passwd", pub))).toBe("bad_scheme");
    expect(await code(assertSafeUrl("ftp://example.com", pub))).toBe("bad_scheme");
    expect(await code(assertSafeUrl("javascript:alert(1)", pub))).toBe("bad_scheme");
  });
  it("rejects localhost and literal private IPs", async () => {
    expect(await code(assertSafeUrl("http://localhost:3000", pub))).toBe("private_host");
    expect(await code(assertSafeUrl("http://127.0.0.1/", pub))).toBe("private_host");
    expect(await code(assertSafeUrl("http://[::1]/", pub))).toBe("private_host");
    expect(await code(assertSafeUrl("http://169.254.169.254/latest/meta-data", pub))).toBe("private_host");
    expect(await code(assertSafeUrl("http://2130706433/", pub))).toBe("private_host"); // decimal 127.0.0.1
  });
  it("rejects hostnames that RESOLVE to private IPs (DNS check)", async () => {
    expect(await code(assertSafeUrl("http://evil.example/", async () => ["10.0.0.5"]))).toBe("private_host");
    expect(await code(assertSafeUrl("http://evil.example/", async () => ["93.184.216.34", "192.168.0.10"]))).toBe("private_host");
  });
  it("rejects unresolved hosts and embedded credentials", async () => {
    expect(await code(assertSafeUrl("http://nope.example/", async () => { throw new Error("ENOTFOUND"); }))).toBe("dns_failed");
    expect(await code(assertSafeUrl("http://user:pw@example.com/", pub))).toBe("credentials_in_url");
  });
});
