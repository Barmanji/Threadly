import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { useSocket } from "./SocketContext";
import { stunServers } from "../config/webrtc";

export interface IIncomingCall {
  from: string;
  offer: RTCSessionDescriptionInit;
  callType: "video" | "audio";
}

interface IWebRTCContext {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isCallActive: boolean;
  incomingCall: IIncomingCall | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
  startCall: (peerId: string, callType: "video" | "audio") => void;
  endCall: () => void;
  acceptIncomingCall: () => void;
  rejectIncomingCall: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
}

const WebRTCContext = createContext<IWebRTCContext | null>(null);

export const useWebRTC = () => {
  const context = useContext(WebRTCContext);
  if (!context)
    throw new Error("useWebRTC must be used within a WebRTCProvider");
  return context;
};

export const WebRTCProvider = ({ children }: { children: ReactNode }) => {
  const { socket } = useSocket();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [incomingCall, setIncomingCall] = useState<IIncomingCall | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);

  const resetCallState = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.getSenders().forEach((sender) => {
        if (sender.track) sender.track.stop();
      });
      peerRef.current.close();
      peerRef.current = null;
    }
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
    }
    setLocalStream(null);
    setRemoteStream(null);
    setIsCallActive(false);
    setIncomingCall(null);
    setIsMuted(false);
    setIsVideoEnabled(true);
    remotePeerIdRef.current = null;
    iceQueue.current = [];
  }, [localStream]);

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection(stunServers);

    pc.onicecandidate = (event) => {
      if (event.candidate && remotePeerIdRef.current) {
        socket?.emit("ice-candidate", {
          to: remotePeerIdRef.current,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      console.log("Remote track event fired:", event.streams[0]);
      if (event.streams && event.streams[0]) {
        setRemoteStream(event.streams[0]);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === "disconnected" ||
        pc.iceConnectionState === "failed"
      ) {
        resetCallState();
      }
    };

    peerRef.current = pc;
    return pc;
  }, [socket, resetCallState]);

  const processIceQueue = useCallback(async () => {
    if (!peerRef.current || !peerRef.current.remoteDescription) return;
    while (iceQueue.current.length > 0) {
      const candidate = iceQueue.current.shift();
      try {
        await peerRef.current.addIceCandidate(new RTCIceCandidate(candidate!));
      } catch (e) {
        console.error("Error adding queued ICE candidate", e);
      }
    }
  }, []);

  const startCall = useCallback(
    async (peerId: string, callType: "video" | "audio") => {
      const pc = createPeerConnection();
      remotePeerIdRef.current = peerId;
      setIsVideoEnabled(callType === "video");
      console.log("outgooing calltype", callType);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: callType === "video",
          audio: true,
        });
        setLocalStream(stream);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        socket?.emit("call-user", { to: peerId, offer, callType });
        setIsCallActive(true);
      } catch (err) {
        console.error("Failed to start call:", err);
        resetCallState();
      }
    },
    [createPeerConnection, socket, resetCallState],
  );

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall) return;

    // 1. Initialize Peer Connection
    const pc = createPeerConnection();
    remotePeerIdRef.current = incomingCall.from;
    setIsVideoEnabled(incomingCall.callType === "video");

    try {
      // 2. Request Camera/Mic immediately to wake up hardware
      const stream = await navigator.mediaDevices.getUserMedia({
        video: incomingCall.callType === "video",
        audio: true,
      });
      console.log("incoming calltype", incomingCall.callType);
      setLocalStream(stream);

      // 3. Set Remote Description (the offer we received)
      await pc.setRemoteDescription(
        new RTCSessionDescription(incomingCall.offer),
      );

      // 4. Add local tracks to the connection
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 5. Create the Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // 6. Signal back
      socket?.emit("call-accepted", { to: incomingCall.from, answer });

      // 7. Process any ICE candidates that arrived while we were getting camera access
      await processIceQueue();

      setIsCallActive(true);
      setIncomingCall(null);
    } catch (err) {
      console.error("Critical error in acceptIncomingCall:", err);
      resetCallState();
    }
  }, [
    incomingCall,
    createPeerConnection,
    socket,
    processIceQueue,
    resetCallState,
  ]);

  const rejectIncomingCall = useCallback(() => {
    if (incomingCall) {
      socket?.emit("call-rejected", { to: incomingCall.from });
      setIncomingCall(null);
    }
  }, [incomingCall, socket]);

  const endCall = useCallback(() => {
    if (remotePeerIdRef.current) {
      socket?.emit("call-ended", { to: remotePeerIdRef.current });
    }
    resetCallState();
  }, [socket, resetCallState]);

  const toggleMute = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach((t) => (t.enabled = !t.enabled));
      setIsMuted((prev) => !prev);
    }
  }, [localStream]);

  const toggleVideo = useCallback(() => {
    if (localStream) {

      localStream.getVideoTracks().forEach((t) => ((t.enabled) = !t.enabled));
      setIsVideoEnabled((prev) => !prev);
    }
  }, [localStream]);

  useEffect(() => {
    if (!socket) return;

    socket.on("incomming-call", (data: IIncomingCall) => {
      setIncomingCall(data);
    });

    socket.on("call-accepted", async ({ answer }) => {
      if (peerRef.current) {
        try {
          await peerRef.current.setRemoteDescription(
            new RTCSessionDescription(answer),
          );
          await processIceQueue();
        } catch (e) {
          console.error("Error setting remote description on accepted call", e);
        }
      }
    });

    socket.on("ice-candidate", ({ candidate }) => {
      if (peerRef.current && peerRef.current.remoteDescription) {
        peerRef.current
          .addIceCandidate(new RTCIceCandidate(candidate))
          .catch((e) => console.error("ICE addition failed", e));
      } else {
        iceQueue.current.push(candidate);
      }
    });

    socket.on("call-ended", () => resetCallState());
    socket.on("call-rejected", () => resetCallState());

    return () => {
      socket.off("incomming-call");
      socket.off("call-accepted");
      socket.off("ice-candidate");
      socket.off("call-ended");
      socket.off("call-rejected");
    };
  }, [socket, resetCallState, processIceQueue]);

  return (
    <WebRTCContext.Provider
      value={{
        localStream,
        remoteStream,
        isCallActive,
        incomingCall,
        isMuted,
        isVideoEnabled,
        startCall,
        endCall,
        acceptIncomingCall,
        rejectIncomingCall,
        toggleMute,
        toggleVideo,
      }}
    >
      {children}
    </WebRTCContext.Provider>
  );
};
