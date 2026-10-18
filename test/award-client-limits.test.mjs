// award-client-limits.test.mjs — bounded body reads (content-length, streaming
// oversize, cancel) and the client's network lifecycle (deadline covering the
// body read, retry budget, body cancel on non-consumed responses).
import test from "node:test";
import assert from "node:assert/strict";
import { awardReadBoundedBody, createAwardClient } from "../src/awards.mjs";

function streamOf(chunks, { onCancel } = {}) {
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          if (i >= chunks.length) return { done: true };
          const v = chunks[i++];
          if (v === "HANG") return new Promise(() => {});
          return { done: false, value: v };
        },
        async cancel() { if (onCancel) onCancel(); },
      };
    },
  };
}

test("bounded read: content-length over the cap fails before reading", async () => {
  const res = { headers: { get: () => String(10 * 1024 * 1024) }, body: streamOf(["never read"]), text: async () => "x" };
  await assert.rejects(() => awardReadBoundedBody(res, 1024, "page"), /exceeds/);
});

test("bounded read: streaming oversize aborts and cancels the stream", async () => {
  let cancelled = 0;
  const chunk = "a".repeat(2048);
  const res = { headers: { get: () => null }, body: streamOf([chunk, chunk], { onCancel: () => { cancelled++; } }) };
  await assert.rejects(() => awardReadBoundedBody(res, 3000, "page"), /exceeds/);
  assert.equal(cancelled, 1, "oversize cancels the body stream");
});

test("bounded read: lying/missing content-length cannot balloon via res.text()", async () => {
  const res = { headers: { get: () => null }, text: async () => "b".repeat(5000) };
  await assert.rejects(() => awardReadBoundedBody(res, 1000, "page"), /exceeds/);
  const fine = { text: async () => "ok" };
  assert.equal(await awardReadBoundedBody(fine, 1000, "page"), "ok");
  assert.equal(await awardReadBoundedBody({ text: async () => "" }, 1000, "page"), "");
});

test("bounded read: concatenates byte and string chunks in order", async () => {
  const res = { body: streamOf(["he", new TextEncoder().encode("llo "), "world"]) };
  assert.equal(await awardReadBoundedBody(res, 100, "page"), "hello world");
});

const reply = (status, { location = null, text = "", body = null } = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: (h) => (h === "location" ? location : null) },
  text: async () => text,
  body,
});

test("client: a stalled body read shares the request deadline (no hang, timeout error)", async () => {
  const client = createAwardClient({
    rateMs: 0, timeoutMs: 50,
    fetchImpl: async (url, { signal }) => reply(200, {
      body: {
        getReader: () => ({
          read: () => new Promise((_, reject) => { signal.addEventListener("abort", () => reject(new Error("aborted"))); }),
          cancel: async () => {},
        }),
      },
    }),
  });
  await assert.rejects(() => client.getAwardHtml("/sites/x"), (e) => e.code === "UPSTREAM_ERROR" && /timeout/i.test(e.message));
});

test("client: streaming oversize fails without retry (body canceled once)", async () => {
  let calls = 0, cancelled = 0;
  const chunk = new Uint8Array(1024 * 1024);
  const client = createAwardClient({
    rateMs: 0,
    fetchImpl: async () => {
      calls++;
      return reply(200, { body: { getReader: () => { let n = 0; return { read: async () => (n++ < 4 ? { done: false, value: chunk } : { done: true }), cancel: async () => { cancelled++; } }; } } });
    },
  });
  await assert.rejects(() => client.getAwardHtml("/sites/x"), (e) => e.code === "UPSTREAM_ERROR" && /exceeds/.test(e.message));
  assert.equal(calls, 1, "oversize is not retried");
  assert.ok(cancelled >= 1, "canceled the oversize stream");
});

test("client: redirects do not consume the retry budget (5xx after redirect still retried)", async () => {
  const calls = [];
  const client = createAwardClient({
    rateMs: 0,
    fetchImpl: async (url) => {
      calls.push(url);
      if (calls.length === 1) return reply(302, { location: "/sites/elsewhere" });
      if (calls.length === 2) return reply(503);
      return reply(200, { text: "ok" });
    },
  });
  const out = await client.getAwardHtml("/sites/x");
  assert.equal(out.html, "ok");
  assert.equal(calls.length, 3);
  assert.equal(calls[1], "https://www.awwwards.com/sites/elsewhere", "redirect resolved against the award host");
  assert.equal(out.finalUrl, "https://www.awwwards.com/sites/elsewhere");
});

test("client: non-consumed error responses cancel the body (socket released)", async () => {
  let cancelled = 0;
  const client = createAwardClient({ rateMs: 0, fetchImpl: async () => reply(404, { body: { cancel: async () => { cancelled++; } } }) });
  await assert.rejects(() => client.getAwardHtml("/sites/missing"), (e) => e.code === "NOT_FOUND");
  assert.equal(cancelled, 1);

  let blockedCancelled = 0;
  const blocking = createAwardClient({ rateMs: 0, fetchImpl: async () => reply(429, { body: { cancel: async () => { blockedCancelled++; } } }) });
  await assert.rejects(() => blocking.getAwardHtml("/sites/x"), (e) => e.blocked === true);
  assert.equal(blockedCancelled, 1, "429 body released before throwing");
});

test("client: oversize content-length short-circuits without reading", async () => {
  let calls = 0, reads = 0;
  const client = createAwardClient({
    rateMs: 0,
    fetchImpl: async () => {
      calls++;
      return { status: 200, ok: true, headers: { get: (h) => (h === "content-length" ? String(20 * 1024 * 1024) : null) }, body: { getReader: () => ({ read: async () => { reads++; return { done: true }; }, cancel: async () => {} }) } };
    },
  });
  await assert.rejects(() => client.getAwardHtml("/sites/x"), /exceeds/);
  assert.equal(calls, 1);
  assert.equal(reads, 0);
});
