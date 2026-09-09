import {
  PhoneIcon,
  PhoneXMarkIcon,
  UserGroupIcon,
} from "@heroicons/react/24/solid";
import { useState, useEffect } from "react";
import { useSocket } from "../../context/SocketContext";
import { useGroupCall } from "../../context/GroupCallContext";
import { Button } from "../ui/button";

const GroupCallNotification: React.FC = () => {
  const { socket } = useSocket();
  const { joinGroupCall } = useGroupCall();
  const [incomingGroupCall, setIncomingGroupCall] = useState<{
    roomId: string;
    callType: "video" | "audio";
    from: string;
  } | null>(null);

  useEffect(() => {
    if (!socket) return;

    socket.on(
      "group-call-invitation",
      (data: { roomId: string; callType: "video" | "audio"; from: string }) => {
        setIncomingGroupCall(data);
      },
    );

    return () => {
      socket.off("group-call-invitation");
    };
  }, [socket]);

  const handleAccept = async () => {
    if (incomingGroupCall) {
      await joinGroupCall(incomingGroupCall.roomId);
      setIncomingGroupCall(null);
    }
  };

  const handleReject = () => {
    setIncomingGroupCall(null);
  };

  if (!incomingGroupCall) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="neo w-full max-w-sm bg-retro-yellow p-6">
        <div className="mb-4 flex items-center gap-4">
          <div className="neo-sm flex h-14 w-14 items-center justify-center bg-retro-orange">
            <UserGroupIcon className="h-7 w-7 text-ink" />
          </div>
          <div>
            <p className="text-lg font-extrabold uppercase tracking-wide text-ink">
              Group Call
            </p>
            <p className="text-sm font-bold text-ink/80">
              From: {incomingGroupCall.from}
            </p>
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