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
  if (!context) throw new Error("useWebRTC must be used within a WebRTCProvider");
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
  console.log("Remote track event received");
  if (event.streams && event.streams[0]) {
    // Wrap in a new MediaStream to ensure React detects a state change
    setRemoteStream(new MediaStream(event.streams[0].getTracks()));
  }
};

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "disconnected") {
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
        console.error("Error adding queued ICE", e);
      }
    }
  }, []);

  const startCall = useCallback(async (peerId: string, callType: "video" | "audio") => {
    const pc = createPeerConnection();
    remotePeerIdRef.current = peerId;
    setIsVideoEnabled(callType === "video");

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
      console.error("Call start error:", err);
      resetCallState();
    }
  }, [createPeerConnection, socket, resetCallState]);

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    const pc = createPeerConnection();
    remotePeerIdRef.current = incomingCall.from;
    const isVideoCall = incomingCall.callType !== "audio";
    setIsVideoEnabled(isVideoCall);

    try {
      // 1. MUST set remote description FIRST
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));

      // 2. Clear any candidates that arrived during negotiation
      await processIceQueue();

      // 3. Get hardware
      const stream = await navigator.mediaDevices.getUserMedia({
        video: isVideoCall,
        audio: true,
      });
      setLocalStream(stream);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 4. Create Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket?.emit("call-accepted", { to: incomingCall.from, answer });
      setIsCallActive(true);
      setIncomingCall(null);
    } catch (err) {
      console.error("Accept call error:", err);
      resetCallState();
    }
  }, [incomingCall, createPeerConnection, socket, processIceQueue, resetCallState]);

  const rejectIncomingCall = useCallback(() => {
    if (incomingCall) {
      socket?.emit("call-rejected", { to: incomingCall.from });
      setIncomingCall(null);
    }
  }, [incomingCall, socket]);

  const endCall = useCallback(() => {
    if (remotePeerIdRef.current) socket?.emit("call-ended", { to: remotePeerIdRef.current });
    resetCallState();
  }, [socket, resetCallState]);

  const toggleMute = useCallback(() => {
    if (localStream) {
      localStream.getAudioTracks().forEach(t => t.enabled = !t.enabled);
      setIsMuted(prev => !prev);
    }
  }, [localStream]);

  const toggleVideo = useCallback(() => {
    if (localStream) {
      localStream.getVideoTracks().forEach(t => t.enabled = !t.enabled);
      setIsVideoEnabled(prev => !prev);
    }
  }, [localStream]);

  useEffect(() => {
    if (!socket) return;

    socket.on("incomming-call", (data: IIncomingCall) => setIncomingCall(data));
    socket.on("call-accepted", async ({ answer }) => {
      if (peerRef.current) {
        await peerRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        await processIceQueue();
      }
    });
    socket.on("ice-candidate", ({ candidate }) => {
      if (peerRef.current?.remoteDescription) {
        peerRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.error);
      } else {
        iceQueue.current.push(candidate);
      }
    });
    socket.on("call-ended", resetCallState);
    socket.on("call-rejected", resetCallState);

    return () => {
      socket.off("incomming-call");
      socket.off("call-accepted");
      socket.off("ice-candidate");
      socket.off("call-ended");
      socket.off("call-rejected");
    };
  }, [socket, resetCallState, processIceQueue]);

  return (
    <WebRTCContext.Provider value={{
      localStream, remoteStream, isCallActive, incomingCall, isMuted, isVideoEnabled,
      startCall, endCall, acceptIncomingCall, rejectIncomingCall, toggleMute, toggleVideo
    }}>
      {children}
    </WebRTCContext.Provider>
  );
};
