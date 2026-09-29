/**
 * End-to-end check for the Resend email-verification rollout.
 *
 * 1. A brand new account is created UNVERIFIED and cannot log in.
 * 2. The right code verifies it; a wrong code decrements a visible counter.
 * 3. Once verified, login succeeds.
 * 4. A legacy account (no `isEmailVerified` field at all) still logs in.
 *
 * Run: RUN_E2E=1 node scripts/verify-email-e2e.mjs
 *
 * This creates and deletes throwaway users in the SAME database the server is
 * pointed at, so it is gated behind RUN_E2E=1 to make that impossible to do
 * by accident.
 */
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

if (process.env.RUN_E2E !== "1") {
  console.error(
    "\nRefusing to run: this script writes to the configured database.\n" +
      "Re-run with RUN_E2E=1 if that's intentional.\n",
  );
  process.exit(2);
}

dotenv.config({ path: "./.env" });

const BASE = `http://localhost:${process.env.PORT || 3004}/api/v1`;
const stamp = Date.now();
const TEST_EMAIL = `e2e-${stamp}@barmanji.com`;
const TEST_USERNAME = `e2e${stamp}`;
const TEST_PASSWORD = "Str0ng!Passw0rd";

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

// `body` may be a raw FormData (let fetch set the multipart boundary) or the
// `{ body, headers }` wrapper returned by `jsonBody`.
const api = async (path, body, token) => {
  const isWrapped = body && typeof body === "object" && "body" in body;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    body: isWrapped ? body.body : body,
    headers: {
      ...(isWrapped ? body.headers || {} : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body: json };
};

// A 1x1 PNG, enough to satisfy the avatar upload.
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

const jsonBody = (obj) => ({
  body: JSON.stringify(obj),
  headers: { "Content-Type": "application/json" },
});

const main = async () => {
  console.log("\n1. REGISTRATION creates an unverified account");
  const reg = await api("/user/register", registerForm(TEST_EMAIL, TEST_USERNAME, TEST_PASSWORD));
  check("register returns 201", reg.status === 201, `got ${reg.status} ${JSON.stringify(reg.body)}`);
  check("requiresEmailVerification is true", reg.body?.data?.requiresEmailVerification === true);
  check("email is masked in the response", String(reg.body?.data?.email).includes("*"), `got ${reg.body?.data?.email}`);
  check("maxAttempts reported", reg.body?.data?.maxAttempts === 5);

  console.log("\n2. UNVERIFIED account cannot log in");
  const blocked = await api("/user/login", jsonBody({ username: TEST_USERNAME, password: TEST_PASSWORD }));
  check("login is blocked with 403", blocked.status === 403, `got ${blocked.status}`);
  check("code is EMAIL_NOT_VERIFIED", blocked.body?.code === "EMAIL_NOT_VERIFIED");

  console.log("\n3. WRONG codes report a decreasing attempts counter");
  // Read the real code straight from the DB so this test doesn't depend on
  // inbox access, then feed deliberately wrong values.
  // The URI carries no database name, so it must be supplied explicitly —
  // otherwise mongoose connects to a different DB than the running server.
  const DB_NAME = process.env.DB_NAME || "chatApp-Oliver-monorepo";
  await mongoose.connect(process.env.MONGODB_LOCAL_URI, { dbName: DB_NAME });
  const db = mongoose.connection.db;
  const raw = await db.collection("users").findOne({ email: TEST_EMAIL });
  check("new account has isEmailVerified === false", raw?.isEmailVerified === false, `got ${raw?.isEmailVerified}`);
  check("a code hash is stored", typeof raw?.emailVerification?.codeHash === "string");
  check("the raw code is NOT stored", !JSON.stringify(raw?.emailVerification || {}).match(/\d{6}/));

  for (let i = 1; i <= 5; i++) {
    const bad = await api("/user/verify-email", jsonBody({ email: TEST_EMAIL, code: "000000" }));
    const expectedLeft = 5 - i;
    const msg = bad.body?.message || "";
    if (expectedLeft === 0) {
      check(`attempt ${i}: counter exhausted, code destroyed`, /all 5 attempts/i.test(msg), msg);
    } else {
      check(`attempt ${i}: reports ${expectedLeft} left`, msg.includes(`${expectedLeft} attempt`), msg);
    }
  }
  const afterBurn = await db.collection("users").findOne({ email: TEST_EMAIL });
  check("code hash is cleared after exhausting attempts", afterBurn?.emailVerification === undefined, JSON.stringify(afterBurn?.emailVerification));

  console.log("\n4. Correct code verifies the account");
  // Re-issue a code by clearing the exhausted state, then read the hash's
  // plaintext from the mail log we can't access — so instead verify a fresh
  // code by resetting directly and comparing via a known plaintext.
  await db.collection("users").updateOne(
    { email: TEST_EMAIL },
    { $set: { emailVerification: { codeHash: await bcrypt.hash("424242", 10), expiresAt: new Date(Date.now() + 600000), attempts: 2, lastSentAt: new Date() } } },
  );
  const ok = await api("/user/verify-email", jsonBody({ email: TEST_EMAIL, code: "424242" }));
  check("correct code succeeds", ok.status === 200, `got ${ok.status} ${JSON.stringify(ok.body)}`);
  check("verified flag returned", ok.body?.data?.verified === true);
  const verified = await db.collection("users").findOne({ email: TEST_EMAIL });
  check("isEmailVerified flipped to true", verified?.isEmailVerified === true);
  check("code hash cleared after success", verified?.emailVerification === undefined);

  console.log("\n5. Replaying a used code is idempotent, not an error");
  const replay = await api("/user/verify-email", jsonBody({ email: TEST_EMAIL, code: "424242" }));
  check("replay still returns 200", replay.status === 200, `got ${replay.status}`);

  console.log("\n6. VERIFIED account can log in, and needs no code");
  const login = await api("/user/login", jsonBody({ username: TEST_USERNAME, password: TEST_PASSWORD }));
  check("login succeeds with 200", login.status === 200, `got ${login.status} ${JSON.stringify(login.body)}`);
  check("returns an accessToken", typeof login.body?.data?.accessToken === "string");

  console.log("\n7. LEGACY account (field absent) still logs in — no migration");
  const legacyEmail = `legacy-${stamp}@barmanji.com`;
  const legacyPassword = "Legacy!Passw0rd";
  await db.collection("users").insertOne({
    username: `legacy${stamp}`,
    email: legacyEmail,
    password: await bcrypt.hash(legacyPassword, 10),
    avatar: "https://example.com/a.png",
    refreshToken: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const legacyRaw = await db.collection("users").findOne({ email: legacyEmail });
  check("legacy doc truly has no isEmailVerified field", !("isEmailVerified" in legacyRaw), JSON.stringify(Object.keys(legacyRaw)));
  const legacyLogin = await api("/user/login", jsonBody({ username: `legacy${stamp}`, password: legacyPassword }));
  check("legacy account logs in successfully", legacyLogin.status === 200, `got ${legacyLogin.status} ${JSON.stringify(legacyLogin.body)}`);

  console.log("\n8. Resend is rate limited to one code per 60s");
  await db.collection("users").updateOne(
    { email: TEST_EMAIL },
    { $set: { isEmailVerified: false, emailVerification: undefined } },
  );
  const resend1 = await api("/user/resend-verification", jsonBody({ email: TEST_EMAIL }));
  check("first resend succeeds", resend1.status === 200, `got ${resend1.status} ${JSON.stringify(resend1.body)}`);
  const resend2 = await api("/user/resend-verification", jsonBody({ email: TEST_EMAIL }));
  check("immediate second resend is 429", resend2.status === 429, `got ${resend2.status}`);
  check("429 explains the wait", /wait \d+ seconds?/i.test(resend2.body?.message || ""), resend2.body?.message);

  console.log("\n9. Validation errors are specific and field-mapped");
  const badEmail = await api("/user/register", registerForm("not-an-email", `bad${stamp}`, TEST_PASSWORD));
  check("invalid email is rejected with 400", badEmail.status === 400, `got ${badEmail.status}`);
  check("error is mapped to the email field", badEmail.body?.errors?.[0]?.path === "email", JSON.stringify(badEmail.body?.errors));

  const dupe = await api("/user/register", registerForm(TEST_EMAIL, `other${stamp}`, TEST_PASSWORD));
  check("duplicate email is 409", dupe.status === 409, `got ${dupe.status}`);
  check("duplicate names the email field", dupe.body?.errors?.[0]?.path === "email");

  // Cleanup
  await db.collection("users").deleteMany({ email: { $in: [TEST_EMAIL, legacyEmail] } });
  await mongoose.disconnect();

  console.log(`\n${"=".repeat(46)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(46)}\n`);
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error("\nE2E harness crashed:", e);
  process.exit(1);
});
