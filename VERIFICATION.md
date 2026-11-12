# Verification — v2.1

## Verified locally

- 18 automated tests passed; syntax/build check passed.
- Browser check completed a seven-stage synthetic profile and a two-stage meeting brief, retained the profile after server restart, showed A's saved note to B, and denied the outsider.

- Basic, comprehensive Hybrid and comprehensive Sol plans have distinct scopes and routing.
- Complete staged synthetic enrichment, saved profile retrieval, source-version pinning, meeting preparation, cache reuse and numbered refresh versions.
- Local persistence across separate backend instances; shared records/notes between two simulated members; outsider rejection.
- Stage order, duplicate request replay, concurrent stage-claim rejection and no repeated provider generation.
- Simulated live seven-stage receipts aggregate actual test-response usage; the per-stage hourly allowance blocks further calls.
- Responses API HTTP serialization, strict structured-result parsing, source metadata, search counts, incomplete/error usage retention and sanitized authentication errors using controlled HTTP responses.
- Cached token and reasoning accounting, unknown charges and cache-write ranges.
- Both SQL migrations executed in PGlite. Shared migration checks two-member/viewer reads, outsider/anonymous denial, client write/RPC denial, server membership validation and stale-revision rejection.
- Vercel pre-parsed JSON body handling, HTTP method restrictions and syntax/build checks.

- Standalone API mode enables without Supabase only when an API key, enabled switch and a long lab access key are configured. Missing/wrong access keys are rejected; signed workflow progress resumes on a fresh simulated server instance.

## Requires your credentials / deployment

- No paid OpenAI requests were made during this verification. Real model access, search quality, source accuracy, latency and cost require a Live run.
- No hosted Supabase project was available. Hosted Auth, REST/RPC behavior, actual cloud durability and cross-device access require `npm run smoke:supabase` or the documented A/B/outsider browser test.
- No Vercel deployment was made. Function duration/plan limits must be checked there.
- PGlite tests execute database logic but do not replace a real Supabase/PostgREST test.

The included hosted smoke script is executable, not a claim that it has already passed against your project. Mock storage probes are clearly labeled and make no AI calls.
