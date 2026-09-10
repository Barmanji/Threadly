import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import * as mediasoupClient from "mediasoup-client";
import socketio, { type Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";
import { useSocket } from "./SocketContext";
import { LocalStorage } from "../utils";
import { toast } from "sonner";

type MediaKind = "audio" | "video";

export interface GroupCallParticipant {
  id: string; // user _id
  username?: string;
  avatar?: string;
  stream: MediaStream;
}

interface MediaState {
  video: boolean;
  audio: boolean;
}

interface ProducerInfo {
  producerId: string;
  peerId: string;
  kind: MediaKind;
  user?: { _id: string; username?: string; avatar?: string };
}

interface ConsumerEntry {
  consumer: mediasoupClient.types.Consumer;
  peerId: string;
  kind: MediaKind;
}

interface GroupCallContextType {
  isInCall: boolean;
  roomId: string | null;
  localStream: MediaStream | null;
  participants: Map<string, GroupCallParticipant>;
  mediaStates: Map<string, MediaState>;
  startGroupCall: (
    roomId: string,
    callType: "video" | "audio",
    invitees?: string[],
  ) => Promise<void>;
  joinGroupCall: (roomId: string, callType?: "video" | "audio") => Promise<void>;
  leaveGroupCall: () => void;
  toggleLocalVideo: () => Promise<void>;
  toggleLocalAudio: () => void;
}

interface JoinRoomResponse {
  success?: boolean;
  error?: string;
  rtpCapabilities: mediasoupClient.types.RtpCapabilities;
  existingProducers?: ProducerInfo[];
}

interface CreateTransportResponse {
  success?: boolean;
  error?: string;
  id: string;
  iceParameters: mediasoupClient.types.IceParameters;
  iceCandidates: mediasoupClient.types.IceCandidate[];
  dtlsParameters: mediasoupClient.types.DtlsParameters;
}

interface ProduceResponse {
  success?: boolean;
  error?: string;
  producerId: string;
}

interface ConsumeResponse {
  success?: boolean;
  error?: string;
  id: string;
  producerId: string;
  kind: MediaKind;
  rtpParameters: mediasoupClient.types.RtpParameters;
}

const GroupCallContext = createContext<GroupCallContextType | null>(null);

export const useGroupCall = () => {
  const context = useContext(GroupCallContext);
  if (!context) {
    throw new Error("useGroupCall must be used within a GroupCallProvider");
  }
  return context;
};

/**
 * The mediasoup SFU lives on the same backend as the main Socket.IO server but
 * on the dedicated `/mediasoup` namespace. `path` must NOT be changed — the
 * namespace is what the backend's `io.of("/mediasoup")` registers.
 */
const getMediasoupURI = (): string => {
  const base = (
    import.meta.env.VITE_MEDIASOUP_URL ||
    import.meta.env.VITE_SOCKET_URI ||
    "http://localhost:3004"
  ).replace(/\/$/, "");
  return `${base}/mediasoup`;
};

const emitAck = <T,>(
  socket: Socket,
  event: string,
  payload?: unknown,
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    socket.emit(event, payload ?? {}, (response: T) => {
      if (
        response &&
        typeof response === "object" &&
        "success" in response &&
        (response as { success?: boolean }).success === false
      ) {
        reject(
          new Error(
            (response as { error?: string }).error || "Socket request failed",
          ),
        );
        return;
      }
      resolve(response);
    });
  });

