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
import type { Socket } from "socket.io-client";

interface Participant {
  id: string;
  socketId: string;
  stream: MediaStream | null;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  avatar?: string;
}

type Transport = mediasoupClient.types.Transport;
type Producer = mediasoupClient.types.Producer;

interface GroupCallContextType {
  isInCall: boolean;
  roomId: string | null;
  localStream: MediaStream | null;
  participants: Map<string, Participant>;
  startGroupCall: (
    roomId: string,
    callType: "video" | "audio",
  ) => Promise<void>;
  joinGroupCall: (roomId: string) => Promise<void>;
  leaveGroupCall: () => void;
  toggleLocalVideo: () => void;
  toggleLocalAudio: () => void;
}

// Minimal typed contract for the mediasoup worker responses
interface JoinRoomResponse {
  success: boolean;
  error?: string;
  rtpCapabilities: mediasoupClient.types.RtpCapabilities;
}

interface CreateTransportResponse {
  success: boolean;
  error?: string;
  id: string;
  iceParameters: mediasoupClient.types.IceParameters;
  iceCandidates: mediasoupClient.types.IceCandidate[];
  dtlsParameters: mediasoupClient.types.DtlsParameters;
}

interface ProduceResponse {
  success: boolean;
  error?: string;
  producerId: string;
}

interface ConsumeResponse {
  success: boolean;
  error?: string;
  id: string;
  producerId: string;
  kind: mediasoupClient.types.MediaKind;
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

const MEDIASOUP_SERVER_URL =
  import.meta.env.VITE_MEDIASOUP_URL || "http://localhost:3001";

export const GroupCallProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [isInCall, setIsInCall] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [participants, setParticipants] = useState<Map<string, Participant>>(
    new Map(),
  );

