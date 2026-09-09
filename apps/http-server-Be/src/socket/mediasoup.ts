import cookie from "cookie";
import jwt from "jsonwebtoken";
import { createWorker, types as mediasoupTypes } from "mediasoup";
import { Namespace, Server, Socket } from "socket.io";
import { User, IUser } from "../models/user/user.model.js";
import { ApiError } from "../utils/ApiError.js";

type MediaKind = "audio" | "video";

type MediasoupSocket = Socket & { user?: Pick<IUser, "_id"> & Partial<IUser> };

interface UserInfo {
  _id: string;
  username?: string;
  avatar?: string;
}

interface ProducerInfo {
  producerId: string;
  producerSocketId: string;
  kind: MediaKind;
  user: UserInfo;
}

interface Participant {
  socket: MediasoupSocket;
  user: UserInfo;
  transports: Map<string, mediasoupTypes.WebRtcTransport>;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
}

interface Room {
  router: mediasoupTypes.Router;
  participants: Map<string, Participant>; // keyed by socket.id
}

interface JoinRoomResult {
  success: boolean;
  error?: string;
  rtpCapabilities: mediasoupTypes.RtpCapabilities;
  existingProducers: ProducerInfo[];
}

const rooms: Map<string, Room> = new Map();

let worker: mediasoupTypes.Worker | null = null;
let mediasoupServer: Namespace | null = null;

const initMediasoupWorker = async (): Promise<mediasoupTypes.Worker> => {
  if (worker) return worker;

  worker = await createWorker();

  worker.on("died", () => {
    console.error("Mediasoup worker died");
    worker = null;
  });

  return worker;
};

const createRoom = async (roomId: string): Promise<mediasoupTypes.Router> => {
  const w = await initMediasoupWorker();

  const router = await w.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
      },
      {
        kind: "video",
        mimeType: "video/VP9",
        clockRate: 90000,
        parameters: { "profile-id": 2 },
      },
    ],
  });

  rooms.set(roomId, {
    router,
    participants: new Map(),
  });

  console.log(`Mediasoup room created: ${roomId}`);

  return router;
};

const getOrCreateRoom = async (roomId: string): Promise<Room> => {
  let room = rooms.get(roomId);
  if (!room) {
    const router = await createRoom(roomId);
    room = rooms.get(roomId)!;
    if (!room) {
      // Safety: the createRoom helper registered the room already.
      room = { router, participants: new Map() };
      rooms.set(roomId, room);
    }
  }
  return room;
};

/**
 * Lists every active producer in a room along with the identity of the user
 * that published it. Used so a freshly joined participant can consume the
 * streams that were already being produced before they arrived.
 */
const getRoomProducers = (roomId: string): ProducerInfo[] => {
  const room = rooms.get(roomId);
  if (!room) return [];

  const producers: ProducerInfo[] = [];
  room.participants.forEach((participant) => {
    participant.producers.forEach((producer, producerId) => {
      producers.push({
        producerId,
        producerSocketId: participant.socket.id,
        kind: producer.kind as MediaKind,
        user: participant.user,
      });
    });
  });

  return producers;
};

/**
 * Emits `event` to every participant in the room except the one identified by
 * `exceptSocketId`.
 */
const broadcastToOthers = (
  socket: Socket,
  roomId: string,
  event: string,
  payload: unknown,
): void => {
  const server = mediasoupServer;
  if (!server) return;
  const room = rooms.get(roomId);
  if (!room) return;

  room.participants.forEach((participant) => {
    if (participant.socket.id !== socket.id) {
      server.to(participant.socket.id).emit(event, payload);
    }
  });
};

const joinRoom = async (
  roomId: string,
  socket: MediasoupSocket,
): Promise<JoinRoomResult> => {
  const room = await getOrCreateRoom(roomId);

  const user = socket.user;
  const participant: Participant = {
    socket,
    user: {
      _id: user?._id?.toString() ?? "",
      username: user?.username,
      avatar: user?.avatar,
    },
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };

  room.participants.set(socket.id, participant);
  socket.join(roomId);

  console.log(
    `Participant ${socket.id} (user ${participant.user._id}) joined room ${roomId}`,
  );

  // Tell the people already in the room that a new participant joined.
  broadcastToOthers(socket, roomId, "participant-joined", {
    peerId: participant.user._id,
    user: participant.user,
  });

  return {
    success: true,
    rtpCapabilities: room.router.rtpCapabilities,
    existingProducers: getRoomProducers(roomId).filter(
      (producer) => producer.producerSocketId !== socket.id,
    ),
  };
};

