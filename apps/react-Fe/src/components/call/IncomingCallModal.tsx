import {
  PhoneIcon,
  PhoneXMarkIcon,
  UserCircleIcon,
} from "@heroicons/react/24/solid";
import { useState, useEffect } from "react";
import { useWebRTC } from "../../context/WebRTCContext";
import { Button } from "../ui/button";

const IncomingCallModal = () => {
  const { incomingCall, acceptIncomingCall, rejectIncomingCall } = useWebRTC();
  const [avatarFailed, setAvatarFailed] = useState(false);

  useEffect(() => {
    setAvatarFailed(false);
  }, [incomingCall?.from]);

  if (!incomingCall) {
    return null;
  }

  const callerName = incomingCall.fromUser?.username || incomingCall.from;
  const callerAvatar = incomingCall.fromUser?.avatar;
  const callLabel =
    incomingCall.callType === "video" ? "Video Call" : "Audio Call";

  return (
    <div className="relative z-10 flex w-full items-center justify-between border-b-4 border-ink bg-retro-orange px-6 py-4 shadow-[0_6px_0_0_var(--color-ink)]">
      <div className="flex items-center gap-x-4">
        <div className="relative">
          {callerAvatar && !avatarFailed ? (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-retro-yellow opacity-60" />
              <img
                src={callerAvatar}
                alt={callerName}
                onError={() => setAvatarFailed(true)}
                className="relative h-14 w-14 rounded-full object-cover ring-[4px] ring-ink"
              />
            </>
          ) : (
            <div className="neo flex h-14 w-14 items-center justify-center rounded-full bg-cream">
              <UserCircleIcon className="h-8 w-8 text-ink" />
            </div>
          )}
        </div>
        <div>
          <p className="neo-sm inline-block bg-retro-yellow px-2 py-0.5 text-lg font-extrabold uppercase tracking-wide text-ink">
            Incoming {callLabel}
          </p>
          <p className="mt-1 text-sm font-bold text-ink/90">
            {callerName} is calling you...
          </p>
        </div>
      </div>
      <div className="flex gap-x-4">
        <Button
          variant="red"
          size="icon"
          onClick={rejectIncomingCall}
          title="Decline"
        >
          <PhoneXMarkIcon className="h-6 w-6" />
        </Button>
        <Button
          variant="green"
          size="icon"
          onClick={acceptIncomingCall}
          title="Accept"
        >
          <PhoneIcon className="h-6 w-6" />
        </Button>
      </div>
    </div>
  );
};

export default IncomingCallModal;