  const deviceRef = useRef<mediasoupClient.Device | null>(null);
  const sendTransportRef = useRef<Transport | null>(null);
  const recvTransportRef = useRef<Transport | null>(null);
  const producersRef = useRef<Producer[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const startGroupCall = useCallback(
    async (callRoomId: string, callType: "video" | "audio") => {
      console.log("Starting group call:", callRoomId, callType);
      console.log("Mediasoup server URL:", MEDIASOUP_SERVER_URL);
      try {
        const socket = (await import("socket.io-client")).io(MEDIASOUP_SERVER_URL, {
          path: "/mediasoup",
          transports: ["websocket", "polling"],
        });
        socketRef.current = socket;

        await new Promise<void>((resolve, reject) => {
          socket.on("connect", () => {
            console.log("Mediasoup socket connected");
            resolve();
          });
          socket.on("connect_error", (err: Error) => {
            console.error("Mediasoup connection error:", err);
            reject(err);
          });
          setTimeout(() => reject(new Error("Connection timeout")), 10000);
        });

        console.log("Joining room:", callRoomId);
        const { rtpCapabilities } = await new Promise<JoinRoomResponse>(
          (resolve, reject) => {
            socket.emit(
              "join-room",
              { roomId: callRoomId },
              (response: JoinRoomResponse) => {
                console.log("Join room response:", response);
                if (response.success) resolve(response);
                else reject(new Error(response.error));
              },
            );
          },
        );

        console.log("Loading mediasoup device");
        const device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        deviceRef.current = device;

        console.log("Getting user media");
        const stream = await navigator.mediaDevices.getUserMedia({
          video: callType === "video",
          audio: true,
        });
        console.log("Got local stream:", stream.id);
        setLocalStream(stream);

        const sendTransportData =
          await new Promise<CreateTransportResponse>((resolve, reject) => {
            socket.emit(
              "create-transport",
              { roomId: callRoomId, direction: "send" },
              (response: CreateTransportResponse) => {
                if (response.success) resolve(response);
                else reject(new Error(response.error));
              },
            );
          });

        const sendTransport = device.createSendTransport(sendTransportData);
        sendTransportRef.current = sendTransport;

        sendTransport.on(
          "connect",
          async (
            { dtlsParameters }: { dtlsParameters: mediasoupClient.types.DtlsParameters },
            callback: () => void,
            errback: (err: Error) => void,
          ) => {
            try {
              await new Promise<void>((resolve, reject) => {
                socket.emit(
                  "connect-transport",
                  {
                    roomId: callRoomId,
                    transportId: sendTransport.id,
                    dtlsParameters,
                  },
                  (response: { success: boolean; error?: string }) => {
                    if (response.success) resolve();
                    else reject(new Error(response.error));
                  },
                );
              });
              callback();
            } catch (err) {
              errback(err as Error);
            }
          },
        );

        stream.getTracks().forEach(async (track) => {
          const producer = await sendTransport.produce({ track });
          producersRef.current.push(producer);
        });

        sendTransport.on(
          "produce",
          async (
            { kind, rtpParameters }: { kind: mediasoupClient.types.MediaKind; rtpParameters: mediasoupClient.types.RtpParameters },
            callback: (params: { id: string }) => void,
            errback: (err: Error) => void,
          ) => {
            try {
              const { producerId } = await new Promise<ProduceResponse>(
                (resolve, reject) => {
                  socket.emit(
                    "produce",
                    {
                      roomId: callRoomId,
                      transportId: sendTransport.id,
                      kind,
                      rtpParameters,
                    },
                    (response: ProduceResponse) => {
                      if (response.success) resolve(response);
                      else reject(new Error(response.error));
                    },
                  );
                },
              );
              callback({ id: producerId });
            } catch (err) {
              errback(err as Error);
            }
          },
        );

        const recvTransportData =
          await new Promise<CreateTransportResponse>((resolve, reject) => {
            socket.emit(
              "create-transport",
              { roomId: callRoomId, direction: "recv" },
              (response: CreateTransportResponse) => {
                if (response.success) resolve(response);
                else reject(new Error(response.error));
              },
            );
          });

        const recvTransport = device.createRecvTransport(recvTransportData);
        recvTransportRef.current = recvTransport;

        recvTransport.on(
          "connect",
          async (
            { dtlsParameters }: { dtlsParameters: mediasoupClient.types.DtlsParameters },
            callback: () => void,
            errback: (err: Error) => void,
          ) => {
            try {
              await new Promise<void>((resolve, reject) => {
                socket.emit(
                  "connect-transport",
                  {
                    roomId: callRoomId,
                    transportId: recvTransport.id,
                    dtlsParameters,
                  },
                  (response: { success: boolean; error?: string }) => {
                    if (response.success) resolve();
                    else reject(new Error(response.error));
                  },
                );
              });
              callback();
            } catch (err) {
              errback(err as Error);
            }
          },
        );

        socket.on(
          "new-producer",
          async ({
            producerId,
            producerSocketId,
          }: {
            producerId: string;
            producerSocketId: string;
          }) => {
            try {
              const consumerData = await new Promise<ConsumeResponse>(
                (resolve, reject) => {
                  socket.emit(
                    "consume",
                    {
                      roomId: callRoomId,
                      transportId: recvTransport.id,
                      producerId,
                      rtpCapabilities: device.rtpCapabilities,
                    },
                    (response: ConsumeResponse) => {
                      if (response.success) resolve(response);
                      else reject(new Error(response.error));
                    },
                  );
                },
              );

              const consumer = await recvTransport.consume({
                id: consumerData.id,
                producerId: consumerData.producerId,
                rtpParameters: consumerData.rtpParameters,
                kind: consumerData.kind,
              });

              const audioTrack = consumer.track;
              const stream = new MediaStream([audioTrack]);

              setParticipants((prev) => {
                const updated = new Map(prev);
                updated.set(producerSocketId, {
                  id: producerSocketId,
                  socketId: producerSocketId,
                  stream,
                  isVideoEnabled: false,
                  isAudioEnabled: true,
                });
                return updated;
              });
            } catch (err) {
              console.error("Error consuming new producer:", err);
            }
          },
        );

        socket.on(
          "group-call-participant-joined",
          ({ participantId }: { participantId: string }) => {
            console.log("Participant joined:", participantId);
          },
        );

        setRoomId(callRoomId);
        setIsInCall(true);
      } catch (err) {
        console.error("Error starting group call:", err);
        throw err;
      }
    },
    [],
  );

  const joinGroupCall = useCallback(
    async (callRoomId: string) => {
      await startGroupCall(callRoomId, "video");
    },
    [startGroupCall],
  );

  const leaveGroupCall = useCallback(() => {
    producersRef.current.forEach((p) => p.close());
    sendTransportRef.current?.close();
    recvTransportRef.current?.close();
    socketRef.current?.disconnect();
    localStream?.getTracks().forEach((t) => t.stop());

    setIsInCall(false);
    setRoomId(null);
    setLocalStream(null);
    setParticipants(new Map());
  }, [localStream]);

  const toggleLocalVideo = useCallback(() => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
      }
    }
  }, [localStream]);

  const toggleLocalAudio = useCallback(() => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
      }
    }
  }, [localStream]);

  useEffect(() => {
    return () => {
      producersRef.current.forEach((p) => p.close());
      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      socketRef.current?.disconnect();
      localStream?.getTracks().forEach((t) => t.stop());
    };
  }, [localStream]);

  return (
    <GroupCallContext.Provider
      value={{
        isInCall,
        roomId,
        localStream,
        participants,
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