const createTransport = async (
  roomId: string,
  socketId: string,
): Promise<mediasoupTypes.WebRtcTransport> => {
  const room = rooms.get(roomId);
  if (!room) throw new ApiError(404, `Room ${roomId} not found`);

  const participant = room.participants.get(socketId);
  if (!participant) throw new ApiError(404, `Participant ${socketId} not found`);

  const transport = await room.router.createWebRtcTransport({
    listenIps: [
      {
        ip: "0.0.0.0",
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1",
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });

  participant.transports.set(transport.id, transport);

  transport.on("@close", () => {
    participant.transports.delete(transport.id);
  });

  return transport;
};

const transportToClient = (
  transport: mediasoupTypes.WebRtcTransport,
): {
  id: string;
  iceParameters: mediasoupTypes.IceParameters;
  iceCandidates: mediasoupTypes.IceCandidate[];
  dtlsParameters: mediasoupTypes.DtlsParameters;
} => ({
  id: transport.id,
  iceParameters: transport.iceParameters,
  iceCandidates: transport.iceCandidates,
  dtlsParameters: transport.dtlsParameters,
});

const connectTransport = async (
  roomId: string,
  socketId: string,
  transportId: string,
  dtlsParameters: mediasoupTypes.DtlsParameters,
): Promise<void> => {
  const room = rooms.get(roomId);
  if (!room) throw new ApiError(404, `Room ${roomId} not found`);

  const participant = room.participants.get(socketId);
  if (!participant) throw new ApiError(404, `Participant ${socketId} not found`);

  const transport = participant.transports.get(transportId);
  if (!transport) throw new ApiError(404, `Transport ${transportId} not found`);

  await transport.connect({ dtlsParameters });
};

const produce = async (
  roomId: string,
  socketId: string,
  transportId: string,
  kind: MediaKind,
  rtpParameters: mediasoupTypes.RtpParameters,
): Promise<mediasoupTypes.Producer> => {
  const room = rooms.get(roomId);
  if (!room) throw new ApiError(404, `Room ${roomId} not found`);

  const participant = room.participants.get(socketId);
  if (!participant) throw new ApiError(404, `Participant ${socketId} not found`);

  const transport = participant.transports.get(transportId);
  if (!transport) throw new ApiError(404, `Transport ${transportId} not found`);

  const producer = await transport.produce({
    kind,
    rtpParameters,
  });

  participant.producers.set(producer.id, producer);

  producer.on("transportclose", () => {
    participant.producers.delete(producer.id);
  });

  console.log(
    `Producer ${producer.id} (${producer.kind}) created by user ${participant.user._id}`,
  );

  return producer;
};

const consume = async (
  roomId: string,
  socketId: string,
  transportId: string,
  producerId: string,
  rtpCapabilities: mediasoupTypes.RtpCapabilities,
): Promise<mediasoupTypes.Consumer> => {
  const room = rooms.get(roomId);
  if (!room) throw new ApiError(404, `Room ${roomId} not found`);

  const participant = room.participants.get(socketId);
  if (!participant) throw new ApiError(404, `Participant ${socketId} not found`);

  const transport = participant.transports.get(transportId);
  if (!transport) throw new ApiError(404, `Transport ${transportId} not found`);

  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: false,
  });

  participant.consumers.set(consumer.id, consumer);

  consumer.on("transportclose", () => {
    participant.consumers.delete(consumer.id);
  });

  return consumer;
};

