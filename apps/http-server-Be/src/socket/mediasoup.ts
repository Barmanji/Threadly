import { createWorker, types as mediasoupTypes } from "mediasoup";
import { Server, Socket } from "socket.io";

interface Room {
  router: mediasoupTypes.Router;
  participants: Map<string, Participant>;
}

interface Participant {
  socket: Socket;
  transports: Map<string, mediasoupTypes.WebRtcTransport>;
  producers: Map<string, mediasoupTypes.Producer>;
  consumers: Map<string, mediasoupTypes.Consumer>;
}

interface CreateRoomResponse {
  routerRtpCapabilities: mediasoupTypes.RtpCapabilities;
  roomId: string;
}

const rooms: Map<string, Room> = new Map();

let worker: mediasoupTypes.Worker | null = null;

const initMediasoupWorker = async (): Promise<mediasoupTypes.Worker> => {
  if (worker) return worker;

  worker = await createWorker();

  worker.on("died", () => {
    console.error("Mediasoup worker died");
    worker = null;
  });

  return worker;
};

const createRoom = async (roomId: string): Promise<CreateRoomResponse> => {
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

  console.log(`Room created: ${roomId}`);

  return {
    routerRtpCapabilities: router.rtpCapabilities,
    roomId,
  };
};

const getOrCreateRoom = async (roomId: string): Promise<Room> => {
  let room = rooms.get(roomId);
  if (!room) {
    await createRoom(roomId);
    room = rooms.get(roomId)!;
  }
  return room;
};

const joinRoom = async (
  roomId: string,
  socket: Socket,
): Promise<Participant> => {
  const room = await getOrCreateRoom(roomId);

  const participant: Participant = {
    socket,
    transports: new Map(),
    producers: new Map(),
    consumers: new Map(),
  };

  room.participants.set(socket.id, participant);
  socket.join(roomId);

  console.log(`Participant ${socket.id} joined room ${roomId}`);

  return participant;
};

const createTransport = async (
  roomId: string,
  socketId: string,
  direction: "send" | "recv",
): Promise<any> => {
  const room = rooms.get(roomId);
  if (!room) throw new Error(`Room ${roomId} not found`);

  const participant = room.participants.get(socketId);
  if (!participant) throw new Error(`Participant ${socketId} not found`);

  const transport = await room.router.createWebRtcTransport({
    listenIps: [
      {
        ip: "0.0.0.0",
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || "127.0.0.1",
      },
    ],
  });

  participant.transports.set(transport.id, transport);

  return {
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters,
  };
};

const connectTransport = async (
  roomId: string,
  socketId: string,
  transportId: string,
  dtlsParameters: mediasoupTypes.DtlsParameters,
): Promise<void> => {
  const room = rooms.get(roomId);
  if (!room) throw new Error(`Room ${roomId} not found`);

  const participant = room.participants.get(socketId);
  if (!participant) throw new Error(`Participant ${socketId} not found`);

  const transport = participant.transports.get(transportId);
  if (!transport) throw new Error(`Transport ${transportId} not found`);

  await transport.connect({ dtlsParameters });
};

const produce = async (
  roomId: string,
  socketId: string,
  transportId: string,
  kind: "audio" | "video",
  rtpParameters: mediasoupTypes.RtpParameters,
): Promise<{ producerId: string }> => {
  const room = rooms.get(roomId);
  if (!room) throw new Error(`Room ${roomId} not found`);

  const participant = room.participants.get(socketId);
  if (!participant) throw new Error(`Participant ${socketId} not found`);

  const transport = participant.transports.get(transportId);
  if (!transport) throw new Error(`Transport ${transportId} not found`);

  const producer = await transport.produce({
    kind,
    rtpParameters,
  });

  participant.producers.set(producer.id, producer);

  producer.on("transportclose", () => {
    participant.producers.delete(producer.id);
  });

  return { producerId: producer.id };
};

const consume = async (
  roomId: string,
  socketId: string,
  transportId: string,
  producerId: string,
  rtpCapabilities: mediasoupTypes.RtpCapabilities,
): Promise<any> => {
  const room = rooms.get(roomId);
  if (!room) throw new Error(`Room ${roomId} not found`);

  const participant = room.participants.get(socketId);
  if (!participant) throw new Error(`Participant ${socketId} not found`);

  const transport = participant.transports.get(transportId);
  if (!transport) throw new Error(`Transport ${transportId} not found`);

  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: false,
  });

  participant.consumers.set(consumer.id, consumer);

  consumer.on("transportclose", () => {
    participant.consumers.delete(consumer.id);
  });

  return {
    id: consumer.id,
    producerId,
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters,
  };
};

