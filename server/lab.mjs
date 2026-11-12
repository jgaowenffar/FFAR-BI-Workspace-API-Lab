import {
  randomUUID,
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  operations,
  recipes,
  makePlan,
  validateRequest,
  buildProviderRequest,
  mergeDocuments,
  coverage,
  uuid,
} from "./contracts.mjs";
import { pricing } from "./pricing.mjs";
import { createStore, fail } from "./store.mjs";
import { generate } from "./provider.mjs";
const now = () => new Date().toISOString();
const zero = (note) => ({ usd: 0, lowUsd: 0, highUsd: 0, note });
const unknown = () => ({
  usd: null,
  lowUsd: null,
  highUsd: null,
  note: "Charge unknown. Check provider usage before creating another workflow.",
});
export function configuration(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL || "";
  if (
    supabaseUrl &&
    !(
      supabaseUrl.startsWith("https://") ||
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(supabaseUrl)
    )
  )
    throw new Error("Use HTTPS or a local Supabase URL.");
  return {
    supabaseUrl,
    supabasePublishable: env.SUPABASE_PUBLISHABLE_KEY || "",
    supabaseSecret:
      env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "",
    workspaceId: env.LAB_WORKSPACE_ID || "",
    openaiKey: env.OPENAI_API_KEY || "",
    localAccessToken: env.LAB_ACCESS_TOKEN || "",
    enabled: env.LIVE_API_ENABLED === "true",
    allowedUsers: (env.LAB_ALLOWED_USER_IDS || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    hourlyLimit: Math.min(
      100,
      Math.max(1, Number(env.LAB_HOURLY_LIVE_CALLS) || 30),
    ),
    localFile: env.LAB_LOCAL_FILE || "",
  };
}
export function totals(steps) {
  const attempted = steps.filter((s) => s.status !== "queued");
  const knownSubtotalUsd = attempted.reduce(
    (sum, s) => sum + (s.cost?.usd ?? 0),
    0,
  );
  const uncertain = attempted.filter((s) => s.cost?.usd == null).length;
  return {
    usd: uncertain ? null : knownSubtotalUsd,
    knownSubtotalUsd,
    uncertainStages: uncertain,
    providerCalls: attempted.filter((s) => s.mode === "live").length,
    searchCalls: attempted.reduce((sum, s) => sum + (s.searchCalls || 0), 0),
    inputTokens: attempted.reduce(
      (sum, s) => sum + (s.usage?.input_tokens || 0),
      0,
    ),
    outputTokens: attempted.reduce(
      (sum, s) => sum + (s.usage?.output_tokens || 0),
      0,
    ),
    complete: steps.every((s) => s.status === "complete"),
  };
}
function findJob(state, id) {
  const job = state.jobs.find((j) => j.id === id);
  if (!job) throw fail("Workflow not found.", 404);
  return job;
}
function orgKey(input) {
  return createHash("sha256")
    .update(
      [input.organization, input.domain || "", input.entityScope || ""]
        .map((x) => x.trim().toLowerCase().replace(/\s+/g, " "))
        .join("|"),
    )
    .digest("hex");
}
function findOrCreateOrg(state, input) {
  const key = orgKey(input);
  let org = state.organizations.find((o) => o.key === key);
  if (!org) {
    org = {
      id: randomUUID(),
      key,
      name: input.organization.trim(),
      domain: input.domain || "",
      entityScope: input.entityScope || "",
      createdAt: now(),
      versions: [],
    };
    state.organizations.push(org);
  }
  return org;
}
function finishDocument(job) {
  job.document = mergeDocuments(
    job.steps.filter((s) => s.document).map((s) => s.document),
  );
  job.coverage = coverage(
    job.document,
    job.operation === "profile" && job.recipe !== "basic"
      ? undefined
      : job.steps.flatMap((s) => s.sections),
  );
  job.total = totals(job.steps);
}
export function createLab({
  config = configuration(),
  store = createStore(config),
  generator = generate,
} = {}) {
  const ready = !!(
    config.supabaseUrl &&
    config.supabasePublishable &&
    config.supabaseSecret &&
    uuid.test(config.workspaceId)
  );
  const standalone = store.kind !== "supabase";
  const standaloneReady = (config.localAccessToken || "").length >= 24;
  const live =
    (standalone ? standaloneReady : ready) &&
    config.enabled &&
    !!config.openaiKey;
  const seal = (job) => {
    if (!standaloneReady || !standalone) return {};
    const data = Buffer.from(
      JSON.stringify({ expires: Date.now() + 86400000, job }),
    ).toString("base64url");
    return {
      jobToken:
        data +
        "." +
        createHmac("sha256", config.openaiKey || config.localAccessToken)
          .update("research-job-v1:")
          .update(data)
          .digest("base64url"),
    };
  };
  const unseal = (token) => {
    if (!standaloneReady || typeof token !== "string" || token.length > 2000000)
      throw fail("Missing or oversized temporary workflow receipt.", 400);
    const [data, signature, extra] = token.split(".");
    const expected = createHmac(
      "sha256",
      config.openaiKey || config.localAccessToken,
    )
      .update("research-job-v1:")
      .update(data || "")
      .digest();
    const supplied = Buffer.from(signature || "", "base64url");
    if (
      extra ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      throw fail("Invalid temporary workflow receipt.", 403);
    let parsed;
    try {
      parsed = JSON.parse(Buffer.from(data, "base64url"));
    } catch {
      throw fail("Invalid temporary workflow receipt.");
    }
    if (!parsed.expires || parsed.expires < Date.now() || !parsed.job)
      throw fail("Temporary workflow receipt expired.");
    return parsed.job;
  };
  return {
    status() {
      return {
        version: "0.2.1",
        backend: store.kind,
        ready: store.kind !== "supabase" || ready,
        liveEnabled: live,
        accessKeyRequired: standalone && !!config.localAccessToken,
        signInUrl: config.supabaseUrl,
        publishableKey: config.supabasePublishable,
        workspaceId: config.workspaceId,
        operations,
        recipes,
        plans: Object.fromEntries(
          Object.keys(operations).map((op) => [
            op,
            Object.fromEntries(
              Object.keys(recipes).map((recipe) => [
                recipe,
                makePlan(op, recipe),
              ]),
            ),
          ]),
        ),
        pricing,
        hourlyLiveCalls: config.hourlyLimit,
        message:
          store.kind === "supabase"
            ? "Shared Supabase test workspace. Only verified members can read; editors can run and add notes."
            : store.kind === "local-file"
              ? "Local test storage, not hosted cloud storage. " +
                (live
                  ? "Live API tests are enabled with the lab access key."
                  : "Paid calls require OPENAI_API_KEY, LIVE_API_ENABLED=true and a LAB_ACCESS_TOKEN of at least 24 characters.")
              : "Temporary Vercel test storage. Results/history may disappear between instances or deployments. " +
                (live
                  ? "Live API tests are enabled with the lab access key; cloud sharing still requires Supabase."
                  : "Paid calls require OPENAI_API_KEY, LIVE_API_ENABLED=true and a LAB_ACCESS_TOKEN of at least 24 characters."),
      };
    },
    async act(action, body = {}, token) {
      if (store.kind === "supabase" && !ready)
        throw fail("Complete Supabase settings and LAB_WORKSPACE_ID.", 503);
      const user = await store.authenticate(token);
      if (action === "snapshot")
        return {
          ...(await store.read(user)),
          account: { id: user.id, role: user.role },
          backend: store.kind,
        };
      if (action === "note") {
        if (
          !uuid.test(body.organizationId || "") ||
          typeof body.text !== "string" ||
          !body.text.trim() ||
          body.text.length > 4000 ||
          !uuid.test(body.requestId || "")
        )
          throw fail(
            "Choose an organization and supply a note (up to 4,000 characters) and request UUID.",
          );
        return store.transact(user, (state) => {
          if (!state.organizations.some((o) => o.id === body.organizationId))
            throw fail("Organization not found.", 404);
          const existing = state.notes.find((n) => n.id === body.requestId);
          if (existing) {
            if (
              existing.author !== user.id ||
              existing.organizationId !== body.organizationId ||
              existing.text !== body.text.trim()
            )
              throw fail("Request ID already used.", 409);
            return { note: existing, replayed: true };
          }
          const note = {
            id: body.requestId,
            organizationId: body.organizationId,
            author: user.id,
            text: body.text.trim(),
            createdAt: now(),
          };
          state.notes.push(note);
          return { note };
        });
      }
      if (action === "storage-probe") {
        if (!uuid.test(body.requestId || ""))
          throw fail("A UUID requestId is required.");
        return store.transact(user, (state) => {
          const previous = state.notes.find((n) => n.id === body.requestId);
          if (previous)
            return {
              organizationId: previous.organizationId,
              noteId: previous.id,
              probe: true,
              replayed: true,
              backend: store.kind,
              apiCalls: 0,
            };
          const org = findOrCreateOrg(state, {
            organization: "Storage probe " + body.requestId,
            entityScope: "synthetic",
          });
          const version = {
            id: randomUUID(),
            version: 1,
            createdAt: now(),
            createdBy: user.id,
            mode: "mock",
            jobId: null,
            document: {
              title: "Synthetic storage probe",
              summary: "No research was performed.",
              sections: [],
              financials: [],
              questions: [],
              gaps: ["Storage test only."],
            },
          };
          org.versions.push(version);
          const note = {
            id: body.requestId,
            organizationId: org.id,
            author: user.id,
            text: "Shared storage probe " + body.requestId,
            createdAt: now(),
          };
          state.notes.push(note);
          return {
            organizationId: org.id,
            versionId: version.id,
            noteId: note.id,
            createdBy: user.id,
            backend: store.kind,
            apiCalls: 0,
          };
        });
      }
      if (action === "start") {
        validateRequest(body);
        if (body.mode === "live" && !live)
          throw fail(
            "Live calls are disabled. Set OPENAI_API_KEY and LIVE_API_ENABLED=true. Without Supabase, also set LAB_ACCESS_TOKEN to at least 24 characters.",
            403,
          );
        const started = await store.transact(user, (state) => {
          const previous = state.jobs.find((j) => j.id === body.requestId);
          if (previous) {
            if (previous.createdBy !== user.id)
              throw fail("Request ID already used.", 409);
            return { job: previous, replayed: true };
          }
          if (state.jobs.length >= 40)
            throw fail(
              "This small sandbox holds 40 workflows. Use a fresh test workspace for further benchmarking.",
              409,
            );
          const input = {
            organization: body.organization.trim(),
            domain: (body.domain || "").trim(),
            entityScope: (body.entityScope || "").trim(),
            organizationType: body.organizationType || "",
            goal: body.goal || "",
            context: body.context || "",
          };
          const selected = body.profileId
            ? state.organizations.find((o) => o.id === body.profileId)
            : null;
          if (body.profileId && !selected)
            throw fail("Saved organization not found.", 404);
          if (selected && orgKey(input) !== selected.key)
            throw fail(
              "Saved organization identity/scope differs. Load its saved identity or start a separate organization.",
            );
          const sourceVersion = selected?.versions.at(-1) || null;
          if (body.mode === "live" && sourceVersion?.mode === "mock")
            throw fail(
              "Synthetic profiles cannot supply live research. Deselect the profile and supply public source text.",
            );
          if (
            operations[body.operation].context &&
            !sourceVersion &&
            !input.context.trim()
          )
            throw fail("Select a saved profile or supply source text.");
          const org =
            selected ||
            (body.operation === "profile"
              ? findOrCreateOrg(state, input)
              : null);
          const reuse =
            body.operation === "profile" &&
            body.reuseProfile === true &&
            sourceVersion;
          const job = {
            id: body.requestId,
            createdBy: user.id,
            createdAt: now(),
            organizationId: org?.id || null,
            sourceVersionId: sourceVersion?.id || null,
            sourceDocument: sourceVersion?.document || null,
            input,
            operation: body.operation,
            recipe: body.recipe,
            mode: body.mode,
            status: reuse ? "complete" : "queued",
            reused: !!reuse,
            reviewed: false,
            steps: reuse
              ? []
              : makePlan(
                  body.operation,
                  body.recipe,
                  body.freshNews === true,
                ).map((stage) => ({
                  ...stage,
                  mode: body.mode,
                  status: "queued",
                })),
          };
          if (reuse) {
            job.document = sourceVersion.document;
            job.total = { ...totals([]), usd: 0 };
            job.coverage = coverage(job.document);
            job.completedAt = now();
          }
          state.jobs.push(job);
          return { job };
        });
        return { ...started, ...seal(started.job) };
      }
      if (action !== "step") throw fail("Unknown action.", 404);
      if (!uuid.test(body.jobId || "") || !Number.isInteger(body.stageIndex))
        throw fail("Workflow ID and stage index required.");
      const claim = await store.transact(user, (state) => {
        if (
          standalone &&
          !state.jobs.some((j) => j.id === body.jobId) &&
          body.jobToken
        ) {
          const restored = unseal(body.jobToken);
          if (restored.id !== body.jobId || restored.createdBy !== user.id)
            throw fail("Workflow receipt does not match this request.", 403);
          state.jobs.push(restored);
          if (
            restored.organizationId &&
            !state.organizations.some((o) => o.id === restored.organizationId)
          )
            state.organizations.push({
              id: restored.organizationId,
              key: orgKey(restored.input),
              name: restored.input.organization,
              domain: restored.input.domain,
              entityScope: restored.input.entityScope,
              createdAt: now(),
              versions: [],
            });
        }
        const job = findJob(state, body.jobId);
        if (job.createdBy !== user.id)
          throw fail(
            "Only the workflow creator can execute its paid stages.",
            403,
          );
        if (job.mode === "live" && !live)
          throw fail("Live calls are disabled.", 403);
        const stage = job.steps[body.stageIndex];
        if (!stage) throw fail("Stage not found.", 404);
        if (stage.status === "complete" || stage.status === "failed")
          return { replayed: true, job };
        if (stage.status === "running")
          throw fail(
            "Stage already claimed. If interrupted, its charge is unknown; it will not be retried automatically.",
            409,
          );
        if (
          job.steps
            .slice(0, body.stageIndex)
            .some((s) => s.status !== "complete")
        )
          throw fail("Complete preceding stages first.", 409);
        const hourly = state.jobs
          .filter((j) => j.createdBy === user.id)
          .flatMap((j) => j.steps)
          .filter(
            (s) =>
              s.mode === "live" &&
              s.startedAt &&
              Date.parse(s.startedAt) > Date.now() - 3600000,
          ).length;
        if (job.mode === "live" && hourly >= config.hourlyLimit)
          throw fail("Hourly live-call limit reached. Resume later.", 429);
        stage.status = "running";
        stage.claim = randomUUID();
        stage.startedAt = now();
        stage.cost =
          job.mode === "mock"
            ? zero("Synthetic run; no API charge.")
            : unknown();
        job.status = "running";
        job.total = totals(job.steps);
        return { job: structuredClone(job), stage: structuredClone(stage) };
      });
      if (claim.replayed) return { ...claim, ...seal(claim.job) };
      const { job, stage } = claim;
      const started = Date.now();
      let patch;
      let sent = false;
      try {
        const documents = [
          ...(job.sourceDocument ? [job.sourceDocument] : []),
          ...job.steps.filter((s) => s.document).map((s) => s.document),
        ];
        const payload = buildProviderRequest(job.input, stage, documents);
        if (payload.input.length > 600000)
          throw fail(
            "Context exceeds this short-context benchmark limit. Use a smaller source set.",
          );
        sent = true;
        const generated = await generator(
          { ...job.input, mode: job.mode, model: stage.model, stage },
          payload,
          { key: config.openaiKey },
        );
        patch = {
          ...generated,
          status: "complete",
          completedAt: now(),
          elapsedMs: Date.now() - started,
        };
      } catch (error) {
        patch = {
          status: "failed",
          error: error.message,
          errorCode: error.code || "stage_failed",
          usage: error.usage || null,
          searchCalls: error.searchCalls || 0,
          providerRequestId: error.providerRequestId || null,
          cost:
            error.cost ||
            (sent && job.mode === "live"
              ? unknown()
              : zero("No provider call completed.")),
          elapsedMs: Date.now() - started,
          completedAt: now(),
        };
      }
      try {
        const finished = await store.transact(user, (state) => {
          const current = findJob(state, job.id),
            target = current.steps[stage.index];
          if (target.claim !== stage.claim || target.status !== "running")
            throw fail("Stage receipt conflict; no automatic retry.", 409);
          Object.assign(target, patch);
          delete target.claim;
          current.status =
            target.status === "failed"
              ? "failed"
              : current.steps.every((s) => s.status === "complete")
                ? "complete"
                : "queued";
          finishDocument(current);
          if (current.status === "complete") {
            current.completedAt = now();
            if (current.operation === "profile") {
              const org = state.organizations.find(
                (o) => o.id === current.organizationId,
              );
              const version = {
                id: randomUUID(),
                version: (org.versions.at(-1)?.version || 0) + 1,
                mode: current.mode,
                recipe: current.recipe,
                createdAt: now(),
                createdBy: user.id,
                jobId: current.id,
                document: current.document,
                coverage: current.coverage,
              };
              org.versions.push(version);
              current.savedVersionId = version.id;
            }
          }
          return { job: current };
        });
        return { ...finished, ...seal(finished.job) };
      } catch {
        return {
          jobId: job.id,
          persisted: false,
          receipt: patch,
          error:
            "Provider stage ended, but its receipt could not be saved. Export this receipt and inspect provider usage. Do not rerun the stage.",
        };
      }
    },
  };
}
