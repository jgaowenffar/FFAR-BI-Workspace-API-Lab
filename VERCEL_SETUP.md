# Vercel environment variables

## API tests now — Supabase is not required

| Name               | Value                                                               |
| ------------------ | ------------------------------------------------------------------- |
| `OPENAI_API_KEY`   | Your active OpenAI project API key                                  |
| `LIVE_API_ENABLED` | `true`                                                              |
| `LAB_ACCESS_TOKEN` | A random secret you choose, at least 24 characters; 32+ recommended |

Optional: `LAB_HOURLY_LIVE_CALLS=30`.

Leave `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` and `LAB_WORKSPACE_ID` unset/blank. Remove placeholder values if previously added. Redeploy after setting the variables. Open the app, enter the value of `LAB_ACCESS_TOKEN` in **Lab access key**, then choose **Live · paid API calls**.

The lab access key is a password for this test environment. It is separate from the OpenAI key; never enter the OpenAI key in the page. Variables are server settings, not `NEXT_PUBLIC_` or `VITE_` settings.

Without Supabase, saved records/history are temporary and not shared cloud records. In-progress staged runs carry signed receipts between server instances while the tab stays open. Do not retry an interrupted paid call without checking provider usage. Cross-instance replay protection and a global usage ledger require durable storage. The hourly allowance is per instance in standalone Vercel mode, not a guaranteed global spending limit.

## Cloud tests later — partner setup

After creating the Supabase project, applying both migrations and assigning test members, add:

| Name                       | Value                             |
| -------------------------- | --------------------------------- |
| `SUPABASE_URL`             | Supabase project URL              |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key          |
| `SUPABASE_SECRET_KEY`      | Supabase server secret key        |
| `LAB_WORKSPACE_ID`         | Workspace UUID from the setup SQL |

The supplied SQL uses `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa` for its workspace ID. Replace its sample Auth user IDs with real test users. In Supabase mode, sign in with those accounts; membership controls access. `LAB_ACCESS_TOKEN` is not used in that mode.

The local `LAB_TEST_ACCESS_TOKEN_*` variables are only for the optional storage smoke script, not required in Vercel.
