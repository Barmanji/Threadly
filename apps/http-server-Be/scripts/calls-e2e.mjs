/**
 * Exercises the server-side call logger against a live database.
 *
 * Calls are driven by socket events rather than HTTP, so instead of a socket
 * client this imports the compiled service and drives it directly, with a stub
 * `io` that records everything the server tried to emit. That keeps the test
 * focused on the parts that are easy to get wrong:
 *
 *   - exactly ONE message per call, however many "it ended" reports arrive
 *   - the status (completed / missed / rejected / cancelled) and duration
 *   - a group call that survives members coming and going, logging once at the
 *     end rather than once per participant
 *
 * Run: RUN_E2E=1 node scripts/calls-e2e.mjs
 * Requires a prior `pnpm build` — it imports from dist/.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

if (process.env.RUN_E2E !== "1") {
  console.error(
    "\nRefusing to run: this script writes to the configured database.\n" +
      "Re-run with RUN_E2E=1 if that's intentional.\n",
  );
  process.exit(2);
}

dotenv.config({ path: "./.env" });

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

/** Records every `io.to(room).emit(event, payload)` the service makes. */
const makeIo = () => {
  const emitted = [];
  return {
    emitted,
    io: {
      to(room) {
        return {
          emit(event, payload) {
            emitted.push({ room: String(room), event, payload });
          },
        };
      },
    },
  };
};

const oid = () => new mongoose.Types.ObjectId();

