import { costFromUsage } from "./pricing.mjs";
import { sampleResult } from "../fixtures/sample.mjs";
import { validateResult } from "./contracts.mjs";
export async function generate(
  body,
  payload,
  { key, fetcher = fetch, timeoutMs = 95000 } = {},
) {
  if (body.mode === "mock")
    return {
      document: sampleResult(body.organization, body.stage),
      usage: null,
      searchCalls: 0,
      cost: {
        usd: 0,
        lowUsd: 0,
        highUsd: 0,
        note: "Mock mode: no provider request, no API charge.",
      },
      providerRequestId: null,
      responseId: null,
      model: body.model,
    };
  const started = Date.now();
  let response;
  try {
    response = await fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw Object.assign(
      new Error(
        "Provider connection timed out or failed. A charge may have occurred; do not automatically retry.",
      ),
      {
        code: "provider_connection_unknown",
        cost: { usd: null, lowUsd: null, highUsd: null },
        elapsedMs: Date.now() - started,
      },
    );
  }
  const requestId = response.headers.get("x-request-id");
  let data;
  try {
    data = await response.json();
  } catch {
    throw Object.assign(
      new Error("Provider returned unreadable data. Charge unknown."),
      { code: "provider_unreadable", providerRequestId: requestId },
    );
  }
  if (!response.ok)
    throw Object.assign(
      new Error(
        `Provider rejected the request (HTTP ${response.status}). Check the server key, model access, credits and project permissions.`,
      ),
      { code: "provider_rejected", providerRequestId: requestId },
    );
  const searchCalls = (data.output || []).filter(
    (x) => x.type === "web_search_call",
  ).length;
  const cost = costFromUsage(body.model, data.usage, searchCalls);
  const metadata = {
    usage: data.usage || null,
    searchCalls,
    cost,
    providerRequestId: requestId,
    responseId: data.id || null,
    model: data.model || body.model,
    searchSources: (data.output || [])
      .filter((x) => x.type === "web_search_call")
      .flatMap((x) => x.action?.sources || []),
  };
  if (data.status !== "completed")
    throw Object.assign(
      new Error(
        "Provider response is incomplete. Usage is retained; no automatic retry.",
      ),
      { code: "provider_incomplete", ...metadata },
    );
  const text = (data.output || [])
    .filter((x) => x.type === "message")
    .flatMap((x) => x.content || [])
    .filter((x) => x.type === "output_text")
    .map((x) => x.text)
    .join("");
  let document;
  try {
    document = JSON.parse(text);
  } catch {
    throw Object.assign(
      new Error("Provider response was not valid JSON. Usage is retained."),
      { code: "invalid_json", ...metadata },
    );
  }
  if (!validateResult(document))
    throw Object.assign(
      new Error(
        "Provider response did not match the test contract. Usage is retained.",
      ),
      { code: "invalid_contract", ...metadata },
    );
  return { document, ...metadata };
}
