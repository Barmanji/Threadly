import {
  PhoneIcon,
  PhoneXMarkIcon,
  UserGroupIcon,
} from "@heroicons/react/24/solid";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useSocket } from "../../context/SocketContext";
import { useGroupCall } from "../../context/GroupCallContext";
import { useAuth } from "../../context/AuthContext";
import { Button } from "../ui/button";

const CALL_RING_URL = "/call.mp3";
const AUTO_REJECT_MS = 40_000;

const GroupCallNotification: React.FC = () => {
  const { socket } = useSocket();
  const { isInCall, joinGroupCall, roomId } = useGroupCall();
  const { user } = useAuth();
  const [incomingGroupCall, setIncomingGroupCall] = useState<{
    roomId: string;
    callType: "video" | "audio";
    from: string;
    fromUser?: { _id: string; username?: string; avatar?: string };
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Play looping ring sound + auto-reject after 40s
  useEffect(() => {
    if (!incomingGroupCall) return;

    const audio = new Audio(CALL_RING_URL);
    audio.loop = true;
    audio.volume = 0.7;
    audioRef.current = audio;
    audio.play().catch(() => {});

    timerRef.current = setTimeout(() => {
      handleReject();
    }, AUTO_REJECT_MS);

    return () => {
      audio.pause();
      audio.src = "";
      audioRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [incomingGroupCall?.roomId]);

  useEffect(() => {
    if (!socket) return;

    socket.on(
      "group-call-invitation",
      (data: {
        roomId: string;
        callType: "video" | "audio";
        from: string;
        fromUser?: { _id: string; username?: string; avatar?: string };
      }) => {
        const callerName = data.fromUser?.username || data.from;
        if (isInCall && roomId === data.roomId) {
          // Already in this call — just toast, do NOT set incomingGroupCall
          // (which would trigger the ring sound and auto-reject timer).
          toast.info(`${callerName} started a call — you're already in it`);
          return;
        }
        setIncomingGroupCall(data);
        toast.info(`${callerName} is starting a ${data.callType} call...`);
      },
    );

    socket.on(
      "group-call-cancelled",
      (data: {
        roomId: string;
        cancelledBy?: string;
        fromUser?: { _id: string; username?: string; avatar?: string };
      }) => {
        if (incomingGroupCall?.roomId === data.roomId) {
          const callerName = data.fromUser?.username || data.cancelledBy || "";
          toast.info(`${callerName} cancelled the call`);
          setIncomingGroupCall(null);
        }
        // Do NOT call leaveGroupCall() here — group-call-cancelled is only
        // emitted when the initiator leaves before anyone joins, so nobody
        // should be in the call yet. Calling leaveGroupCall() would kick
        // users who are already in the call from a previous invite.
      },
    );

    return () => {
      socket.off("group-call-invitation");
      socket.off("group-call-cancelled");
    };
  }, [socket, isInCall, roomId, incomingGroupCall?.roomId]);

  const handleAccept = async () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    if (incomingGroupCall) {
      await joinGroupCall(incomingGroupCall.roomId, incomingGroupCall.callType);
      setIncomingGroupCall(null);
    }
  };

  const handleReject = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    if (incomingGroupCall) {
      socket?.emit("group-call-rejected", {
        roomId: incomingGroupCall.roomId,
        participantId: user?._id,
      });
      setIncomingGroupCall(null);
    }
  };

  if (!incomingGroupCall) return null;

  // Already in the very call that's being announced — the toast is enough.
  if (isInCall && roomId === incomingGroupCall.roomId) return null;

  const callerName =
    incomingGroupCall.fromUser?.username || incomingGroupCall.from;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="neo w-full max-w-sm bg-retro-yellow p-6">
        <div className="mb-4 flex items-center gap-4">
          {incomingGroupCall.fromUser?.avatar ? (
            <img
              src={incomingGroupCall.fromUser.avatar}
              alt={callerName}
              className="neo-sm h-14 w-14 flex-shrink-0 rounded-sm border-2 border-ink object-cover"
            />
          ) : (
            <div className="neo-sm flex h-14 w-14 flex-shrink-0 items-center justify-center bg-retro-orange">
              <UserGroupIcon className="h-7 w-7 text-ink" />
            </div>
          )}
          <div>
            <p className="text-lg font-extrabold uppercase tracking-wide text-ink">
              Group Call
            </p>
            <p className="text-sm font-bold text-ink/80">From: {callerName}</p>
            <p className="text-xs font-bold uppercase tracking-wider text-ink/60">
              {incomingGroupCall.callType === "video" ? "Video" : "Audio"} call
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-4">
          <Button variant="red" size="icon" onClick={handleReject}>
            <PhoneXMarkIcon className="h-6 w-6" />
          </Button>
          <Button variant="green" size="icon" onClick={handleAccept}>
            <PhoneIcon className="h-6 w-6" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default GroupCallNotification;