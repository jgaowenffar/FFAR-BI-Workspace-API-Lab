import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("Postgres migration enforces account isolation, read-only clients, idempotency and hourly caps", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create schema auth; create role anon; create role authenticated; create role service_role bypassrls; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon;`,
    );
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/202611120001_lab.sql", import.meta.url),
        "utf8",
      ),
    );
    const a = "11111111-1111-4111-8111-111111111111",
      b = "22222222-2222-4222-8222-222222222222",
      run = "33333333-3333-4333-8333-333333333333";
    await db.exec(
      `insert into auth.users values('${a}'),('${b}'); insert into lab_profiles(user_id,subject,mode,model,document) values('${a}','Synthetic','mock','test','{}');`,
    );
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${a}',false);`,
    );
    assert.equal((await db.query("select * from lab_profiles")).rows.length, 1);
    await db.exec(`select set_config('request.jwt.claim.sub','${b}',false);`);
    assert.equal((await db.query("select * from lab_profiles")).rows.length, 0);
    await assert.rejects(
      db.exec(
        `insert into lab_profiles(user_id,subject,mode,model,document) values('${b}','Forged','mock','test','{}');`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.exec(
        `select lab_start_run('${run}','${b}','profile','live','test','Synthetic',1);`,
      ),
      /permission denied/,
    );
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.query("select * from lab_profiles"),
      /permission denied/,
    );
    await db.exec("reset role; set role service_role;");
    const params = [run, a, "profile", "live", "test", "Synthetic", 1];
    assert.equal(
      (
        await db.query(
          "select lab_start_run($1,$2,$3,$4,$5,$6,$7) as claimed",
          params,
        )
      ).rows[0].claimed,
      true,
    );
    assert.equal(
      (
        await db.query(
          "select lab_start_run($1,$2,$3,$4,$5,$6,$7) as claimed",
          params,
        )
      ).rows[0].claimed,
      false,
    );
    await assert.rejects(
      db.query("select lab_start_run($1,$2,$3,$4,$5,$6,$7)", [
        "44444444-4444-4444-8444-444444444444",
        ...params.slice(1),
      ]),
      /Hourly live-test limit reached/,
    );
  } finally {
    await db.close();
  }
});
test("Shared migration permits member reads, denies outsider/client writes and serializes revisions", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create schema auth; create role anon; create role authenticated; create role service_role bypassrls; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated,anon;`,
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202611120002_shared_lab.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const a = "11111111-1111-4111-8111-111111111111",
      b = "22222222-2222-4222-8222-222222222222",
      outsider = "33333333-3333-4333-8333-333333333333",
      viewer = "44444444-4444-4444-8444-444444444444",
      w = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await db.exec(
      `insert into auth.users values('${a}'),('${b}'),('${outsider}'),('${viewer}'); insert into lab2_workspaces(id,name) values('${w}','Test'); insert into lab2_memberships values('${w}','${a}','editor'),('${w}','${b}','editor'),('${w}','${viewer}','viewer');`,
    );
    for (const id of [a, b, viewer]) {
      await db.exec(
        `set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
      );
      assert.equal(
        (await db.query("select * from lab2_workspaces")).rows.length,
        1,
      );
      assert.equal(
        (await db.query("select * from lab2_memberships")).rows.length,
        1,
      );
      await assert.rejects(
        db.exec(`update lab2_workspaces set revision=5 where id='${w}'`),
        /permission denied/,
      );
      await assert.rejects(
        db.query("select lab2_compare_and_swap($1,$2,$3,$4)", [
          w,
          a,
          0,
          { organizations: [], jobs: [], notes: [] },
        ]),
        /permission denied/,
      );
      await db.exec("reset role");
    }
    await db.exec(
      `set role authenticated; select set_config('request.jwt.claim.sub','${outsider}',false);`,
    );
    assert.equal(
      (await db.query("select * from lab2_workspaces")).rows.length,
      0,
    );
    await db.exec("reset role; set role anon");
    await assert.rejects(
      db.query("select * from lab2_workspaces"),
      /permission denied/,
    );
    await db.exec("reset role; set role service_role");
    const state = {
      organizations: [],
      jobs: [],
      notes: [{ id: "shared-note" }],
    };
    const cas = async (id, revision, value = state) =>
      (
        await db.query("select lab2_compare_and_swap($1,$2,$3,$4) as saved", [
          w,
          id,
          revision,
          value,
        ])
      ).rows[0].saved;
    assert.equal(await cas(a, 0), true);
    assert.equal(await cas(b, 0), false);
    assert.equal(await cas(b, 1), true);
    await assert.rejects(cas(outsider, 2), /Editor membership required/);
    await assert.rejects(cas(viewer, 2), /Editor membership required/);
    await assert.rejects(cas(a, 2, {}), /lab2_state_shape/);
    await db.exec(
      `reset role; set role authenticated; select set_config('request.jwt.claim.sub','${b}',false);`,
    );
    const shared = (
      await db.query("select state,revision from lab2_workspaces")
    ).rows[0];
    assert.equal(shared.state.notes[0].id, "shared-note");
    assert.equal(shared.revision, 2);
  } finally {
    await db.close();
  }
});
