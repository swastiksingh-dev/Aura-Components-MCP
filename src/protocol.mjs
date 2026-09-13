// Module: protocol — stdio JSON-RPC framing + MCP handshake + error codes.
// One interface: createSession(send) -> { dispatch(msg) }. No business logic.

export const SERVER_INFO = { name: "aura-components-mcp", version: "1.0.0" };
export const PROTOCOL_VERSION = "2024-11-05";

const err = (code, message, data) => ({ code, message, ...(data === undefined ? {} : { data }) });
export const Errors = {
  parse: (m) => err(-32700, "Parse error" + (m ? ": " + m : "")),
  invalidRequest: (m) => err(-32600, "Invalid Request" + (m ? ": " + m : "")),
  methodNotFound: (m) => err(-32601, "Method not found: " + m),
  invalidParams: (m) => err(-32602, "Invalid params" + (m ? ": " + m : "")),
  upstream: (m) => err(-32000, "Upstream error" + (m ? ": " + m : "")),
  notFound: (m) => err(-32004, m || "Not found"),
};

export function textResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

export function createSession(send, { tools, handlers }) {
  let initialized = false;
  const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
  const fail = (id, e) => send({ jsonrpc: "2.0", id, error: e });

  async function dispatch(msg) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
      if (msg && "id" in msg && msg.id !== undefined && msg.id !== null) fail(msg.id, Errors.invalidRequest("bad envelope"));
      return;
    }
    const { id, method, params } = msg;
    const isCall = id !== undefined && id !== null;
    try {
      if (method === "initialize") {
        initialized = true;
        if (!isCall) return;
        return ok(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      }
      if (method === "notifications/initialized") return;
      if (method === "ping") { if (isCall) return ok(id, {}); return; }
      if (!initialized) { if (isCall) fail(id, Errors.invalidRequest("not initialized")); return; }
      if (method === "tools/list") { if (isCall) return ok(id, { tools }); return; }
      if (method === "tools/call") {
        if (!isCall) return;
        const name = params?.name;
        const args = params?.arguments ?? {};
        const h = handlers[name];
        if (!h) return fail(id, Errors.methodNotFound("tool " + name));
        try {
          const result = await h(args);
          return ok(id, result);
        } catch (e) {
          if (e && e.code === "NOT_FOUND") return fail(id, Errors.notFound(e.message));
          if (e && e.code === "BAD_ARGS") return fail(id, Errors.invalidParams(e.message));
          return fail(id, Errors.upstream(e?.message ?? String(e)));
        }
      }
      if (isCall) return fail(id, Errors.methodNotFound(method));
    } catch (e) {
      if (isCall) fail(id, Errors.upstream(e?.message ?? String(e)));
    }
  }

  return { dispatch };
}