export const GroupCallProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const { socket: mainSocket } = useSocket();

  const [isInCall, setIsInCall] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<
    Map<string, GroupCallParticipant>
  >(new Map());
  const [mediaStates, setMediaStates] = useState<Map<string, MediaState>>(
    new Map(),
  );

  const deviceRef = useRef<mediasoupClient.Device | null>(null);
  const sendTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const recvTransportRef = useRef<mediasoupClient.types.Transport | null>(null);
  const producersRef = useRef<mediasoupClient.types.Producer[]>([]);
  const consumersRef = useRef<Map<string, ConsumerEntry>>(new Map());
  const socketRef = useRef<Socket | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const participantNamesRef = useRef<Map<string, string>>(new Map());
  const isCallInitiatorRef = useRef(false);
  const pendingInviteesRef = useRef<string[]>([]);

  const ownPeerId = user?._id?.toString();

  const addParticipant = useCallback((info: {
    _id: string;
    username?: string;
    avatar?: string;
  }) => {
    participantNamesRef.current.set(info._id, info.username ?? "Someone");
    setParticipants((prev) => {
      if (prev.has(info._id)) return prev;
      const next = new Map(prev);
      next.set(info._id, {
        id: info._id,
        username: info.username,
        avatar: info.avatar,
        stream: new MediaStream(),
      });
      return next;
    });
    toast.info(`${info.username ?? "Someone"} joined the call`);
  }, []);

  const removeParticipant = useCallback((peerId: string) => {
    const name = participantNamesRef.current.get(peerId) ?? "Someone";
    participantNamesRef.current.delete(peerId);
    const toRemove: string[] = [];
    consumersRef.current.forEach((entry, producerId) => {
      if (entry.peerId === peerId) toRemove.push(producerId);
    });
    toRemove.forEach((producerId) => {
      try {
        consumersRef.current.get(producerId)?.consumer.close();
      } catch {
        // Consumer may already be closed
      }
      consumersRef.current.delete(producerId);
    });

    setParticipants((prev) => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
    setMediaStates((prev) => {
      const next = new Map(prev);
      next.delete(peerId);
      return next;
    });
    toast.info(`${name} left the call`);
  }, []);

  const consumeProducer = useCallback(
    async (info: ProducerInfo) => {
      const socket = socketRef.current;
      const device = deviceRef.current;
      const recvTransport = recvTransportRef.current;
      const callRoomId = roomIdRef.current;
      if (!socket || !device || !recvTransport || !callRoomId) return;

      try {
        const result = await emitAck<ConsumeResponse>(socket, "consume", {
          roomId: callRoomId,
          transportId: recvTransport.id,
          producerId: info.producerId,
          rtpCapabilities: device.rtpCapabilities,
        });

        const consumer = await recvTransport.consume({
          id: result.id,
          producerId: result.producerId,
          kind: result.kind,
          rtpParameters: result.rtpParameters,
        });

        consumersRef.current.set(result.producerId, {
          consumer,
          peerId: info.peerId,
          kind: result.kind,
        });

        const handleConsumerClosed = () => {
          if (!consumersRef.current.delete(result.producerId)) return;
          setParticipants((prev) => {
            const next = new Map(prev);
            const participant = next.get(info.peerId);
            if (participant) {
              participant.stream.removeTrack(consumer.track);
              next.set(info.peerId, { ...participant });
            }
            return next;
          });
        };
        consumer.on("trackended", handleConsumerClosed);
        consumer.on("@close", handleConsumerClosed);

        setParticipants((prev) => {
          const next = new Map(prev);
          let participant = next.get(info.peerId);
          if (!participant) {
            participantNamesRef.current.set(
              info.peerId,
              info.user?.username ?? "Someone",
            );
            participant = {
              id: info.peerId,
              username: info.user?.username,
              avatar: info.user?.avatar,
              stream: new MediaStream(),
            };
          }
          const tracks = participant.stream.getTracks();
          const alreadyAdded = tracks.some(
            (track) =>
              track.kind === consumer.track.kind && track.id === consumer.track.id,
          );
          if (!alreadyAdded) {
            participant.stream.addTrack(consumer.track);
            participant = {
              ...participant,
              stream: participant.stream,
            };
            next.set(info.peerId, participant);
          }
          return next;
        });
      } catch (error) {
        console.error("Failed to consume producer:", error);
      }
    },
    [],
  );

  const cleanupCallSession = useCallback(() => {
    producersRef.current.forEach((producer) => {
      try {
        producer.close();
      } catch {
        // Producer may already be closed
      }
    });
    producersRef.current = [];

    sendTransportRef.current?.close();
    sendTransportRef.current = null;
    recvTransportRef.current?.close();
    recvTransportRef.current = null;

    consumersRef.current.forEach(({ consumer }) => {
      try {
        consumer.close();
      } catch {
        // Consumer may already be closed
      }
    });
    consumersRef.current = new Map();

    socketRef.current?.disconnect();
    socketRef.current = null;
    deviceRef.current = null;

    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    roomIdRef.current = null;
    participantNamesRef.current.clear();
    setLocalStream(null);
    setIsInCall(false);
    setRoomId(null);
    setParticipants(new Map());
    setMediaStates(new Map());
  }, []);

  const emitLocalMediaState = useCallback(
    (video: boolean, audio: boolean) => {
      if (!ownPeerId) return;
      setMediaStates((prev) => {
        const next = new Map(prev);
        next.set(ownPeerId, { video, audio });
        return next;
      });
      if (mainSocket && roomIdRef.current) {
        mainSocket.emit("group-call-media-state", {
          roomId: roomIdRef.current,
          video,
          audio,
        });
      }
    },
    [mainSocket, ownPeerId],
  );

  const setupCallSession = useCallback(
    async (
      callRoomId: string,
      callType: "video" | "audio",
      isInitiator = false,
    ): Promise<void> => {
      if (roomIdRef.current || socketRef.current?.connected) return;
      isCallInitiatorRef.current = isInitiator;

      const token = LocalStorage.get("token") as string;
      const socket = socketio(getMediasoupURI(), {
        auth: { token },
        transports: ["websocket", "polling"],
      });
      socketRef.current = socket;

      await new Promise<void>((resolve, reject) => {
        socket.on("connect", () => resolve());
        socket.on("connect_error", (err: Error) => reject(err));
        setTimeout(() => reject(new Error("Connection timeout")), 10000);
      });

      const joinResult = await emitAck<JoinRoomResponse>(socket, "join-room", {
        roomId: callRoomId,
      });

      // Set the room id immediately after joining — the consume loop below
      // resolves the room via roomIdRef, so it must be populated BEFORE we
      // start consuming existing producers, otherwise late joiners see nobody.
      roomIdRef.current = callRoomId;

      const device = new mediasoupClient.Device();
      await device.load({ routerRtpCapabilities: joinResult.rtpCapabilities });
      deviceRef.current = device;

      const stream = await navigator.mediaDevices.getUserMedia({
        video: callType === "video",
        audio: true,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      // --- Send path (publish our audio/video) ---
      const sendData = await emitAck<CreateTransportResponse>(
        socket,
        "create-transport",
        { roomId: callRoomId },
      );
      const sendTransport = device.createSendTransport({
        id: sendData.id,
        iceParameters: sendData.iceParameters,
        iceCandidates: sendData.iceCandidates,
        dtlsParameters: sendData.dtlsParameters,
      });
      sendTransportRef.current = sendTransport;

      sendTransport.on(
        "connect",
        async (
          { dtlsParameters }: { dtlsParameters: mediasoupClient.types.DtlsParameters },
          callback: () => void,
          errback: (err: Error) => void,
        ) => {
          try {
            await emitAck<{ success: boolean }>(socket, "connect-transport", {
              roomId: callRoomId,
              transportId: sendTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (err) {
            errback(err as Error);
          }
        },
      );

      sendTransport.on(
        "produce",
        async (
          { kind, rtpParameters }: { kind: MediaKind; rtpParameters: mediasoupClient.types.RtpParameters },
          callback: (params: { id: string }) => void,
          errback: (err: Error) => void,
        ) => {
          try {
            const { producerId } = await emitAck<ProduceResponse>(
              socket,
              "produce",
              {
                roomId: callRoomId,
                transportId: sendTransport.id,
                kind,
                rtpParameters,
              },
            );
            callback({ id: producerId });
          } catch (err) {
            errback(err as Error);
          }
        },
      );

      for (const track of stream.getTracks()) {
        const producer = await sendTransport.produce({ track });
        producersRef.current.push(producer);
      }

      // Publish our initial media state so both the local UI and the other
      // participants know whether we have mic + camera enabled.
      emitLocalMediaState(
        callType === "video" && !!stream.getVideoTracks()[0],
        !!stream.getAudioTracks()[0],
      );

      // --- Receive path (consume everyone else's streams) ---
      const recvData = await emitAck<CreateTransportResponse>(
        socket,
        "create-transport",
        { roomId: callRoomId },
      );
      const recvTransport = device.createRecvTransport({
        id: recvData.id,
        iceParameters: recvData.iceParameters,
        iceCandidates: recvData.iceCandidates,
        dtlsParameters: recvData.dtlsParameters,
      });
      recvTransportRef.current = recvTransport;

      recvTransport.on(
        "connect",
        async (
          { dtlsParameters }: { dtlsParameters: mediasoupClient.types.DtlsParameters },
          callback: () => void,
          errback: (err: Error) => void,
        ) => {
          try {
            await emitAck<{ success: boolean }>(socket, "connect-transport", {
              roomId: callRoomId,
              transportId: recvTransport.id,
              dtlsParameters,
            });
            callback();
          } catch (err) {
            errback(err as Error);
          }
        },
      );

      // Consume streams of participants that joined before us.
      (joinResult.existingProducers ?? []).forEach((producer) => {
        consumeProducer({
          producerId: producer.producerId,
          peerId: producer.user?._id ?? producer.peerId,
          kind: producer.kind,
          user: producer.user,
        });
      });

      socket.on("new-producer", (data: ProducerInfo) => {
        consumeProducer({
          producerId: data.producerId,
          peerId: data.user?._id ?? data.peerId,
          kind: data.kind,
          user: data.user,
        });
      });

      socket.on(
        "participant-joined",
        (data: { peerId: string; user?: { _id: string; username?: string; avatar?: string } }) => {
          addParticipant(data.user ?? { _id: data.peerId });
        },
      );

      socket.on("participant-left", (data: { peerId: string }) => {
        removeParticipant(data.peerId);
      });

      setRoomId(callRoomId);
      setIsInCall(true);
    },
    [consumeProducer, addParticipant, removeParticipant, emitLocalMediaState],
  );

  const startGroupCall = useCallback(
    async (
      callRoomId: string,
      callType: "video" | "audio",
      invitees?: string[],
    ) => {
      const targets = (invitees ?? []).filter(
        (id) => id !== ownPeerId,
      );
      pendingInviteesRef.current = targets;
      if (mainSocket && targets.length > 0) {
        mainSocket.emit("group-call-invite", {
          roomId: callRoomId,
          callType,
          participants: targets,
        });
      }
      await setupCallSession(callRoomId, callType, true);
    },
    [mainSocket, ownPeerId, setupCallSession],
  );

  const joinGroupCall = useCallback(
    async (callRoomId: string, callType: "video" | "audio" = "video") => {
      await setupCallSession(callRoomId, callType, false);
      if (mainSocket) {
        mainSocket.emit("group-call-accepted", {
          roomId: callRoomId,
          participantId: ownPeerId,
        });
      }
    },
    [mainSocket, ownPeerId, setupCallSession],
  );

  const leaveGroupCall = useCallback(() => {
    const socket = socketRef.current;
    const callRoomId = roomIdRef.current;
    if (socket && callRoomId) {
      try {
        socket.emit("leave-room", { roomId: callRoomId });
      } catch {
        // Socket may already be gone
      }
    }
    // If the initiator is the only one in the call (nobody ever joined), tell
    // every member still holding the incoming popup that it's over, so nobody
    // accepts into a dead/void room. If others have joined, it's just a normal
    // leave and the call keeps running.
    const someoneJoined = participantNamesRef.current.size > 0;
    if (
      isCallInitiatorRef.current &&
      !someoneJoined &&
      mainSocket &&
      callRoomId
    ) {
      mainSocket.emit("group-call-cancelled", {
        roomId: callRoomId,
        participants: pendingInviteesRef.current,
      });
      pendingInviteesRef.current = [];
    }
    isCallInitiatorRef.current = false;
    cleanupCallSession();
  }, [cleanupCallSession, mainSocket]);

  const toggleLocalVideo = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioEnabled = stream.getAudioTracks()[0]?.enabled ?? false;

    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      const turningOn = !videoTrack.enabled;
      if (turningOn) {
        // Track still exists but was disabled — just re-enable it.
        videoTrack.enabled = true;
        emitLocalMediaState(true, audioEnabled);
        return;
      }
      // Turn the camera off: stop/remove the track and close the video
      // producer so the SFU stops forwarding it.
      videoTrack.stop();
      stream.removeTrack(videoTrack);
      producersRef.current.forEach((producer) => {
        if (producer.kind === "video") {
          try {
            producer.close();
          } catch {
            // Producer may already be closed
          }
        }
      });
      producersRef.current = producersRef.current.filter(
        (producer) => producer.kind !== "video",
      );
      setLocalStream(new MediaStream(stream.getTracks()));
      emitLocalMediaState(false, audioEnabled);
      return;
    }

    // No video track at all (audio-only call) — acquire the camera now and
    // publish it over the send transport so the rest of the call sees us.
    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: false,
      });
      const track = cameraStream.getVideoTracks()[0];
      if (!track) return;
      stream.addTrack(track);
      setLocalStream(new MediaStream(stream.getTracks()));
      const sendTransport = sendTransportRef.current;
      if (sendTransport) {
        const producer = await sendTransport.produce({ track });
        producersRef.current.push(producer);
      }
      emitLocalMediaState(true, stream.getAudioTracks()[0]?.enabled ?? false);
    } catch (error) {
      console.error("Failed to enable camera:", error);
    }
  }, [emitLocalMediaState]);

  const toggleLocalAudio = useCallback(() => {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    const next = audioTrack ? !audioTrack.enabled : false;
    if (audioTrack) audioTrack.enabled = next;
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    emitLocalMediaState(videoTrack ? videoTrack.enabled : false, next);
  }, [emitLocalMediaState]);

  // Track remote mute/camera toggles broadcast over the main socket.
  useEffect(() => {
    if (!mainSocket) return;
    const listener = (data: { peerId: string; video: boolean; audio: boolean }) => {
      if (!data.peerId) return;
      setMediaStates((prev) => {
        const next = new Map(prev);
        next.set(data.peerId, { video: data.video, audio: data.audio });
        return next;
      });
      // When a remote participant turns OFF video, the mediasoup consumer
      // @close event may not fire reliably, leaving a stale video track in
      // the stream. Actively remove it here so the GroupCallModal rendering
      // logic (hasVideo = !!videoTrack && videoTrack.enabled) correctly shows
      // the avatar. When they turn video back on, consumeProducer will add
      // the new track via the new-producer event.
      if (!data.video) {
        setParticipants((prev) => {
          const next = new Map(prev);
          const participant = next.get(data.peerId);
          if (participant) {
            const vt = participant.stream.getVideoTracks()[0];
            if (vt) {
              participant.stream.removeTrack(vt);
            }
            next.set(data.peerId, { ...participant });
          }
          return next;
        });
      }
    };
    mainSocket.on("group-call-media-state-update", listener);
    return () => {
      mainSocket.off("group-call-media-state-update", listener);
    };
  }, [mainSocket]);

  useEffect(() => {
    return () => {
      cleanupCallSession();
    };
  }, [cleanupCallSession]);

  return (
    <GroupCallContext.Provider
      value={{
        isInCall,
        roomId,
        localStream,
        participants,
        mediaStates,
        startGroupCall,
        joinGroupCall,
        leaveGroupCall,
        toggleLocalVideo,
        toggleLocalAudio,
      }}
    >
      {children}
    </GroupCallContext.Provider>
  );
};