const main = async () => {
  await mongoose.connect(process.env.MONGODB_LOCAL_URI, { dbName: DB_NAME });
  const db = mongoose.connection.db;

  // Imported after the connection exists so the models bind to it.
  const service = await import("../dist/services/callLog.service.js");

  const created = { users: [], chats: [] };
  const makeUsers = async (prefix, count) => {
    const users = [];
    for (let i = 0; i < count; i++) {
      users.push({
        _id: oid(),
        username: `${prefix}${i}`,
        email: `${prefix}${i}@barmanji.com`,
        avatar: "https://example.com/a.png",
        password: "not-a-real-hash",
      });
    }
    // Written straight to the collection: these users only need to exist for
    // the aggregation's `$lookup`, so there's no reason to drag the whole
    // registration/OTP flow in.
    await db.collection("users").insertMany(users);
    created.users.push(...users);
    return users;
  };

  const makeChat = async (participants, isGroupChat = false) => {
    const chat = {
      _id: oid(),
      participants: participants.map((u) => u._id),
      isGroupChat,
      ...(isGroupChat ? { name: "Test group", admin: participants[0]._id } : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection("chats").insertOne(chat);
    created.chats.push(chat._id);
    return chat;
  };

  /** Every call message stored against a chat. */
  const callMessages = (chatId) =>
    db
      .collection("chatmessages")
      .find({ chat: chatId, type: "call" })
      .toArray();

  const MESSAGE_RECEIVED = "messageReceived";

  try {
    /* ---------------------------------------------------------------- */
    console.log("\n1. A 1:1 call that was answered, then hung up");

    const a = await makeUsers("cl-a", 2);
    const chatA = await makeChat(a);
    const ioA = makeIo();

    service.startP2PCall({
      callerId: String(a[0]._id),
      calleeId: String(a[1]._id),
      chatId: String(chatA._id),
      callType: "video",
    });
    service.markCallAnswered(String(a[1]._id), String(a[0]._id));
    // Both sides report the hangup, which is exactly the double-report the
    // dedupe has to absorb.
    await service.endP2PCall({
      a: String(a[0]._id),
      b: String(a[1]._id),
      endedBy: String(a[0]._id),
      io: ioA.io,
    });
    await service.endP2PCall({
      a: String(a[1]._id),
      b: String(a[0]._id),
      endedBy: String(a[1]._id),
      io: ioA.io,
    });

    let msgs = await callMessages(chatA._id);
    check("exactly one message for the call", msgs.length === 1, `got ${msgs.length}`);
    check("it is a call message", msgs[0]?.type === "call", JSON.stringify(msgs[0]?.type));
    check("status is completed", msgs[0]?.call?.status === "completed", msgs[0]?.call?.status);
    check("call type carried through", msgs[0]?.call?.callType === "video", msgs[0]?.call?.callType);
    check("duration is at least a second", msgs[0]?.call?.durationSeconds >= 1, String(msgs[0]?.call?.durationSeconds));
    check("not marked as a group call", msgs[0]?.call?.isGroup === false, String(msgs[0]?.call?.isGroup));
    check("content is human readable", /Video call/.test(msgs[0]?.content ?? ""), msgs[0]?.content);
    check("sender is the initiator", String(msgs[0]?.sender) === String(a[0]._id));
    check("endedBy is recorded", String(msgs[0]?.call?.endedBy) === String(a[0]._id));
    check("emitted to both participants", ioA.emitted.length === 2, `got ${ioA.emitted.length}`);
    check(
      "emitted as a received message",
      ioA.emitted.every((e) => e.event === MESSAGE_RECEIVED),
      JSON.stringify(ioA.emitted.map((e) => e.event)),
    );

    // The socket payload is what the client renders, so it has to be the
    // populated shape — not raw ObjectIds.
    const payload = ioA.emitted[0]?.payload;
    check("payload has a populated sender", typeof payload?.sender?.username === "string", JSON.stringify(payload?.sender));
    check("payload has a populated endedBy", typeof payload?.call?.endedBy?.username === "string", JSON.stringify(payload?.call?.endedBy));
    check("payload carries the duration", typeof payload?.call?.durationSeconds === "number");

    /* ---------------------------------------------------------------- */
    console.log("\n2. A 1:1 call nobody answered");

    const b = await makeUsers("cl-b", 2);
    const chatB = await makeChat(b);
    const ioB = makeIo();

    service.startP2PCall({
      callerId: String(b[0]._id),
      calleeId: String(b[1]._id),
      chatId: String(chatB._id),
      callType: "audio",
    });
    // The caller gives up / hangs up without the call ever being answered.
    await service.endP2PCall({
      a: String(b[0]._id),
      b: String(b[1]._id),
      endedBy: String(b[0]._id),
      io: ioB.io,
    });

    msgs = await callMessages(chatB._id);
    check("one message", msgs.length === 1, `got ${msgs.length}`);
    check("status is missed", msgs[0]?.call?.status === "missed", msgs[0]?.call?.status);
    check("duration is zero for an unanswered call", msgs[0]?.call?.durationSeconds === 0, String(msgs[0]?.call?.durationSeconds));
    check("content says missed", /^Missed /.test(msgs[0]?.content ?? ""), msgs[0]?.content);

    /* ---------------------------------------------------------------- */
    console.log("\n3. A 1:1 call that was declined");

    const c = await makeUsers("cl-c", 2);
    const chatC = await makeChat(c);
    const ioC = makeIo();

    service.startP2PCall({
      callerId: String(c[0]._id),
      calleeId: String(c[1]._id),
      chatId: String(chatC._id),
      callType: "video",
    });
    await service.endP2PCall({
      a: String(c[1]._id),
      b: String(c[0]._id),
      endedBy: String(c[1]._id),
      rejected: true,
      io: ioC.io,
    });

    msgs = await callMessages(chatC._id);
    check("one message", msgs.length === 1, `got ${msgs.length}`);
    check("status is rejected", msgs[0]?.call?.status === "rejected", msgs[0]?.call?.status);
    check("endedBy is the decliner", String(msgs[0]?.call?.endedBy) === String(c[1]._id));

    /* ---------------------------------------------------------------- */
    console.log("\n4. A 1:1 call cut off by a closed tab");

    const d = await makeUsers("cl-d", 2);
    const chatD = await makeChat(d);
    const ioD = makeIo();

    service.startP2PCall({
      callerId: String(d[0]._id),
      calleeId: String(d[1]._id),
      chatId: String(chatD._id),
      callType: "audio",
    });
    service.markCallAnswered(String(d[1]._id), String(d[0]._id));
    // No `call-ended` at all — the socket just goes away.
    await service.finalizeCallsForUser(String(d[1]._id), ioD.io);
    // A second disconnect must not produce a second message.
    await service.finalizeCallsForUser(String(d[1]._id), ioD.io);

    msgs = await callMessages(chatD._id);
    check("one message despite two disconnect passes", msgs.length === 1, `got ${msgs.length}`);
    check("status is completed", msgs[0]?.call?.status === "completed", msgs[0]?.call?.status);

    /* ---------------------------------------------------------------- */
    console.log("\n5. Both users dial each other at once (glare)");

    const e = await makeUsers("cl-e", 2);
    const chatE = await makeChat(e);
    const ioE = makeIo();

    service.startP2PCall({
      callerId: String(e[0]._id),
      calleeId: String(e[1]._id),
      chatId: String(chatE._id),
      callType: "video",
    });
    // The other direction of the same call — must not create a second session.
    service.startP2PCall({
      callerId: String(e[1]._id),
      calleeId: String(e[0]._id),
      chatId: String(chatE._id),
      callType: "video",
    });
    service.markCallAnswered(String(e[0]._id), String(e[1]._id));
    await service.endP2PCall({
      a: String(e[0]._id),
      b: String(e[1]._id),
      endedBy: String(e[0]._id),
      io: ioE.io,
    });

    msgs = await callMessages(chatE._id);
    check("glare still yields one message", msgs.length === 1, `got ${msgs.length}`);

    /* ---------------------------------------------------------------- */
    console.log("\n6. A group call nobody joined is cancelled");

    const g = await makeUsers("cl-g", 3);
    const chatG = await makeChat(g, true);
    const ioG = makeIo();

    service.startGroupCall({
      roomId: String(chatG._id),
      callType: "video",
      initiatorId: String(g[0]._id),
    });
    await service.endGroupCall({
      roomId: String(chatG._id),
      endedBy: String(g[0]._id),
      io: ioG.io,
    });

    msgs = await callMessages(chatG._id);
    check("one message", msgs.length === 1, `got ${msgs.length}`);
    check("status is cancelled", msgs[0]?.call?.status === "cancelled", msgs[0]?.call?.status);
    check("marked as a group call", msgs[0]?.call?.isGroup === true, String(msgs[0]?.call?.isGroup));

    /* ---------------------------------------------------------------- */
    console.log("\n7. A group call with joiners and leavers logs exactly once");

    const h = await makeUsers("cl-h", 3);
    const chatH = await makeChat(h, true);
    const ioH = makeIo();
    const room = String(chatH._id);

    service.startGroupCall({
      roomId: room,
      callType: "audio",
      initiatorId: String(h[0]._id),
    });
    service.markGroupCallJoined(room, String(h[1]._id));
    service.markGroupCallJoined(room, String(h[2]._id));

    // One member leaves while another is still on the call: not over yet.
    await service.markGroupCallLeft({ roomId: room, userId: String(h[1]._id), io: ioH.io });
    msgs = await callMessages(chatH._id);
    check("no message while someone is still on the call", msgs.length === 0, `got ${msgs.length}`);

    // The last member leaves: now it's over, and it logs once.
    await service.markGroupCallLeft({ roomId: room, userId: String(h[2]._id), io: ioH.io });
    // A straggler report from another member must not add a second message.
    await service.markGroupCallLeft({ roomId: room, userId: String(h[0]._id), io: ioH.io });
    await service.endGroupCall({ roomId: room, endedBy: String(h[0]._id), io: ioH.io });

    msgs = await callMessages(chatH._id);
    check("exactly one message for the whole call", msgs.length === 1, `got ${msgs.length}`);
    check("status is completed", msgs[0]?.call?.status === "completed", msgs[0]?.call?.status);
    check("duration is at least a second", msgs[0]?.call?.durationSeconds >= 1, String(msgs[0]?.call?.durationSeconds));
    check("sender is the group call initiator", String(msgs[0]?.sender) === String(h[0]._id));

    /* ---------------------------------------------------------------- */
    console.log("\n8. A group call ended by the initiator's disconnect");

    const i2 = await makeUsers("cl-i", 3);
    const chatI = await makeChat(i2, true);
    const ioI = makeIo();
    const roomI = String(chatI._id);

    service.startGroupCall({
      roomId: roomI,
      callType: "video",
      initiatorId: String(i2[0]._id),
    });
    service.markGroupCallJoined(roomI, String(i2[1]._id));
    service.markGroupCallJoined(roomI, String(i2[2]._id));
    // One of the joined members' tab closes. The call keeps running...
    await service.finalizeCallsForUser(String(i2[1]._id), ioI.io);
    msgs = await callMessages(chatI._id);
    check("call survives one member dropping", msgs.length === 0, `got ${msgs.length}`);

    // ...until the last one goes.
    await service.finalizeCallsForUser(String(i2[2]._id), ioI.io);
    msgs = await callMessages(chatI._id);
    check("logs once when the last member drops", msgs.length === 1, `got ${msgs.length}`);
    check("status is completed", msgs[0]?.call?.status === "completed", msgs[0]?.call?.status);

    /* ---------------------------------------------------------------- */
    console.log("\n9. A plain text message is untouched by the call shape");

    const j = await makeUsers("cl-j", 2);
    const chatJ = await makeChat(j);
    await db.collection("chatmessages").insertOne({
      sender: j[0]._id,
      chat: chatJ._id,
      content: "just talking",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const [textMsg] = await db
      .collection("chatmessages")
      .aggregate([
        { $match: { chat: chatJ._id } },
        ...(await import("../dist/utils/messageAggregation.js")).chatMessageCommonAggregation(),
      ])
      .toArray();
    check("text message has no call object", textMsg?.call === undefined, JSON.stringify(textMsg?.call));
    check("text message has no reactions object", textMsg?.reactions === undefined || Array.isArray(textMsg?.reactions), JSON.stringify(textMsg?.reactions));
    check("text message content survived", textMsg?.content === "just talking");
  } finally {
    // Clean up everything this run created.
    await db.collection("users").deleteMany({ _id: { $in: created.users.map((u) => u._id) } });
    await db.collection("chats").deleteMany({ _id: { $in: created.chats } });
    await db.collection("chatmessages").deleteMany({ chat: { $in: created.chats } });
    await mongoose.disconnect();
  }

  console.log(`\n${"=".repeat(46)}\n  ${pass} passed, ${fail} failed\n${"=".repeat(46)}\n`);
  process.exit(fail === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error("\nCall-log harness crashed:", e);
  process.exit(1);
});
