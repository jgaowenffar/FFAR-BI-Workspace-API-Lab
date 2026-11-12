export const pricing = {
  checkedOn: "2026-11-12",
  currency: "USD",
  tier: "Standard, short context",
  source: "https://developers.openai.com/api/docs/pricing",
  searchPerCall: 0.01,
  models: {
    "gpt-6-luna": {
      input: 0.1,
      cached: 0.01,
      output: 0.5,
      write30m: 0.125,
      write12h: 0.25,
    },
    "gpt-6.1-sol": {
      input: 2,
      cached: 0.1,
      output: 10,
      write30m: 2.5,
      write12h: 5,
    },
  },
};
// Reasoning tokens are included in output_tokens; they are never added a second time.
// Search context tokens are included in provider input usage, not charged again here.
export function costFromUsage(model, usage, searchCalls = 0) {
  const rate = pricing.models[model];
  if (
    !rate ||
    !usage ||
    !Number.isFinite(usage.input_tokens) ||
    !Number.isFinite(usage.output_tokens)
  )
    return {
      usd: null,
      lowUsd: null,
      highUsd: null,
      note: "Usage unavailable; charge unknown.",
      pricing,
    };
  const input = usage.input_tokens,
    output = usage.output_tokens;
  const cached = usage.input_tokens_details?.cached_tokens || 0;
  const writes = usage.input_tokens_details?.cache_write_tokens || 0;
  if (
    [input, output, cached, writes, searchCalls].some(
      (v) => !Number.isFinite(v) || v < 0,
    ) ||
    cached + writes > input
  )
    return {
      usd: null,
      lowUsd: null,
      highUsd: null,
      note: "Unrecognized usage details; charge unknown.",
      pricing,
    };
  const ordinary = input - cached - writes;
  const base =
    (ordinary * rate.input + cached * rate.cached + output * rate.output) /
      1e6 +
    searchCalls * pricing.searchPerCall;
  const lowUsd = base + (writes * rate.write30m) / 1e6;
  const highUsd = base + (writes * rate.write12h) / 1e6;
  return {
    usd: writes ? null : base,
    lowUsd,
    highUsd,
    components: {
      ordinaryInput: ordinary,
      cachedInput: cached,
      cacheWriteInput: writes,
      output,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens || 0,
      searchCalls,
    },
    note: writes
      ? "Estimated range; cache-write retention is not known."
      : "Estimated from reported usage; not an invoice. Hosting, database, taxes and regional/long-context uplifts excluded.",
    pricing,
  };
}
