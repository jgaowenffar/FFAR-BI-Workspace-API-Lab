import { createLab } from "../server/lab.mjs";
const lab = createLab();
export async function handleRequest(req, res, instance = lab) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const action =
    new URL(req.url, "http://lab").searchParams.get("action") || "status";
  const send = (status, data) => {
    res.statusCode = status;
    res.end(JSON.stringify(data));
  };
  try {
    if (req.method === "GET" && action === "status")
      return send(200, instance.status());
    if (
      !["GET", "POST"].includes(req.method) ||
      (["start", "step", "note", "storage-probe"].includes(action) &&
        req.method !== "POST") ||
      (action === "snapshot" && req.method !== "GET")
    )
      return send(405, { error: "Method not allowed." });
    let body = {};
    if (req.method === "POST") {
      let raw =
        req.body === undefined
          ? ""
          : typeof req.body === "string"
            ? req.body
            : JSON.stringify(req.body);
      if (req.body === undefined)
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 2500000)
            return send(413, { error: "Request too large." });
        }
      if (Buffer.byteLength(raw) > 2500000)
        return send(413, { error: "Request too large." });
      try {
        body = JSON.parse(raw);
      } catch {
        return send(400, { error: "Invalid JSON body." });
      }
    }
    const token = String(req.headers.authorization || "").replace(
      /^Bearer\s+/i,
      "",
    );
    return send(200, await instance.act(action, body, token));
  } catch (error) {
    return send(error.status || 400, { error: error.message });
  }
}
export default handleRequest;