const leaveRoom = (
  roomId: string,
  socket: MediasoupSocket,
  signalOthers: boolean,
): void => {
  const room = rooms.get(roomId);
  if (!room) return;

  const participant = room.participants.get(socket.id);
  if (!participant) return;

  // Notify the remaining participants that this user left so their UI can
  // remove the person and free the associated media resources.
  if (signalOthers) {
    broadcastToOthers(socket, roomId, "participant-left", {
      peerId: participant.user._id,
    });
  }

  participant.producers.forEach((producer) => producer.close());
  participant.consumers.forEach((consumer) => consumer.close());
  participant.transports.forEach((transport) => transport.close());

  room.participants.delete(socket.id);
  socket.leave(roomId);

  console.log(`Participant ${socket.id} left room ${roomId}`);

  if (room.participants.size === 0) {
    room.router.close();
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted (no participants)`);
  }
};

/**
 * Resolves the user for the mediasoup namespace socket. The user must already
 * be authenticated against the main app: we re-read the JWT from the cookies
 * or the handshake `auth.token` (same as the main socket sketch).
 */
const authenticateSocket = async (socket: MediasoupSocket): Promise<void> => {
  const cookieHeader = socket.handshake.headers?.cookie;
  const cookies = cookie.parse(cookieHeader?.toString() || "");

  let token: string | undefined = cookies?.accessToken;
  if (!token) {
    token = (
      socket.handshake.auth as
        | Record<string, string | undefined>
        | undefined
    )?.token;
  }

  if (!token) {
    throw new ApiError(401, "Un-authorized handshake. Token is missing");
  }

  const decodedToken = jwt.verify(
    token,
    process.env.ACCESS_TOKEN_SECRET as string,
  ) as { _id: string };

  const user = await User.findById(decodedToken?._id).select(
    "-password -refreshToken",
  );

  if (!user) {
    throw new ApiError(401, "Un-authorized handshake. Token is invalid");
  }

  socket.user = user as unknown as MediasoupSocket["user"];
  socket.join(user._id!.toString());
};

export const setupMediasoup = (io: Server): void => {
  mediasoupServer = io.of("/mediasoup");

  mediasoupServer.use(async (socket, next) => {
    try {
      await authenticateSocket(socket as MediasoupSocket);
      next();
    } catch (error: unknown) {
      console.error("Mediasoup auth error:", (error as Error)?.message);
      next(
        error instanceof Error
          ? error
          : new Error("Un-authorized mediasoup handshake"),
      );
    }
  });

  mediasoupServer.on("connection", async (rawSocket: Socket) => {
    const socket = rawSocket as MediasoupSocket;
    console.log("Mediasoup socket connected:", socket.id);

    socket.on("join-room", async ({ roomId }, callback) => {
      try {
        if (!roomId) throw new ApiError(400, "roomId is required");
        const result = await joinRoom(roomId, socket);
        callback(result);
      } catch (error) {
        console.error("Error joining room:", error);
        callback({
          success: false,
          error: String((error as Error)?.message || error),
        });
      }
    });

    socket.on("create-transport", async ({ roomId }, callback) => {
      try {
        const transport = await createTransport(roomId, socket.id);
        callback({ success: true, ...transportToClient(transport) });
      } catch (error) {
        console.error("Error creating transport:", error);
        callback({
          success: false,
          error: String((error as Error)?.message || error),
        });
      }
    });

    socket.on(
      "connect-transport",
      async ({ roomId, transportId, dtlsParameters }, callback) => {
        try {
          await connectTransport(roomId, socket.id, transportId, dtlsParameters);
          callback({ success: true });
        } catch (error) {
          console.error("Error connecting transport:", error);
          callback({
            success: false,
            error: String((error as Error)?.message || error),
          });
        }
      },
    );

    socket.on(
      "produce",
      async ({ roomId, transportId, kind, rtpParameters }, callback) => {
        try {
          const producer = await produce(
            roomId,
            socket.id,
            transportId,
            kind,
            rtpParameters,
          );
          broadcastToOthers(socket, roomId, "new-producer", {
            producerId: producer.id,
            producerSocketId: socket.id,
            kind: producer.kind as MediaKind,
            user: {
              _id: socket.user?._id?.toString(),
              username: socket.user?.username,
              avatar: socket.user?.avatar,
            },
          });
          callback({ success: true, producerId: producer.id });
        } catch (error) {
          console.error("Error producing:", error);
          callback({
            success: false,
            error: String((error as Error)?.message || error),
          });
        }
      },
    );

    socket.on(
      "consume",
      async ({ roomId, transportId, producerId, rtpCapabilities }, callback) => {
        try {
          const consumer = await consume(
            roomId,
            socket.id,
            transportId,
            producerId,
            rtpCapabilities,
          );
          callback({
            success: true,
            id: consumer.id,
            producerId,
            kind: consumer.kind as MediaKind,
            rtpParameters: consumer.rtpParameters,
          });
        } catch (error) {
          console.error("Error consuming:", error);
          callback({
            success: false,
            error: String((error as Error)?.message || error),
          });
        }
      },
    );

    socket.on("get-participants", ({ roomId }, callback) => {
      const room = rooms.get(roomId);
      callback({
        participants: room
          ? Array.from(room.participants.values()).map(
              (participant) => participant.user,
            )
          : [],
      });
    });

    socket.on("leave-room", ({ roomId }) => {
      leaveRoom(roomId, socket, true);
    });

    socket.on("disconnect", () => {
      rooms.forEach((room, roomId) => {
        if (room.participants.has(socket.id)) {
          leaveRoom(roomId, socket, true);
        }
      });
    });
  });
};

export { createRoom, joinRoom };