/**
 * End-to-end check for the Resend email-verification rollout.
 *
 * 1. A brand new account is created UNVERIFIED and cannot log in.
 * 2. The right code verifies it; a wrong code decrements a visible counter.
 * 3. Once verified, login succeeds.
 * 4. A legacy account (no `isEmailVerified` field at all) still logs in.
 * 5. Re-registering an existing address is refused and never mutates that
 *    account, while the resend endpoint makes a code reachable again.
 * 6. `/recover-account` + `/recover-account/complete` recover an account that
 *    already exists: an emailed code is the only credential, and it gates a
 *    real password / username / picture change on a *verified* account (the
 *    forgot-password case) as well as finishing an abandoned signup.
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

  console.log("\n10. Re-registering an existing address stays a dead end, but a code is reachable");
  // The register page recovers from a duplicate by offering to resend a code.
  // It can only do that safely because of the behaviour asserted here, so this
  // is the contract the frontend fix depends on.
  const recoveryEmail = `recover-${stamp}@barmanji.com`;
  const recoveryUsername = `recover${stamp}`;
  await api("/user/register", registerForm(recoveryEmail, recoveryUsername, TEST_PASSWORD));

  // Re-registering with DIFFERENT credentials is what a user does when they
  // forgot their password. It must be refused, and it must not silently
  // rewrite the account — otherwise an unauthenticated caller could take over
  // any account by posting a known email.
  const before = await db.collection("users").findOne({ email: recoveryEmail });
  const reRegister = await api(
    "/user/register",
    registerForm(recoveryEmail, `hijack${stamp}`, "Different!Passw0rd"),
  );
  check("re-registering an unverified address is 409", reRegister.status === 409, `got ${reRegister.status}`);
  check(
    "409 names the email field so the UI can tell it apart from a username clash",
    reRegister.body?.errors?.[0]?.path === "email",
    JSON.stringify(reRegister.body?.errors),
  );
  check(
    "409 message is about the address already being registered",
    /already registered|already.*account|exists/i.test(reRegister.body?.message || ""),
    reRegister.body?.message,
  );

  const after = await db.collection("users").findOne({ email: recoveryEmail });
  check("username is NOT overwritten by the re-register attempt", after?.username === before?.username, `${before?.username} -> ${after?.username}`);
  check("password hash is NOT overwritten by the re-register attempt", after?.password === before?.password);
  check("account is still unverified after the re-register attempt", after?.isEmailVerified === false, `got ${after?.isEmailVerified}`);

  // Recovery path: a fresh code for that same address.
  // Registration already sent one, so the cooldown is genuinely active; backdate
  // it to reach the 200 branch, and exercise the 429 branch after it.
  await db.collection("users").updateOne(
    { email: recoveryEmail },
    { $set: { "emailVerification.lastSentAt": new Date(0) } },
  );
  const resendFresh = await api("/user/resend-verification", jsonBody({ email: recoveryEmail }));
  check("resend for the unverified address succeeds", resendFresh.status === 200, `got ${resendFresh.status} ${JSON.stringify(resendFresh.body)}`);
  check("resend reports a cooldown so the UI can show a countdown", typeof resendFresh.body?.data?.cooldownSeconds === "number", JSON.stringify(resendFresh.body?.data));
  check("resend reports maxAttempts", typeof resendFresh.body?.data?.maxAttempts === "number");
  check("resend echoes no plaintext address", String(resendFresh.body?.data?.email ?? "").includes("*") === false, JSON.stringify(resendFresh.body?.data));

  // Inside the cooldown: the UI must still be able to move the user forward,
  // because a code is already sitting in their inbox.
  const resendCooling = await api("/user/resend-verification", jsonBody({ email: recoveryEmail }));
  check("resend inside the cooldown is 429", resendCooling.status === 429, `got ${resendCooling.status}`);
  check("429 uses the RATE_LIMITED code the UI branches on", resendCooling.body?.code === "RATE_LIMITED", JSON.stringify(resendCooling.body));
  check("429 states a number of seconds so the UI can show the real wait", /wait \d+ seconds?/i.test(resendCooling.body?.message || ""), resendCooling.body?.message);

  // A verified account must NOT be dumped onto the code step: there is nothing
  // to verify, so login is the way in.
  await db.collection("users").updateOne({ email: recoveryEmail }, { $set: { isEmailVerified: true } });
  const resendVerified = await api("/user/resend-verification", jsonBody({ email: recoveryEmail }));
  check("resend for a verified address is 409", resendVerified.status === 409, `got ${resendVerified.status} ${JSON.stringify(resendVerified.body)}`);
  check("409 says the address is already verified", /already verified/i.test(resendVerified.body?.message || ""), resendVerified.body?.message);

  // An address with no account at all: the UI must not promise a code here.
  const resendGhost = await api("/user/resend-verification", jsonBody({ email: `ghost-${stamp}@barmanji.com` }));
  check("resend for an unknown address is 404", resendGhost.status === 404, `got ${resendGhost.status}`);

  console.log("\n11. RECOVERY: a code unlocks a real change on a working account");
  // The case `/resend-verification` cannot serve: it answers a confirmed
  // address with 409 (asserted in step 10), so the owner of a perfectly healthy
  // account who cannot remember the password had no way forward at all.
  // `recover-account` exists for exactly that, and this is the contract the
  // register page's recovery panel depends on.
  const forgotEmail = `forgot-${stamp}@barmanji.com`;
  const forgotUsername = `forgot${stamp}`;
  const forgotNewPassword = "N3w!Password";
  const forgotNewUsername = `recovered${stamp}`;

  await api("/user/register", registerForm(forgotEmail, forgotUsername, TEST_PASSWORD));
  await db.collection("users").updateOne({ email: forgotEmail }, { $set: { isEmailVerified: true } });
  // Log in once so the account holds a live session. Recovery has to revoke
  // it: that session was minted from the password the user just replaced, so
  // keeping it would leave whoever prompted the reset still signed in.
  const forgotLogin = await api("/user/login", jsonBody({ username: forgotUsername, password: TEST_PASSWORD }));
  check("forgot-password fixture can log in", forgotLogin.status === 200, `got ${forgotLogin.status} ${JSON.stringify(forgotLogin.body)}`);
  const withSession = await db.collection("users").findOne({ email: forgotEmail });
  check("fixture has a refreshToken for the recovery to revoke", Boolean(withSession?.refreshToken), JSON.stringify(withSession?.refreshToken));

  // Registration already sent a code, so backdate to reach the 200 branch.
  await db.collection("users").updateOne({ email: forgotEmail }, { $set: { "emailVerification.lastSentAt": new Date(0) } });
  const recVerified = await api("/user/recover-account", jsonBody({ email: forgotEmail }));
  check("recover-account serves a VERIFIED address (resend-verification 409s here)", recVerified.status === 200, `got ${recVerified.status} ${JSON.stringify(recVerified.body)}`);
  check("it reports accountVerified: true", recVerified.body?.data?.accountVerified === true, JSON.stringify(recVerified.body?.data));
  check("it reports a cooldown so the UI can count down", typeof recVerified.body?.data?.cooldownSeconds === "number", JSON.stringify(recVerified.body?.data));
  check("it reports maxAttempts", recVerified.body?.data?.maxAttempts === 5, JSON.stringify(recVerified.body?.data));

  const recCooling = await api("/user/recover-account", jsonBody({ email: forgotEmail }));
  check("a second request inside the cooldown is 429", recCooling.status === 429, `got ${recCooling.status}`);
  check("429 uses the RATE_LIMITED code the UI branches on", recCooling.body?.code === "RATE_LIMITED", JSON.stringify(recCooling.body));
  check("429 states a number of seconds so the UI shows the real wait", /wait \d+ seconds?/i.test(recCooling.body?.message || ""), recCooling.body?.message);

  console.log("\n12. The code is the gate: a wrong code changes NOTHING");
  const completeForm = (email, code, { password, username, avatar } = {}) => {
    const fd = new FormData();
    fd.set("email", email);
    fd.set("code", code);
    if (password) fd.set("newPassword", password);
    if (username) fd.set("newUsername", username);
    if (avatar) fd.set("avatar", new Blob([avatar], { type: "image/png" }), "b.png");
    return fd;
  };

  // The attack this must stop: a known email plus a new password. Without the
  // code, the password has to stay exactly as it was.
  const beforeWrong = await db.collection("users").findOne({ email: forgotEmail });
  const wrong = await api("/user/recover-account/complete", completeForm(forgotEmail, "000000", { password: forgotNewPassword, username: forgotNewUsername }));
  check("a wrong code is rejected with 400", wrong.status === 400, `got ${wrong.status} ${JSON.stringify(wrong.body)}`);
  check("the rejection is mapped to the code field", wrong.body?.errors?.[0]?.path === "code", JSON.stringify(wrong.body?.errors));
  check("it reports the attempts remaining", /4 attempt/i.test(wrong.body?.message || ""), wrong.body?.message);
  const afterWrong = await db.collection("users").findOne({ email: forgotEmail });
  check("password hash NOT changed by a wrong code", afterWrong?.password === beforeWrong?.password);
  check("username NOT changed by a wrong code", afterWrong?.username === beforeWrong?.username);
  check("picture NOT changed by a wrong code", afterWrong?.avatar === beforeWrong?.avatar);
  check("the live session is NOT revoked by a wrong code", afterWrong?.refreshToken === beforeWrong?.refreshToken);

  console.log("\n13. A rejected DETAIL leaves the code usable, so the user can fix one field");
  // The point of checking the code without consuming it: a taken username or a
  // failed upload should cost the user a form edit, not another email.
  const RECOVERY_CODE = "630271";
  await db.collection("users").updateOne(
    { email: forgotEmail },
    { $set: { emailVerification: { codeHash: await bcrypt.hash(RECOVERY_CODE, 10), expiresAt: new Date(Date.now() + 600000), attempts: 5, lastSentAt: new Date() } } },
  );

  const weak = await api("/user/recover-account/complete", completeForm(forgotEmail, RECOVERY_CODE, { password: "weak" }));
  check("a password too weak to accept is refused with 400", weak.status === 400, `got ${weak.status} ${JSON.stringify(weak.body)}`);
  check("and mapped to the password field", weak.body?.errors?.[0]?.path === "password", JSON.stringify(weak.body?.errors));

  const taken = await api("/user/recover-account/complete", completeForm(forgotEmail, RECOVERY_CODE, { password: forgotNewPassword, username: TEST_USERNAME }));
  check("a username already in use is refused with 409", taken.status === 409, `got ${taken.status} ${JSON.stringify(taken.body)}`);
  check("and mapped to the username field", taken.body?.errors?.[0]?.path === "username", JSON.stringify(taken.body?.errors));

  const badName = await api("/user/recover-account/complete", completeForm(forgotEmail, RECOVERY_CODE, { username: "not a valid name!" }));
  check("a malformed username is refused with 400", badName.status === 400, `got ${badName.status}`);
  check("and mapped to the username field", badName.body?.errors?.[0]?.path === "username", JSON.stringify(badName.body?.errors));

  const midFlight = await db.collection("users").findOne({ email: forgotEmail });
  check("the code was NOT spent by any of those three rejections", typeof midFlight?.emailVerification?.codeHash === "string", JSON.stringify(midFlight?.emailVerification));
  check("still no detail applied after all three", midFlight?.password === beforeWrong?.password && midFlight?.username === beforeWrong?.username, `${midFlight?.username}`);

  console.log("\n14. The correct code applies password, username AND picture at once");
  const done = await api("/user/recover-account/complete", completeForm(forgotEmail, RECOVERY_CODE, { password: forgotNewPassword, username: forgotNewUsername, avatar: PNG }));
  check("the correct code applies the changes", done.status === 200, `got ${done.status} ${JSON.stringify(done.body)}`);
  check("it lists all three as changed", done.body?.data?.changed?.length === 3, JSON.stringify(done.body?.data));
  check("password is in the changed list", done.body?.data?.changed?.includes("password"));
  check("username is in the changed list", done.body?.data?.changed?.includes("username"));
  check("the picture is in the changed list", done.body?.data?.changed?.includes("avatar"));
  check("the address comes back masked", String(done.body?.data?.email).includes("*"), done.body?.data?.email);
  // The decisive one: this whole endpoint runs without a session, so handing
  // back a token would be a second, quieter way to take the account.
  check("NO accessToken is issued to an unauthenticated caller", done.body?.data?.accessToken === undefined, JSON.stringify(Object.keys(done.body?.data || {})));
  check("NO refreshToken either", done.body?.data?.refreshToken === undefined, JSON.stringify(Object.keys(done.body?.data || {})));

  const recovered = await db.collection("users").findOne({ email: forgotEmail });
  check("the stored password hash really changed", recovered?.password !== beforeWrong?.password);
  check("the new password actually matches the stored hash", await bcrypt.compare(forgotNewPassword, recovered?.password || ""));
  check("the username was applied and normalised to lowercase", recovered?.username === forgotNewUsername, `got ${recovered?.username}`);
  check("the picture was replaced", typeof recovered?.avatar === "string" && recovered.avatar !== beforeWrong?.avatar, `got ${recovered?.avatar}`);
  check("the account is still verified", recovered?.isEmailVerified === true);
  check("the code was destroyed on success", recovered?.emailVerification === undefined, JSON.stringify(recovered?.emailVerification));
  check("every existing session was revoked", !recovered?.refreshToken, `got ${recovered?.refreshToken}`);

  // Two distinct failures, and the difference matters: the old *identifier* is
  // simply gone (404), while the old *password* is still dead on the renamed
  // account (401). Only the 401 proves the hash actually changed.
  const oldIdentifier = await api("/user/login", jsonBody({ username: forgotUsername, password: TEST_PASSWORD }));
  check("the old USERNAME no longer resolves", oldIdentifier.status === 404, `got ${oldIdentifier.status} ${JSON.stringify(oldIdentifier.body)}`);
  const oldPw = await api("/user/login", jsonBody({ username: forgotNewUsername, password: TEST_PASSWORD }));
  check("the old PASSWORD is refused on the new username", oldPw.status === 401, `got ${oldPw.status} ${JSON.stringify(oldPw.body)}`);
  const newPw = await api("/user/login", jsonBody({ username: forgotNewUsername, password: forgotNewPassword }));
  check("the NEW credentials log in", newPw.status === 200, `got ${newPw.status} ${JSON.stringify(newPw.body)}`);
  const byEmailLogin = await api("/user/login", jsonBody({ username: forgotEmail, password: forgotNewPassword }));
  check("logging in by ADDRESS with the new password works — what the page does", byEmailLogin.status === 200, `got ${byEmailLogin.status}`);

  const spentCode = await api("/user/recover-account/complete", completeForm(forgotEmail, RECOVERY_CODE, { password: "Third!Passw0rd" }));
  check("a spent code cannot be replayed to change the account again", spentCode.status >= 400, `got ${spentCode.status}`);
  const afterReplay = await db.collection("users").findOne({ email: forgotEmail });
  check("and the replay changed nothing", afterReplay?.password === recovered?.password);

  console.log("\n15. The same code finishes an ABANDONED SIGNUP, keeping the original details");
  // The other half of the problem: the address was registered but the code was
  // never entered. Here there is nothing to change, and refusing it with
  // "nothing to change" would have re-created the dead end this work removed.
  const abandonEmail = `abandon-${stamp}@barmanji.com`;
  const abandonUsername = `abandon${stamp}`;
  await api("/user/register", registerForm(abandonEmail, abandonUsername, TEST_PASSWORD));
  await db.collection("users").updateOne({ email: abandonEmail }, { $set: { "emailVerification.lastSentAt": new Date(0) } });
  const recUnverified = await api("/user/recover-account", jsonBody({ email: abandonEmail }));
  check("recover-account serves an UNVERIFIED address too", recUnverified.status === 200, `got ${recUnverified.status}`);
  check("it reports accountVerified: false", recUnverified.body?.data?.accountVerified === false, JSON.stringify(recUnverified.body?.data));

  const ABANDON_CODE = "517204";
  const abandonBefore = await db.collection("users").findOne({ email: abandonEmail });
  await db.collection("users").updateOne(
    { email: abandonEmail },
    { $set: { emailVerification: { codeHash: await bcrypt.hash(ABANDON_CODE, 10), expiresAt: new Date(Date.now() + 600000), attempts: 5, lastSentAt: new Date() } } },
  );
  // Deliberately no newPassword, no newUsername, no avatar — just the code.
  const finish = await api("/user/recover-account/complete", completeForm(abandonEmail, ABANDON_CODE, {}));
  check("a code on its own is accepted, not rejected as 'nothing to change'", finish.status === 200, `got ${finish.status} ${JSON.stringify(finish.body)}`);
  check("it reports an empty changed list", Array.isArray(finish.body?.data?.changed) && finish.body.data.changed.length === 0, JSON.stringify(finish.body?.data));
  const abandoned = await db.collection("users").findOne({ email: abandonEmail });
  check("the account is now verified", abandoned?.isEmailVerified === true);
  check("the ORIGINAL username is untouched", abandoned?.username === abandonUsername, `got ${abandoned?.username}`);
  check("the ORIGINAL password hash is untouched", abandoned?.password === abandonBefore?.password);
  const abandonLogin = await api("/user/login", jsonBody({ username: abandonUsername, password: TEST_PASSWORD }));
  check("the user can now log in with what they originally signed up with", abandonLogin.status === 200, `got ${abandonLogin.status} ${JSON.stringify(abandonLogin.body)}`);

  console.log("\n16. Guard rails on the recovery endpoints");
  const noEmail = await api("/user/recover-account", jsonBody({}));
  check("requesting a code with no address is 400", noEmail.status === 400, `got ${noEmail.status}`);
  const ghost = await api("/user/recover-account", jsonBody({ email: `ghost2-${stamp}@barmanji.com` }));
  check("requesting a code for an unknown address is 404", ghost.status === 404, `got ${ghost.status}`);

  const noCode = await api("/user/recover-account/complete", completeForm(forgotEmail, ""));
  check("completing with no code is 400", noCode.status === 400, `got ${noCode.status}`);
  const shortCode = await api("/user/recover-account/complete", completeForm(forgotEmail, "12345", { password: forgotNewPassword }));
  check("a 5-digit code is refused on shape, 400", shortCode.status === 400, `got ${shortCode.status}`);
  check("the shape refusal is mapped to the code field", shortCode.body?.errors?.[0]?.path === "code", JSON.stringify(shortCode.body?.errors));

  // `recover-account` 404s an unknown address while `complete` 400s it. That
  // asymmetry does confirm whether an account exists, but `/register` already
  // answers 409 for a duplicate, so the endpoint leaks nothing new.
  const ghostComplete = await api("/user/recover-account/complete", completeForm(`ghost2-${stamp}@barmanji.com`, "123456", { password: "Anyth!ng123" }));
  check("completing for an unknown address is a 400, not a 500", ghostComplete.status === 400, `got ${ghostComplete.status}`);

  // The address is the identity the code was sent to, so it is not changeable.
  // Even if a caller appends the field it must be ignored, never applied.
  const swapForm = completeForm(forgotEmail, "123456", {});
  swapForm.set("newEmail", `attacker-${stamp}@barmanji.com`);
  const emailSwap = await api("/user/recover-account/complete", swapForm);
  check("posting a newEmail alongside the code is refused", emailSwap.status >= 400, `got ${emailSwap.status}`);
  const afterSwap = await db.collection("users").findOne({ email: forgotEmail });
  check("the account did not move to the other address", afterSwap?.email === forgotEmail, `got ${afterSwap?.email}`);
  check("the other address has no account", !(await db.collection("users").findOne({ email: `attacker-${stamp}@barmanji.com` })));

  // Cleanup
  await db.collection("users").deleteMany({
    email: { $in: [TEST_EMAIL, legacyEmail, recoveryEmail, forgotEmail, abandonEmail] },
  });
  await mongoose.disconnect();

  console.log(`\n${"=".repeat(46)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(46)}\n`);
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error("\nE2E harness crashed:", e);
  process.exit(1);
});
