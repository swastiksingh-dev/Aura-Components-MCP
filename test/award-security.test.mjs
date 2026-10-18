// award-security.test.mjs — P0 URL/local-network policy: parsed-address
// classification, the DNS resolution guard, guarded HTML fetch, and per-hop
// redirect validation in the award client.
import test from "node:test";
import assert from "node:assert/strict";
import {
  awardClassifyHost, awardIsBlockedHost, awardValidateHttpUrl,
  awardCheckHostResolution, createAwardClient, awardFetchGuardedHtml,
} from "../src/awards.mjs";

test("URL policy: private/link-local/metadata/ULA hosts never pass — allowLocal included", () => {
  const blocked = [
    "http://10.0.0.5/admin", "http://192.168.1.1/", "http://172.20.0.9/",
    "http://100.100.100.200/", // CGNAT (Alibaba metadata)
    "http://169.254.1.1/", "http://[fe80::1]/", "http://[fc00::1]/",
    "http://169.254.169.254/latest/meta-data/", "http://metadata.google.internal/",
    "http://metadata.goog/", "http://[::ffff:a9fe:a9fe]/",
    "http://0.0.0.0/", "http://192.0.2.10/", "http://printer.local/",
  ];
  for (const u of blocked) for (const allowLocal of [false, true]) {
    assert.throws(() => awardValidateHttpUrl(u, { allowLocal }), (e) => e.code === "UNSUPPORTED_OPERATION", u + " allowLocal=" + allowLocal);
    assert.equal(awardIsBlockedHost(new URL(u).hostname), true, "isBlockedHost agrees for " + u);
  }
});

test("URL policy: loopback passes only with allowLocal:true (IPv4, IPv6, mapped)", () => {
  for (const u of ["http://127.0.0.1:5173/", "http://localhost:3000/x", "http://[::1]:8080/", "http://[::ffff:127.0.0.1]/"]) {
    assert.throws(() => awardValidateHttpUrl(u, {}), (e) => e.code === "UNSUPPORTED_OPERATION", u);
    assert.equal(typeof awardValidateHttpUrl(u, { allowLocal: true }), "string", u + " with allowLocal");
  }
});

test("URL policy: WHATWG canonicalization catches alternate IPv4 spellings", () => {
  // 0x7f000001 and 2130706433 normalize to 127.0.0.1 inside the WHATWG URL.
  for (const u of ["http://0x7f000001/", "http://2130706433/"]) {
    assert.throws(() => awardValidateHttpUrl(u, {}), (e) => e.code === "UNSUPPORTED_OPERATION", u);
  }
});

test("URL policy: scheme/credentials/parse errors are BAD_ARGS, public urls pass", () => {
  assert.throws(() => awardValidateHttpUrl("ftp://example.com/", {}), (e) => e.code === "BAD_ARGS");
  assert.throws(() => awardValidateHttpUrl("file:///etc/passwd", {}), (e) => e.code === "BAD_ARGS");
  assert.throws(() => awardValidateHttpUrl("http://user:pass@example.com/", {}), (e) => e.code === "BAD_ARGS");
  assert.throws(() => awardValidateHttpUrl("", {}), (e) => e.code === "BAD_ARGS");
  assert.throws(() => awardValidateHttpUrl("not a url", {}), (e) => e.code === "BAD_ARGS");
  assert.equal(awardValidateHttpUrl("https://example.com/a", {}), "https://example.com/a");
});

test("host classification kinds are stable for policy call sites", () => {
  assert.equal(awardClassifyHost("10.0.0.1").kind, "private");
  assert.equal(awardClassifyHost("127.0.0.1").kind, "loopback");
  assert.equal(awardClassifyHost("localhost").kind, "loopback");
  assert.equal(awardClassifyHost("example.com").kind, "public");
  assert.equal(awardClassifyHost("169.254.169.254").kind, "link-local");
  assert.equal(awardClassifyHost("::1").kind, "loopback");
  assert.equal(awardClassifyHost("fe80::1").kind, "link-local");
  assert.equal(awardClassifyHost("fc00::1").kind, "private");
  assert.equal(awardClassifyHost("2001:db8::1").kind, "reserved");
  assert.equal(awardIsBlockedHost("example.com"), false);
  assert.equal(awardIsBlockedHost("192.168.0.1"), true);
});

test("IPv6 compression parses fully: public AAAA addresses are public, not 'invalid'", () => {
  // Regression: a miscounted '::' fill made every compressed IPv6 unparseable,
  // so ANY dual-stack hostname was treated as resolving to a blocked address.
  assert.equal(awardClassifyHost("2606:4700:4700::1111").kind, "public");
  assert.equal(awardClassifyHost("2404:6800:4003:c00::64").kind, "public");
  assert.equal(awardClassifyHost("64:ff9b::8.8.8.8").kind, "public", "NAT64 with public v4 is public");
  assert.equal(awardClassifyHost("64:ff9b::10.0.0.5").kind, "private", "NAT64 with private v4 stays blocked");
});

