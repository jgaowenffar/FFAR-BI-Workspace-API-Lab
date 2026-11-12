// Uses existing Auth accounts. Writes synthetic records only. No OpenAI calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { configuration, createLab } from "../server/lab.mjs";
const config = configuration();
const [a, b, outside] = ["A", "B", "OUTSIDER"].map(
  (key) => process.env["LAB_TEST_ACCESS_TOKEN_" + key],
);
if (!config.supabaseUrl || !a || !b || !outside || a === b)
  throw new Error(
    "Set Supabase settings, workspace ID and three distinct existing Auth account access tokens in .env.local.",
  );
const lab = createLab({ config });
const [userA, userB] = await Promise.all([
  lab.act("snapshot", {}, a),
  lab.act("snapshot", {}, b),
]);
assert.notEqual(
  userA.account.id,
  userB.account.id,
  "A and B must be different accounts.",
);
const probe = await lab.act("storage-probe", { requestId: randomUUID() }, a);
const secondProcess = createLab({ config });
const shared = await secondProcess.act("snapshot", {}, b);
const org = shared.organizations.find((o) => o.id === probe.organizationId);
assert.equal(
  org?.versions[0].id,
  probe.versionId,
  "B must read A’s saved version.",
);
assert.ok(
  shared.notes.some((n) => n.id === probe.noteId),
  "B must read A’s note.",
);
await lab.act(
  "note",
  {
    requestId: randomUUID(),
    organizationId: org.id,
    text: "Shared smoke-test reply from account B",
  },
  b,
);
assert.ok(
  (await lab.act("snapshot", {}, a)).notes.some(
    (n) => n.organizationId === org.id && n.author === userB.account.id,
  ),
);
await assert.rejects(lab.act("snapshot", {}, outside), (e) => e.status === 403);
// Check direct database RLS too, independently of the server membership guard.
const direct = async (token) => {
  const r = await fetch(
    config.supabaseUrl.replace(/\/$/, "") +
      "/rest/v1/lab2_workspaces?id=eq." +
      config.workspaceId +
      "&select=id",
    {
      headers: {
        apikey: config.supabasePublishable,
        Authorization: "Bearer " + token,
      },
    },
  );
  return { status: r.status, rows: r.ok ? await r.json() : [] };
};
assert.equal((await direct(b)).rows.length, 1);
const blocked = await direct(outside);
assert.ok([200, 401, 403].includes(blocked.status));
assert.equal(blocked.rows.length, 0);
console.log(
  JSON.stringify(
    {
      supabase: "passed",
      sharedProfile: true,
      sharedVersion: true,
      sharedNotes: true,
      newServerInstanceRead: true,
      outsiderDenied: true,
      directRls: true,
      openaiCalls: 0,
      organizationId: probe.organizationId,
    },
    null,
    2,
  ),
);
