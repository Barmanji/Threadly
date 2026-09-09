import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import { toast } from "sonner";
import { useSocket } from "./SocketContext";
import { stunServers } from "../config/webrtc";

export interface IIncomingCall {
  from: string;
  offer: RTCSessionDescriptionInit;
  callType: "video" | "audio";
  fromUser?: {
    _id: string;
    username?: string;
    avatar?: string;
  };
}

export type CallConnectionState = "connecting" | "connected" | "disconnected";

interface IWebRTCContext {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  isCallActive: boolean;
  incomingCall: IIncomingCall | null;
  isMuted: boolean;
  isVideoEnabled: boolean;
  callType: "video" | "audio" | null;
  callConnectionState: CallConnectionState;
  isCallInitiator: boolean;
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
  const [callType, setCallType] = useState<"video" | "audio" | null>(null);
  const [callConnectionState, setCallConnectionState] =
    useState<CallConnectionState>("connecting");
  const [isCallInitiator, setIsCallInitiator] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDisconnectTimer = useCallback(() => {
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
  }, []);

  const resetCallState = useCallback(() => {
    clearDisconnectTimer();
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
    setCallType(null);
    setCallConnectionState("connecting");
    setIsCallInitiator(false);
    remotePeerIdRef.current = null;
    remoteStreamRef.current = null;
    iceQueue.current = [];
  }, [localStream, clearDisconnectTimer]);

  // Schedules an automatic end-of-call once the WebRTC connection has dropped.
  // `immediate` is used when the connection is irrecoverably failed/closed;
  // otherwise we give a short grace period so transient network blips don't
  // kill a healthy call.
  const scheduleCallEnd = useCallback(
    (immediate: boolean) => {
      clearDisconnectTimer();
      disconnectTimerRef.current = setTimeout(() => {
        disconnectTimerRef.current = null;
        setCallConnectionState("disconnected");
        resetCallState();
      }, immediate ? 400 : 3000);
    },
    [clearDisconnectTimer, resetCallState],
  );

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
      // Accumulate every track into ONE stable MediaStream. The remote is
      // delivered as separate audio/video track events; if we recreated the
      // stream on each one (and hence changed srcObject / stream id), the
      // <video> element would glitch and flicker.
      if (!remoteStreamRef.current) {
        remoteStreamRef.current = new MediaStream();
      }
      const tracks = event.streams && event.streams[0]
        ? event.streams[0].getTracks()
        : event.track
          ? [event.track]
          : [];
      for (const track of tracks) {
        const alreadyPresent = remoteStreamRef.current
          .getTracks()
          .some((t) => t.id === track.id);
        if (!alreadyPresent) remoteStreamRef.current.addTrack(track);
      }
      setRemoteStream(remoteStreamRef.current);
    };

    // The WebRTC connection state is the source of truth for whether the peer
    // is still reachable. When the remote party drops the call (even if the
    // "call-ended" socket event is lost), this guarantees both sides clean up.
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log("ICE connection state:", state);
      if (state === "connected") {
        setCallConnectionState("connected");
        clearDisconnectTimer();
      } else if (state === "failed" || state === "closed") {
        setCallConnectionState("disconnected");
        scheduleCallEnd(true);
      } else if (state === "disconnected") {
        setCallConnectionState("disconnected");
        // Give it a moment; ICE may still recover.
        scheduleCallEnd(false);
      }
    };

    peerRef.current = pc;
    return pc;
  }, [socket, clearDisconnectTimer, scheduleCallEnd]);

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

  const startCall = useCallback(
    async (peerId: string, callType: "video" | "audio") => {
      const pc = createPeerConnection();
      remotePeerIdRef.current = peerId;
      setIsVideoEnabled(callType === "video");
      setCallType(callType);
      setCallConnectionState("connecting");
      setIsCallInitiator(true);

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: callType === "video",
          audio: true,
        });
        setLocalStream(stream);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sent = socket?.emit("call-user", { to: peerId, offer, callType });
        if (!sent) {
          resetCallState();
          toast.error("Failed to connect. Please try again.");
          return;
        }
        setIsCallActive(true);
      } catch (err) {
        console.error("Call start error:", err);
        toast.error("Could not access microphone/camera");
        resetCallState();
      }
    },
    [createPeerConnection, socket, resetCallState],
  );

  const acceptIncomingCall = useCallback(async () => {
    if (!incomingCall) return;
    const pc = createPeerConnection();
    remotePeerIdRef.current = incomingCall.from;
    const isVideoCall = incomingCall.callType === "video";
    setIsVideoEnabled(isVideoCall);
    setCallType(incomingCall.callType ?? "audio");
    setCallConnectionState("connecting");
    setIsCallInitiator(false);

    try {
      // 1. MUST set remote description FIRST
      await pc.setRemoteDescription(
        new RTCSessionDescription(incomingCall.offer),
      );

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
      toast.error("Could not accept the call");
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
      toast.info("Call declined");
      setIncomingCall(null);
    }
  }, [incomingCall, socket]);

  const endCall = useCallback(() => {
    console.log("endCall called - remotePeerId:", remotePeerIdRef.current);
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
      localStream.getVideoTracks().forEach((t) => (t.enabled = !t.enabled));
      setIsVideoEnabled((prev) => !prev);
    }
  }, [localStream]);

  useEffect(() => {
    if (!socket) return;

    socket.on("incomming-call", (data: IIncomingCall) => setIncomingCall(data));
    socket.on("call-accepted", async ({ answer }) => {
      if (peerRef.current) {
        try {
          await peerRef.current.setRemoteDescription(
            new RTCSessionDescription(answer),
          );
          await processIceQueue();
        } catch (e) {
          console.error("Error processing call answer:", e);
          toast.error("Call failed to connect");
          resetCallState();
        }
      }
    });
    socket.on("ice-candidate", ({ candidate }) => {
      if (peerRef.current?.remoteDescription) {
        peerRef.current
          .addIceCandidate(new RTCIceCandidate(candidate))
          .catch(console.error);
      } else {
        iceQueue.current.push(candidate);
      }
    });
    socket.on("call-ended", ({ from }: { from?: string }) => {
      console.log("call-ended received from:", from);
      toast.info("Call ended");
      resetCallState();
    });
    socket.on("call-rejected", () => {
      toast.error("Call was declined");
      resetCallState();
    });

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
        callType,
        callConnectionState,
        isCallInitiator,
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