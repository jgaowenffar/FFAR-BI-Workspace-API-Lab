import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID, createHash, timingSafeEqual } from "node:crypto";
export const demoUser = "11111111-1111-4111-8111-111111111111";
export const secondUser = "22222222-2222-4222-8222-222222222222";
export const emptyState = () => ({ organizations: [], jobs: [], notes: [] });
export const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const queues = new Map();
export function createStore(config, fetcher = fetch) {
  if (!config.supabaseUrl) {
    const file = resolve(
      config.localFile ||
        (process.env.VERCEL
          ? "/tmp/research-api-lab/state.json"
          : ".lab-data/state.json"),
    );
    const read = async () => {
      try {
        return JSON.parse(await readFile(file, "utf8"));
      } catch (error) {
        if (error.code === "ENOENT") return emptyState();
        throw error;
      }
    };
    return {
      kind: process.env.VERCEL ? "local-ephemeral" : "local-file",
      async authenticate(token) {
        if (config.localAccessToken) {
          const hash = (value) =>
            createHash("sha256")
              .update(String(value || ""))
              .digest();
          if (!timingSafeEqual(hash(token), hash(config.localAccessToken)))
            throw fail(
              "Enter the lab access key to unlock this test environment.",
              401,
            );
          return { id: demoUser, role: "editor" };
        }
        if (!["demo-a", "demo-b"].includes(token))
          throw fail(
            token === "demo-outsider"
              ? "This account is not a member of the test workspace."
              : "Select a local test account.",
            token === "demo-outsider" ? 403 : 401,
          );
        return {
          id: token === "demo-a" ? demoUser : secondUser,
          role: "editor",
        };
      },
      read: async () => read(),
      async transact(user, mutate) {
        if (user.role !== "editor")
          throw fail("Editor membership required.", 403);
        const previous = queues.get(file) || Promise.resolve();
        const task = previous
          .catch(() => {})
          .then(async () => {
            const state = await read();
            const result = mutate(state);
            const json = JSON.stringify(state);
            if (Buffer.byteLength(json) > 8_000_000)
              throw fail(
                "Sandbox capacity reached. Use a fresh test workspace.",
                409,
              );
            await mkdir(dirname(file), { recursive: true });
            const temp = file + "." + randomUUID() + ".tmp";
            await writeFile(temp, json, { mode: 0o600 });
            await rename(temp, file);
            return result;
          });
        queues.set(file, task);
        return task;
      },
    };
  }
  const base = config.supabaseUrl.replace(/\/$/, "");
  async function rest(path, { method = "GET", body, token } = {}) {
    const r = await fetcher(base + "/rest/v1/" + path, {
      method,
      headers: {
        apikey: token ? config.supabasePublishable : config.supabaseSecret,
        ...(token || config.supabaseSecret.startsWith("eyJ")
          ? { Authorization: "Bearer " + (token || config.supabaseSecret) }
          : {}),
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok)
      throw fail(
        "Database request failed. Check migrations, workspace membership and server settings.",
        503,
      );
    return r.status === 204 ? null : r.json();
  }
  return {
    kind: "supabase",
    async authenticate(token) {
      if (!token) throw fail("Sign in to the test project.", 401);
      const response = await fetcher(base + "/auth/v1/user", {
        headers: {
          apikey: config.supabasePublishable,
          Authorization: "Bearer " + token,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok)
        throw fail("Session expired or invalid. Sign in again.", 401);
      const user = await response.json();
      if (
        !user.id ||
        (config.allowedUsers.length && !config.allowedUsers.includes(user.id))
      )
        throw fail("This account is not allowed to use the lab.", 403);
      const membership = await rest(
        "lab2_memberships?" +
          new URLSearchParams({
            workspace_id: "eq." + config.workspaceId,
            user_id: "eq." + user.id,
            select: "role",
          }),
        { token },
      );
      if (!membership?.[0])
        throw fail("This account is not a member of the test workspace.", 403);
      return { id: user.id, role: membership[0].role, token };
    },
    async read(user) {
      const rows = await rest(
        "lab2_workspaces?" +
          new URLSearchParams({
            id: "eq." + config.workspaceId,
            select: "state,revision",
          }),
        { token: user.token },
      );
      if (!rows?.[0]) throw fail("Test workspace unavailable.", 403);
      return rows[0].state;
    },
    async transact(user, mutate) {
      if (user.role !== "editor")
        throw fail("Editor membership required.", 403);
      for (let attempt = 0; attempt < 8; attempt++) {
        const rows = await rest(
          "lab2_workspaces?" +
            new URLSearchParams({
              id: "eq." + config.workspaceId,
              select: "state,revision",
            }),
          { token: user.token },
        );
        if (!rows?.[0]) throw fail("Test workspace unavailable.", 403);
        const { state, revision } = rows[0];
        const result = mutate(state);
        const updated = await rest("rpc/lab2_compare_and_swap", {
          method: "POST",
          body: {
            p_workspace: config.workspaceId,
            p_user: user.id,
            p_revision: revision,
            p_state: state,
          },
        });
        if (updated === true) return result;
      }
      throw fail(
        "Concurrent update conflict. Reload; no automatic provider retry.",
        409,
      );
    },
  };
}
