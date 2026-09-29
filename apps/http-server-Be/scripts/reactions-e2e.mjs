/**
 * Exercises the reaction endpoint against a live server + database.
 *
 * Focus is on the toggle semantics, which are the part that's easy to get
 * subtly wrong: same emoji twice must remove, a different emoji must
 * replace, and a second person must stack rather than overwrite.
 *
 * Run: RUN_E2E=1 node scripts/reactions-e2e.mjs
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";

if (process.env.RUN_E2E !== "1") {
  console.error(
    "\nRefusing to run: this script writes to the configured database.\n" +
      "Re-run with RUN_E2E=1 if that's intentional.\n",
  );
  process.exit(2);
}

dotenv.config({ path: "./.env" });

const BASE = `http://localhost:${process.env.PORT || 3004}/api/v1`;
const DB_NAME = process.env.DB_NAME || "chatApp-Oliver-monorepo";

let pass = 0;
let fail = 0;

const check = (name, condition, extra = "") => {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${extra}`);
  }
};

const req = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body: json };
};

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const registerForm = (email, username, password) => {
  const fd = new FormData();
  fd.set("email", email);
  fd.set("username", username);
  fd.set("password", password);
  fd.set("avatar", new Blob([PNG], { type: "image/png" }), "a.png");
  return fd;
};

const main = async () => {
  const stamp = Date.now();
  const users = [
    { email: `ra-${stamp}@barmanji.com`, username: `ra${stamp}`, password: "Str0ng!Passw0rd" },
    { email: `rb-${stamp}@barmanji.com`, username: `rb${stamp}`, password: "Str0ng!Passw0rd" },
  ];

  console.log("\n1. SETUP — two verified users with a 1:1 chat and a message");
  await mongoose.connect(process.env.MONGODB_LOCAL_URI, { dbName: DB_NAME });
  const db = mongoose.connection.db;

  const created = [];
  for (const u of users) {
    const res = await fetch(`${BASE}/user/register`, {
      method: "POST",
      body: registerForm(u.email, u.username, u.password),
    });
    const reg = await res.json();
    check(`register ${u.username} -> 201`, res.status === 201, JSON.stringify(reg).slice(0, 160));

    // Mark verified directly so the test doesn't depend on inbox access.
    await db
      .collection("users")
      .updateOne({ email: u.email }, { $set: { isEmailVerified: true } });

    // Registration no longer returns the created user (it returns the
    // verification payload), so the id is read back from the database.
    const doc = await db.collection("users").findOne({ email: u.email });
    created.push({ ...u, _id: doc?._id?.toString() });
  }
  check("both accounts have ids", created.every((u) => Boolean(u._id)), JSON.stringify(created.map((u) => u._id)));

  const tokens = [];
  for (const u of users) {
    const login = await req("POST", "/user/login", {
      body: { username: u.username, password: u.password },
    });
    tokens.push(login.body?.data?.accessToken);
  }
  check("both users can log in", tokens.every(Boolean), JSON.stringify(tokens));

  // 1:1 chat between them.
  const chatRes = await req("POST", `/chats/c/${created[1]._id}`, { token: tokens[0] });
  const chatId = chatRes.body?.data?._id;
  check("1:1 chat created", Boolean(chatId), JSON.stringify(chatRes.body));

  // A message in it.
  const fd = new FormData();
  fd.set("content", "react to this");
  const msgRes = await fetch(`${BASE}/messages/${chatId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens[0]}` },
    body: fd,
  });
  const msg = await msgRes.json();
  const messageId = msg.data?._id;
  check("message created", Boolean(messageId), JSON.stringify(msg).slice(0, 200));

  console.log("\n2. FIRST user reacts — reaction is added");
  const r1 = await req("PUT", `/messages/${chatId}/${messageId}/reaction`, {
    token: tokens[0],
    body: { emoji: "👍" },
  });
  check("status 200", r1.status === 200, `got ${r1.status}`);
  check("myReaction echoes the emoji", r1.body?.data?.myReaction === "👍");
  check("one reaction stored", r1.body?.data?.reactions?.length === 1, JSON.stringify(r1.body?.data?.reactions));
  check(
    "reactor is populated, not a raw id",
    typeof r1.body?.data?.reactions?.[0]?.username === "string",
    JSON.stringify(r1.body?.data?.reactions?.[0]),
  );

  console.log("\n3. SAME user, SAME emoji — reaction is removed");
  const r2 = await req("PUT", `/messages/${chatId}/${messageId}/reaction`, {
    token: tokens[0],
    body: { emoji: "👍" },
  });
  check("status 200", r2.status === 200, `got ${r2.status}`);
  check("myReaction is null", r2.body?.data?.myReaction === null);
  check("no reactions left", r2.body?.data?.reactions?.length === 0, JSON.stringify(r2.body?.data?.reactions));

  console.log("\n4. SAME user, DIFFERENT emoji — reaction is replaced, not duplicated");
  await req("PUT", `/messages/${chatId}/${messageId}/reaction`, { token: tokens[0], body: { emoji: "👍" } });
  const r4 = await req("PUT", `/messages/${chatId}/${messageId}/reaction`, {
    token: tokens[0],
    body: { emoji: "🔥" },
  });
  check("still exactly one reaction", r4.body?.data?.reactions?.length === 1, JSON.stringify(r4.body?.data?.reactions));
  check("emoji was replaced with 🔥", r4.body?.data?.reactions?.[0]?.emoji === "🔥");

  console.log("\n5. DIFFERENT user, same emoji — reactions stack");
  const r5 = await req("PUT", `/messages/${chatId}/${messageId}/reaction`, {
    token: tokens[1],
    body: { emoji: "🔥" },
  });
  check("two reactions now", r5.body?.data?.reactions?.length === 2, JSON.stringify(r5.body?.data?.reactions));
  const emojis = r5.body?.data?.reactions?.map((r) => r.emoji) ?? [];
  check("both are 🔥", emojis.every((e) => e === "🔥"), JSON.stringify(emojis));
  const reactors = r5.body?.data?.reactions?.map((r) => String(r.user?._id ?? r.user)) ?? [];
  check("two distinct reactors", new Set(reactors).size === 2, JSON.stringify(reactors));

  console.log("\n6. Reactions survive a refetch of the message list");
  const list = await req("GET", `/messages/${chatId}`, { token: tokens[0] });
  const fetched = (list.body?.data ?? []).find((m) => m._id === messageId);
  check("refetched message has 2 reactions", fetched?.reactions?.length === 2, JSON.stringify(fetched?.reactions));
  check(
    "reactions are populated on refetch too",
    fetched?.reactions?.every((r) => typeof r.username === "string"),
    JSON.stringify(fetched?.reactions),
  );
  check("no scratch fields leaked", !("storedReactions" in (fetched ?? {})), JSON.stringify(Object.keys(fetched ?? {})));

  console.log("\n7. Emoji outside the allowed set is rejected");
  const bad = await req("PUT", `/messages/${chatId}/${messageId}/reaction`, {
    token: tokens[0],
    body: { emoji: "<script>alert(1)</script>" },
  });
  check("rejected with 400", bad.status === 400, `got ${bad.status}`);
  check("error is specific", /available reactions/i.test(bad.body?.message || ""), bad.body?.message);
  const afterBad = await req("GET", `/messages/${chatId}`, { token: tokens[0] });
  const unchanged = (afterBad.body?.data ?? []).find((m) => m._id === messageId);
  check("reaction list unchanged after rejection", unchanged?.reactions?.length === 2, JSON.stringify(unchanged?.reactions));

  console.log("\n8. A non-member cannot react");
  const strangerReg = await fetch(`${BASE}/user/register`, {
    method: "POST",
    body: registerForm(`rc-${stamp}@barmanji.com`, `rc${stamp}`, "Str0ng!Passw0rd"),
  });
  await strangerReg.json();
  await db
    .collection("users")
    .updateOne({ email: `rc-${stamp}@barmanji.com` }, { $set: { isEmailVerified: true } });
  const strangerLogin = await req("POST", "/user/login", {
    body: { username: `rc${stamp}`, password: "Str0ng!Passw0rd" },
  });
  const stranger = await req("PUT", `/messages/${chatId}/${messageId}/reaction`, {
    token: strangerLogin.body?.data?.accessToken,
    body: { emoji: "😂" },
  });
  check("non-member is refused with 403", stranger.status === 403, `got ${stranger.status}`);

  console.log("\n9. The frontend and backend emoji lists agree");
  // The picker is only useful if every emoji it offers is one the server will
  // accept. Both lists are generated from one source; this asserts it.
  //
  // The backend list lives inline in message.controller.ts (it is not exported,
  // and pulling it out into a module just for a test would be churn), so it is
  // read back out of the source and compared as text.
  const { ALL_REACTION_EMOJIS: feEmojis, EMOJI_SECTIONS } = await import(
    "../../react-Fe/src/components/chat/reactionEmojis.ts"
  );
  const controllerSource = readFileSync(
    new URL("../src/controllers/message.controller.ts", import.meta.url),
    "utf8",
  );
  const beMatch = controllerSource.match(
    /const ALLOWED_REACTIONS = \[([\s\S]*?)\] as const;/,
  );
  check("backend allow-list is readable", Boolean(beMatch));
  const beEmojis = beMatch
    ? [...beMatch[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
        JSON.parse(`"${m[1]}"`),
      )
    : [];

  const feSet = new Set(feEmojis);
  const beSet = new Set(beEmojis);
  check(
    "same length",
    feEmojis.length === beEmojis.length,
    `fe=${feEmojis.length} be=${beEmojis.length}`,
  );
  check(
    "no emoji offered by the UI is missing on the server",
    [...feSet].every((e) => beSet.has(e)),
    [...feSet].filter((e) => !beSet.has(e)).join(" "),
  );
  check(
    "no server emoji is missing from the UI",
    [...beSet].every((e) => feSet.has(e)),
    [...beSet].filter((e) => !feSet.has(e)).join(" "),
  );
  check(
    "at least 200 emoji available",
    feEmojis.length >= 200,
    `got ${feEmojis.length}`,
  );

  // Spot-check that an emoji from each section is actually accepted over HTTP,
  // rather than assuming the list is wired up because it is long. Each is
  // toggled back off so the next section starts from a clean slate.
  for (const section of EMOJI_SECTIONS) {
    const probe = section.emojis[0]?.emoji;
    if (!probe) continue;
    const r = await req("PUT", `/messages/${chatId}/${messageId}/reaction`, {
      token: tokens[0],
      body: { emoji: probe },
    });
    check(
      `${section.id} emoji accepted`,
      r.status === 200,
      `${section.id}/${probe} -> ${r.status}`,
    );
    await req("PUT", `/messages/${chatId}/${messageId}/reaction`, {
      token: tokens[0],
      body: { emoji: probe },
    });
  }

  // Cleanup
  await db.collection("users").deleteMany({
    email: { $regex: `^[rbcr]?-?-?${stamp}@` },
  });
  await db.collection("chats").deleteMany({ _id: new mongoose.Types.ObjectId(chatId) });
  await db.collection("chatmessages").deleteMany({
    chat: new mongoose.Types.ObjectId(chatId),
  });
  await mongoose.disconnect();

  console.log(`\n${"=".repeat(46)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(46)}\n`);
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error("\nReactions harness crashed:", e);
  process.exit(1);
});