const getRoomParticipants = (roomId: string): string[] => {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.participants.keys());
};

const leaveRoom = (roomId: string, socketId: string, socket?: Socket): void => {
  const room = rooms.get(roomId);
  if (!room) return;

  const participant = room.participants.get(socketId);
  if (!participant) return;

  participant.producers.forEach((producer) => producer.close());
  participant.consumers.forEach((consumer) => consumer.close());
  participant.transports.forEach((transport) => transport.close());

  room.participants.delete(socketId);
  if (socket) {
    socket.leave(roomId);
  }

  if (room.participants.size === 0) {
    room.router.close();
    rooms.delete(roomId);
    console.log(`Room ${roomId} deleted (no participants)`);
  }

  console.log(`Participant ${socketId} left room ${roomId}`);
};

export const setupMediasoup = (io: Server) => {
  io.of("/mediasoup").on("connection", async (socket: Socket) => {
    console.log("Mediasoup socket connected:", socket.id);

    socket.on("join-room", async ({ roomId }, callback) => {
      try {
        await joinRoom(roomId, socket);

        if (!rooms.has(roomId)) {
          const { routerRtpCapabilities } = await createRoom(roomId);
          callback({ success: true, rtpCapabilities: routerRtpCapabilities });
        } else {
          const room = rooms.get(roomId)!;
          callback({
            success: true,
            rtpCapabilities: room.router.rtpCapabilities,
          });
        }
      } catch (error) {
        console.error("Error joining room:", error);
        callback({ success: false, error: String(error) });
      }
    });

    socket.on("create-transport", async ({ roomId, direction }, callback) => {
      try {
        const transport = await createTransport(roomId, socket.id, direction);
        callback({ success: true, ...transport });
      } catch (error) {
        console.error("Error creating transport:", error);
        callback({ success: false, error: String(error) });
      }
    });

    socket.on(
      "connect-transport",
      async ({ roomId, transportId, dtlsParameters }, callback) => {
        try {
          await connectTransport(
            roomId,
            socket.id,
            transportId,
            dtlsParameters,
          );
          callback({ success: true });
        } catch (error) {
          console.error("Error connecting transport:", error);
          callback({ success: false, error: String(error) });
        }
      },
    );

    socket.on(
      "produce",
      async ({ roomId, transportId, kind, rtpParameters }, callback) => {
        try {
          const result = await produce(
            roomId,
            socket.id,
            transportId,
            kind,
            rtpParameters,
          );
          const room = rooms.get(roomId);
          if (room) {
            room.participants.forEach((p, pid) => {
              if (pid !== socket.id) {
                io.of("/mediasoup").to(p.socket.id).emit("new-producer", {
                  producerId: result.producerId,
                  producerSocketId: socket.id,
                  kind,
                });
              }
            });
          }
          callback({ success: true, producerId: result.producerId });
        } catch (error) {
          console.error("Error producing:", error);
          callback({ success: false, error: String(error) });
        }
      },
    );

    socket.on(
      "consume",
      async (
        { roomId, transportId, producerId, rtpCapabilities },
        callback,
      ) => {
        try {
          const consumerData = await consume(
            roomId,
            socket.id,
            transportId,
            producerId,
            rtpCapabilities,
          );
          callback({ success: true, ...consumerData });
        } catch (error) {
          console.error("Error consuming:", error);
          callback({ success: false, error: String(error) });
        }
      },
    );

    socket.on("get-participants", ({ roomId }, callback) => {
      callback({ participants: getRoomParticipants(roomId) });
    });

    socket.on("leave-room", ({ roomId }) => {
      leaveRoom(roomId, socket.id, socket);
    });

    socket.on("disconnect", () => {
      rooms.forEach((room, roomId) => {
        if (room.participants.has(socket.id)) {
          leaveRoom(roomId, socket.id, socket);
        }
      });
    });
  });
};

export { createRoom, joinRoom };
