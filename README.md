# Research API Lab v2

A small standalone backend benchmark: public organization enrichment, meeting preparation, usage receipts and shared Supabase records. No existing application's interface, private methodology, proprietary dataset or production implementation is included.

## Start locally — no credentials needed

Requires Node 22 or newer.

```sh
npm ci
npm run dev
```

Open the URL printed by the server. Start a **Mock** comprehensive profile, select it as a saved organization, then run **Meeting preparation**. Inspect stage receipts and coverage. Mock fixtures contain no real research, financials or cost measurements.

Click **Write storage probe**, switch from Account A to Account B, and check the same organization/version IDs and note. Switch to Outsider: access must be denied. Local records live in `.lab-data/state.json`; restart the server to check persistence. This is a simulator, not proof of Supabase storage. Without Supabase, Vercel uses ephemeral `/tmp` files and cannot provide durable cross-instance storage; live calls are blocked.

## Connect Supabase

1. Create a separate test project and three email/password Auth accounts: A, B and an outsider. No application account creation or invitations are implemented.
2. Run both SQL migrations in filename order using the SQL editor. Existing v1 tables remain intact; v2 uses separate `lab2_*` tables.
3. Edit `supabase/setup-test-space.sql`: replace the two sample user UUIDs with A and B's real Auth UUIDs, then run it. Give the outsider no membership. The workspace UUID must match `LAB_WORKSPACE_ID`.
4. Copy `.env.example` to `.env.local`. Fill in `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, and `LAB_WORKSPACE_ID`. Keep `LIVE_API_ENABLED=false` initially. Restart the server after changing settings.
5. Sign in as A, write a storage probe and note. Sign out, sign in as B (or use another browser/device), reload and compare the same IDs. Add a note as B and read it as A. Sign in as the outsider; access must fail.

For a repeatable hosted smoke test, put three existing short-lived access tokens in the local `LAB_TEST_ACCESS_TOKEN_A`, `_B`, `_OUTSIDER` variables and run:

```sh
npm run smoke:supabase
```

This writes clearly labeled synthetic records, checks A/B sharing from a new server instance, checks outsider rejection and checks direct database RLS. It makes **zero OpenAI calls**. Access tokens and passwords must never be committed or pasted into logs. The script does not create accounts or assign membership.

All data in this test workspace, including source context and notes, is shared with its members. There is no private-user content layer. Viewers can read; editors can write. Only a workflow's creator can execute its stages. Auth tokens stay in browser memory, so reload may require sign-in again. Long-running tests may require signing in again after token expiry. No automatic session refresh is implemented.

## Run a paid representative benchmark

Set the server environment variable **`OPENAI_API_KEY`** to an active project key with access to the selected models and web search. Set **`LIVE_API_ENABLED=true`**, restart/redeploy, then choose **Live**. These secrets belong on the server, never in `public/` or a client-prefixed variable. Supabase Auth membership is required; a key alone does not enable live mode.

| Workflow                     | Calls                   | Routing and scope                                                                                         |
| ---------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Basic profile                | 1                       | Luna identity, organization type, entity scope, employees, HQ, fiscal year, activities and classification |
| Comprehensive hybrid profile | 7                       | Luna identity/people/news; Sol business, financials, projects/funding and consistency                     |
| Comprehensive Sol profile    | 7                       | Same staged public fields, Sol throughout                                                                 |
| Meeting preparation          | 2, or 3 with fresh news | Luna evidence selection; Sol analysis/questions. Sol recipe uses Sol throughout                           |
| Quick conversation brief     | 1                       | Luna using saved/supplied facts; Sol recipe uses Sol                                                      |
| Source extraction            | 1                       | Luna using supplied text; Sol recipe uses Sol                                                             |
| Organization news            | 1                       | Luna web research; Sol recipe uses Sol                                                                    |
| Landscape research           | 2                       | Sol discovery and synthesis                                                                               |
| Saved profile reuse          | 0                       | Returns latest saved version, no refresh or new version                                                   |

“Basic” limits profile scope; it does not mean every other workflow uses only Luna. The planned-call table shows actual models, reasoning, output and tool-call caps before execution. Comprehensive profiles request up to five public fiscal years, latest interim data, statement rows, segment data, leadership, competitors, projects and research/funding activity beyond a specific meeting purpose. Organization type controls which financial measures are appropriate. A financial output cap is 16,000 tokens; other stages are 6,000–10,000. Tool caps are 3–5 per web stage, not guarantees of complete discovery.

Each stage makes a real OpenAI Responses API request in Live mode. Prior stage results and the selected profile snapshot are passed to later calls and counted as input usage. The UI drives one stage per HTTP request; keep the tab open. Pause takes effect after the current stage. Resume starts only queued stages. A server timeout/crash can leave a stage `running` with unknown charge; it is deliberately not automatically reclaimed or retried. Check provider usage first. Receipt-save failures expose a JSON-exportable receipt. There is no production background worker.

### What the cost means

Receipts retain provider request/response IDs, input/output/cached usage, searches, timing, errors and estimated USD by stage and workflow. The rate snapshot is in `server/pricing.mjs`, checked 2026-11-12 against [official pricing](https://developers.openai.com/api/docs/pricing). Reasoning is already included in output tokens; search context is already included in input usage. Cache-write retention uncertainty produces a range; missing usage produces unknown cost and a known subtotal, never a fabricated zero. Estimates exclude hosting, Supabase, taxes and regional/long-context uplifts. Reconcile against provider billing.

This is a **representative public-field workload**, not a measured claim of parity with another application's backend. Different production prompts, retrieval, models, source access and retries will change price and quality. Compare Hybrid and Sol on the same organization and meeting goal, and inspect coverage and source accuracy together with price. A completed workflow means all stages finished; it does not mean all requested evidence exists or every source was independently verified. Mock mode cannot measure quality, actual latency or live cost.

## Deploy to Vercel

Upload this folder to your own Git repository and import it into Vercel:

- Framework: **Other**
- Install: **`npm ci`**
- Build: **`npm run build`**
- Output: **`public`**
- Node: **22+**
- Set the environment variables above in Vercel and redeploy.

`vercel.json` declares the Node API at `/api/lab` and a 120-second function duration. Verify your Vercel plan supports that duration; provider requests have a 95-second timeout. A deep web stage can exceed this and fail with an unknown/partial charge. No automatic paid retries occur. API keys are never returned by the status endpoint; only the public project URL/key and generic workflow plan are returned.

## Minimum storage architecture

The lab deliberately uses one small JSON document per test workspace with a revision-checked SQL write. It is a test adapter, not a recommended production data model. RLS allows members to read the shared document; browser writes and mutation-RPC execution are denied. The verified server performs writes; the RPC independently checks editor membership and compares revisions. Durable stage claims prevent duplicate calls across server instances. A changed claim is never regenerated automatically.

Organizations have stable IDs, separate entity scopes, numbered append-only profile versions and shared append-only notes. Domain alone never merges records. This simple identity key uses normalized name + domain + scope; it is not full entity resolution. Jobs pin their source version. Cache reuse creates no profile version. Complete enrichment creates a version; failed jobs retain partial output and receipts without creating a completed profile. Refreshing a basic profile produces a basic latest version; choose Comprehensive when you need the full scope.

Capacity is deliberately bounded: 40 workflows per workspace and an 8 MB state limit. The entire document is read/written, so this is unsuitable for thousands of organizations or production traffic. API input source text is capped at 32,000 characters; generated stage context over 600,000 characters is rejected rather than silently truncated. A claimed stage counts against the hourly live-call allowance even if its outcome is uncertain. Database records are tested here; binary file uploads, realtime notifications, production permissions, schema normalization, monitoring and UI integration remain separate work.

## Checks

```sh
npm test
npm run build
```

Tests use local files, simulated provider/Auth responses and actual PostgreSQL migrations through PGlite. See `VERIFICATION.md` for what was and was not verified. PGlite is a dev dependency only; the deployed API uses built-in Node APIs and HTTP.
