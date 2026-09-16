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
import { useAuth } from "./AuthContext";
import { stunServers } from "../config/webrtc";

export interface IIncomingCall {
  from: string;
  offer: RTCSessionDescriptionInit;
  callType: "video" | "audio";
  chatId?: string;
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
  remoteMuted: boolean;
  remoteVideoOff: boolean;
  callType: "video" | "audio" | null;
  callConnectionState: CallConnectionState;
  isCallInitiator: boolean;
  startCall: (peerId: string, callType: "video" | "audio", chatId?: string) => void;
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
  const { user } = useAuth();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [incomingCall, setIncomingCall] = useState<IIncomingCall | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [remoteVideoOff, setRemoteVideoOff] = useState(false);
  const [callType, setCallType] = useState<"video" | "audio" | null>(null);
  const [callConnectionState, setCallConnectionState] =
    useState<CallConnectionState>("connecting");
  const [isCallInitiator, setIsCallInitiator] = useState(false);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const remotePeerIdRef = useRef<string | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const iceQueue = useRef<RTCIceCandidateInit[]>([]);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fresh local user id for socket handlers (avoids stale closures).
  const currentUserIdRef = useRef<string | undefined>(user?._id);
  useEffect(() => {
    currentUserIdRef.current = user?._id;
  }, [user?._id]);
  // Fresh "are we actively calling that peer right now" for socket handlers.
  const callActiveRef = useRef(false);
  useEffect(() => {
    callActiveRef.current = isCallActive;
  }, [isCallActive]);
  const callInitiatorRef = useRef(false);
  useEffect(() => {
    callInitiatorRef.current = isCallInitiator;
  }, [isCallInitiator]);

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
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsCallActive(false);
    setIncomingCall(null);
    setIsMuted(false);
    setIsVideoEnabled(true);
    setRemoteMuted(false);
    setRemoteVideoOff(false);
    setCallType(null);
    setCallConnectionState("connecting");
    setIsCallInitiator(false);
    callActiveRef.current = false;
    callInitiatorRef.current = false;
    remotePeerIdRef.current = null;
    remoteStreamRef.current = null;
    iceQueue.current = [];
  }, [localStream, clearDisconnectTimer]);

  // Tears down the OUTGOING leg of a glare conflict. Unlike `endCall` it does
  // NOT emit call-ended to the peer (they will stay on their outgoing call as
  // the initiator), and it does NOT touch incomingCall — the peer's offer we
  // keep so the user can answer it.
  const abortOutgoingCall = useCallback(() => {
    clearDisconnectTimer();
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setIsCallActive(false);
    setIsMuted(false);
    setIsVideoEnabled(true);
    setRemoteMuted(false);
    setRemoteVideoOff(false);
    setCallType(null);
    setCallConnectionState("connecting");
    setIsCallInitiator(false);
    callActiveRef.current = false;
    callInitiatorRef.current = false;
    remotePeerIdRef.current = null;
    remoteStreamRef.current = null;
    iceQueue.current = [];
  }, [socket, clearDisconnectTimer]);

  // Schedules an automatic end-of-call once the WebRTC connection has dropped.
  // `immediate` is used when the connection is irrecoverably failed/closed;
  // otherwise we give a LONG grace period so transient network blips — or
  // heavy main-thread load from things like the shared whiteboard stalling the
  // ICE keepalives — don't kill a healthy call. `connectionState` flapping to
  // "disconnected" self-heals and clears this timer the moment it recovers.
  const scheduleCallEnd = useCallback(
    (immediate: boolean) => {
      clearDisconnectTimer();
      disconnectTimerRef.current = setTimeout(() => {
        disconnectTimerRef.current = null;
        setCallConnectionState("disconnected");
        resetCallState();
      }, immediate ? 1500 : 10000);
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
    async (peerId: string, callType: "video" | "audio", chatId?: string) => {
      // Glare resolution: if we're already receiving a call from the exact
      // peer we're about to call, only one side can initiate. A deterministic
      // rule (the lower userId wins the "initiator" role) keeps both clients
      // in sync so we don't end up with two overlapping call UIs.
      if (incomingCall?.from === peerId && currentUserIdRef.current) {
        const myId = currentUserIdRef.current;
        const iWinInitiator = myId < peerId;
        if (!iWinInitiator) {
          toast.info("You already have an incoming call from this user");
          return;
        }
        // We keep the initiator role — drop the incoming call UI, proceed
        // with the outgoing call.
        setIncomingCall(null);
      }

      const pc = createPeerConnection();
      remotePeerIdRef.current = peerId;
      callInitiatorRef.current = true;
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
        localStreamRef.current = stream;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        const sent = socket?.emit("call-user", { to: peerId, offer, callType, chatId });
        if (!sent) {
          resetCallState();
          toast.error("Failed to connect. Please try again.");
          return;
        }
        setIsCallActive(true);
        callActiveRef.current = true;
      } catch (err) {
        console.error("Call start error:", err);
        toast.error("Could not access microphone/camera");
        resetCallState();
      }
    },
    [createPeerConnection, socket, resetCallState, incomingCall],
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
    callInitiatorRef.current = false;

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
      localStreamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      // 4. Create Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket?.emit("call-accepted", { to: incomingCall.from, answer });
      setIsCallActive(true);
      callActiveRef.current = true;
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
    console.trace("endCall stack");
    if (remotePeerIdRef.current) {
      socket?.emit("call-ended", { to: remotePeerIdRef.current });
    }
    resetCallState();
  }, [socket, resetCallState]);

  const toggleMute = useCallback(() => {
    if (localStream) {
      const next = !localStream.getAudioTracks()[0]?.enabled;
      localStream.getAudioTracks().forEach((t) => (t.enabled = next));
      setIsMuted(!next);
      const peerId = remotePeerIdRef.current;
      if (peerId && socket) {
        socket.emit("peer-media-state", { to: peerId, audio: next });
      }
    }
  }, [localStream, socket]);

  const toggleVideo = useCallback(() => {
    if (localStream) {
      const next = !localStream.getVideoTracks()[0]?.enabled;
      localStream.getVideoTracks().forEach((t) => (t.enabled = next));
      setIsVideoEnabled(next);
      const peerId = remotePeerIdRef.current;
      if (peerId && socket) {
        socket.emit("peer-media-state", { to: peerId, video: next });
      }
    }
  }, [localStream, socket]);

  useEffect(() => {
    if (!socket) return;

    socket.on("incomming-call", (data: IIncomingCall) => {
      // Glare: an incoming call from a peer we are ALREADY actively calling
      // (outgoing). Both sides dialed each other at the same time. Resolve
      // deterministically so we end up with exactly one call — the lower
      // userId takes the initiator role and the higher one answers it.
      const inOutgoingCall =
        callActiveRef.current &&
        callInitiatorRef.current &&
        remotePeerIdRef.current === data.from;

      if (inOutgoingCall && currentUserIdRef.current) {
        const iWinInitiator = currentUserIdRef.current < data.from;
        if (iWinInitiator) {
          // We keep the outgoing call; ignore the peer's duplicate incoming.
          console.log(
            "[glare] keeping outgoing call with",
            data.from,
            "(I am initiator)",
          );
          return;
        }
        // We lose the initiator role. Drop our outgoing leg and answer the
        // peer's incoming offer instead, so only one connection is set up.
        console.log(
          "[glare] dropping outgoing call, answering incoming from",
          data.from,
        );
        abortOutgoingCall();
        setIncomingCall(data);
        return;
      }

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
    socket.on("call-busy", ({ busyWith }: { busyWith?: string }) => {
      console.log("call-busy received, callee is in another call:", busyWith);
      toast.error(busyWith ? "User is already in another call" : "User is busy");
      resetCallState();
    });

    // Track remote peer's media state (mute/video-off)
    socket.on("peer-media-state", ({ audio, video }: { audio?: boolean; video?: boolean }) => {
      if (audio !== undefined) setRemoteMuted(!audio);
      if (video !== undefined) setRemoteVideoOff(!video);
    });

    return () => {
      socket.off("incomming-call");
      socket.off("call-accepted");
      socket.off("ice-candidate");
      socket.off("call-ended");
      socket.off("call-rejected");
      socket.off("call-busy");
      socket.off("peer-media-state");
    };
  }, [socket, resetCallState, processIceQueue, abortOutgoingCall]);

  // Broadcast local media state to the remote peer when the call starts,
  // so both sides know each other's initial mute/video state.
  useEffect(() => {
    if (!isCallActive || !socket) return;
    const peerId = remotePeerIdRef.current;
    if (!peerId) return;
    const videoTrack = localStream?.getVideoTracks()[0];
    const audioTrack = localStream?.getAudioTracks()[0];
    socket.emit("peer-media-state", {
      to: peerId,
      video: videoTrack ? videoTrack.enabled : false,
      audio: audioTrack ? audioTrack.enabled : false,
    });
  }, [isCallActive, socket, localStream]);

  return (
    <WebRTCContext.Provider
      value={{
        localStream,
        remoteStream,
        isCallActive,
        incomingCall,
        isMuted,
        isVideoEnabled,
        remoteMuted,
        remoteVideoOff,
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