test("DNS guard: any blocked answer blocks the host; public-only passes", async () => {
  const mk = (addrs) => async () => addrs;
  const priv = await awardCheckHostResolution("https://sneaky.example/", { lookup: mk([{ address: "10.1.2.3" }]) });
  assert.equal(priv.checked, true);
  assert.equal(priv.blocked, true);
  assert.deepEqual(priv.blockedAddresses, ["10.1.2.3"]);
  const mixed = await awardCheckHostResolution("https://sneaky.example/", { lookup: mk([{ address: "93.184.216.34" }, { address: "169.254.169.254" }]) });
  assert.equal(mixed.blocked, true, "one blocked answer is enough to block");
  const pub = await awardCheckHostResolution("https://example.com/", { lookup: mk([{ address: "93.184.216.34" }]) });
  assert.equal(pub.blocked, false);
  assert.equal(pub.checked, true);
  const dual = await awardCheckHostResolution("https://example.com/", { lookup: mk([{ address: "93.184.216.34" }, { address: "2606:4700:4700::1111" }]) });
  assert.equal(dual.blocked, false, "public AAAA answers must not block a dual-stack host");
});

test("DNS guard: failure/timeout is best-effort; loopback relaxed only by allowLocal", async () => {
  const fail = await awardCheckHostResolution("https://flaky.example/", { lookup: async () => { throw new Error("NXDOMAIN"); } });
  assert.equal(fail.blocked, false, "a failed lookup is not an error here");
  assert.equal(fail.checked, false);
  assert.match(fail.reason, /dns lookup failed/);
  const slow = await awardCheckHostResolution("https://slow.example/", { lookup: () => new Promise(() => {}), timeoutMs: 25 });
  assert.equal(slow.blocked, false);
  assert.match(slow.reason, /timed out/);
  const lo = async () => [{ address: "127.0.0.1" }];
  assert.equal((await awardCheckHostResolution("https://dev.example/", { lookup: lo })).blocked, true);
  assert.equal((await awardCheckHostResolution("https://dev.example/", { lookup: lo, allowLocal: true })).blocked, false);
  // IP literals were classified at validation time; the guard must not need DNS.
  const literal = await awardCheckHostResolution("https://10.0.0.9/", { lookup: async () => { throw new Error("must not be called"); } });
  assert.equal(literal.checked, true);
  assert.equal(literal.reason, null);
});

test("guarded fetch: blocked/redirected targets return honest reasons, never a body", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (calls.length === 1) return { status: 302, ok: false, headers: { get: (h) => (h === "location" ? "http://192.168.1.1/landing" : null) } };
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => "should never be read" };
  };
  const blocked = await awardFetchGuardedHtml("https://example.com/", { fetchImpl, label: "t" });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /private-network|blocked/);
  assert.equal(calls.length, 1, "redirect target rejected before fetching it");
  // Redirect leaving to a metadata host is refused too.
  const meta = await awardFetchGuardedHtml("https://example.com/", { fetchImpl: async () => ({ status: 301, ok: false, headers: { get: () => "http://169.254.169.254/" } }), label: "t" });
  assert.equal(meta.ok, false);
  assert.match(meta.reason, /link-local|never fetched/);
  // Empty input is the only contract violation that throws.
  await assert.rejects(() => awardFetchGuardedHtml("", {}), (e) => e.code === "BAD_ARGS");
});

test("guarded fetch: manual redirects capped, DNS-blocked first hop refused", async () => {
  let hops = 0;
  const looping = async () => { hops++; return { status: 302, ok: false, headers: { get: () => "https://example.com/again" } }; };
  const r = await awardFetchGuardedHtml("https://example.com/", { fetchImpl: looping, label: "t" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /too many redirects/);
  assert.equal(hops, 4, "4 fetches (initial + 3 redirects) then refuse");
  const dns = await awardFetchGuardedHtml("https://rebind.example/", { fetchImpl: async () => { throw new Error("must not fetch"); }, lookup: async () => [{ address: "10.0.0.5" }], label: "t" });
  assert.equal(dns.ok, false);
  assert.match(dns.reason, /resolves to a blocked address/);
});

test("award client: redirect hops are re-validated (SSRF + host allow-list)", async () => {
  const calls = [];
  const client = createAwardClient({
    rateMs: 0,
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) return { status: 302, ok: false, headers: { get: (h) => (h === "location" ? "http://169.254.169.254/latest/meta-data/" : null) } };
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => "SHOULD NOT REACH" };
    },
  });
  await assert.rejects(() => client.getAwardHtml("/sites/x"), (e) => e.code === "UNSUPPORTED_OPERATION");
  assert.equal(calls.length, 1, "blocked redirect target never fetched");

  const evil = createAwardClient({ rateMs: 0, fetchImpl: async () => ({ status: 301, ok: false, headers: { get: () => "https://evil.example/steal" } }) });
  await assert.rejects(() => evil.getAwardHtml("/sites/x"), (e) => e.code === "UPSTREAM_ERROR" && /leaves award hosts/.test(e.message));

  const okCalls = [];
  const ok = createAwardClient({
    rateMs: 0,
    fetchImpl: async (url) => {
      okCalls.push(url);
      if (okCalls.length === 1) return { status: 302, ok: false, headers: { get: (h) => (h === "location" ? "https://www.awwwards.com/sites/other" : null) } };
      return { status: 200, ok: true, headers: { get: () => null }, text: async () => "<html>ok</html>" };
    },
  });
  const out = await ok.getAwardHtml("/sites/x");
  assert.equal(out.html, "<html>ok</html>");
  assert.equal(okCalls.length, 2);
  assert.equal(okCalls[1], "https://www.awwwards.com/sites/other");

  const loop = createAwardClient({ rateMs: 0, fetchImpl: async () => ({ status: 307, ok: false, headers: { get: () => "/sites/x" } }) });
  await assert.rejects(() => loop.getAwardHtml("/sites/x"), (e) => /too many redirects/.test(e.message));
});
