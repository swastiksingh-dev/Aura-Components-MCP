// http.test.mjs — bounded retry, error classification, timeout behavior.
import test from "node:test";
import assert from "node:assert/strict";
import { createFetcher } from "../src/http.mjs";

const res = ({ status = 200, json, text, range = "0-0/1" } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (k) => (k === "content-range" ? range : null) },
  json: async () => {
    if (json === "THROW") throw new SyntaxError("Unexpected token < in JSON");
    return json;
  },
  text: async () => (text !== undefined ? text : ""),
});
const cfg = (fetchImpl, retries = 2) => createFetcher({ fetchImpl, timeoutMs: 1000, retries, userAgent: "t" });

test("getJson retries 500s bounded, then succeeds", async () => {
  let calls = 0;
  const f = cfg(async () => (++calls <= 2 ? res({ status: 500 }) : res({ json: [{ id: 1 }], range: "0-0/7" })));
  const r = await f.getJson("http://x", {});
  assert.equal(calls, 3);
  assert.deepEqual(r, { rows: [{ id: 1 }], total: 7 });
});

test("getJson retries 429 then succeeds", async () => {
  let calls = 0;
  const f = cfg(async () => (++calls === 1 ? res({ status: 429 }) : res({ json: [] })));
  const r = await f.getJson("http://x", {});
  assert.equal(calls, 2);
  assert.deepEqual(r.rows, []);
});

test("getJson does not retry 4xx invalid requests", async () => {
  let calls = 0;
  const f = cfg(async () => { calls++; return res({ status: 400, text: "bad column" }); });
  await assert.rejects(() => f.getJson("http://x", {}), /upstream 400: bad column/);
  assert.equal(calls, 1, "a 400 can never succeed on retry");
});

test("getJson surfaces malformed JSON as failure, not empty success", async () => {
  const f = cfg(async () => res({ json: "THROW" }), 0);
  await assert.rejects(() => f.getJson("http://x", {}), SyntaxError);
});

test("getJson timeout aborts once without retry", async () => {
  let calls = 0;
  const direct = createFetcher({
    fetchImpl: async (url, { signal }) => {
      calls++;
      await new Promise((_, rej) => signal.addEventListener("abort", () => {
        const e = new Error("timeout after 50ms");
        e.name = "AbortError";
        rej(e);
      }));
    },
    timeoutMs: 50, retries: 2, userAgent: "t",
  });
  await assert.rejects(() => direct.getJson("http://x", {}), /timeout/);
  assert.equal(calls, 1, "hung request aborted once, never retried");
});

test("getText: 404 is null (miss), persistent 5xx throws, mixed 500-then-404 is null", async () => {
  const miss = cfg(async () => res({ status: 404 }), 0);
  assert.equal(await miss.getText("http://x", {}), null);
  let n = 0;
  const down = cfg(async () => { n++; return res({ status: 503 }); }, 2);
  await assert.rejects(() => down.getText("http://x", {}), /transient upstream status 503/);
  assert.equal(n, 3, "bounded: retries + 1 attempts");
  let m = 0;
  const flaky = cfg(async () => (++m === 1 ? res({ status: 500 }) : res({ status: 404 })), 2);
  assert.equal(await flaky.getText("http://x", {}), null);
});
