import {
  VideoCameraIcon,
  VideoCameraSlashIcon,
  PhoneXMarkIcon,
  MicrophoneIcon,
  UserCircleIcon,
  FaceSmileIcon,
  FaceFrownIcon,
} from "@heroicons/react/24/solid";
import { useWebRTC } from "../../context/WebRTCContext";
import { classNames } from "../../utils";
import { useEffect, useState } from "react";
import useVoiceActivity from "../../utils/useVoiceActivity";
import { Button } from "../ui/button";
import Whiteboard from "../WhiteBoard";

interface CallModalProps {
  chatId?: string;
  remoteAvatar?: string;
  remoteName?: string;
  localAvatar?: string;
}

const CallModal: React.FC<CallModalProps> = ({
  chatId,
  remoteAvatar,
  remoteName,
  localAvatar,
}) => {
  const {
    localStream,
    remoteStream,
    isCallActive,
    isMuted,
    isVideoEnabled,
    callType,
    callConnectionState,
    isCallInitiator,
    endCall,
    toggleMute,
    toggleVideo,
  } = useWebRTC();

  const [isVisible, setIsVisible] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [localAvatarFailed, setLocalAvatarFailed] = useState(false);

  const remoteSpeaking = useVoiceActivity(remoteStream);
  const localSpeaking = useVoiceActivity(localStream);

  useEffect(() => {
    setAvatarFailed(false);
  }, [isCallActive, remoteAvatar]);

  const toggleWhiteboard = () => {
    setIsVisible(!isVisible);
  };

  const statusText =
    callConnectionState === "disconnected"
      ? "Disconnected"
      : remoteStream
        ? ""
        : isCallInitiator
          ? "Ringing..."
          : "Connecting...";

  if (!isCallActive) return null;

  if (callType === "audio") {
    return (
      <div className="relative z-10 w-full border-b-4 border-ink bg-retro-yellow shadow-[0_6px_0_0_var(--color-ink)]">
        {/* Route the remote audio to the speakers */}
        {remoteStream && (
          <audio
            autoPlay
            playsInline
            className="pointer-events-none absolute h-0 w-0 opacity-0"
            ref={(audio) => {
              if (audio) audio.srcObject = remoteStream;
            }}
          />
        )}
        <div className="relative flex h-64 w-full flex-col items-center justify-center gap-3 p-4">
          <p className="neo bg-ink px-4 py-1 text-sm font-extrabold uppercase tracking-widest text-retro-yellow">
            Voice Call
          </p>

          {/* Neo-brutalist: both participants side by side */}
          <div className="flex items-center justify-center gap-10">
            {/* Remote user */}
            <div className="flex flex-col items-center gap-3">
              <div
                className={classNames(
                  "relative rounded-full transition-transform duration-150",
                  remoteSpeaking ? "scale-110" : "",
                )}
              >
                {avatarFailed || !remoteAvatar ? (
                  <div className="neo flex h-24 w-24 items-center justify-center rounded-full bg-cream">
                    <UserCircleIcon className="h-16 w-16 text-ink" />
                  </div>
                ) : (
                  <>
                    {remoteSpeaking && (
                      <span className="absolute inset-0 animate-ping rounded-full bg-retro-orange opacity-50" />
                    )}
                    <img
                      src={remoteAvatar}
                      alt={remoteName}
                      onError={() => setAvatarFailed(true)}
                      className={classNames(
                        "relative h-24 w-24 rounded-full object-cover ring-[4px]",
                        remoteSpeaking ? "ring-retro-orange" : "ring-ink",
                      )}
                    />
                  </>
                )}
              </div>
              <div className="text-center">
                <p className="max-w-32 truncate text-sm font-extrabold uppercase tracking-wide text-ink">
                  {remoteName || "..."}
                </p>
                {statusText && (
                  <p
                    className={classNames(
                      "mt-0.5 text-xs font-bold uppercase tracking-wider",
                      statusText === "Disconnected"
                        ? "text-retro-red"
                        : "animate-pulse text-ink/60",
                    )}
                  >
                    {statusText}
                  </p>
                )}
              </div>
            </div>

            {/* Local user */}
            <div className="flex flex-col items-center gap-3">
              <div
                className={classNames(
                  "relative rounded-full transition-transform duration-150",
                  localSpeaking ? "scale-110" : "",
                )}
              >
                {localAvatarFailed || !localAvatar ? (
                  <div className="neo flex h-24 w-24 items-center justify-center rounded-full bg-cream">
                    <UserCircleIcon className="h-16 w-16 text-ink" />
                  </div>
                ) : (
                  <>
                    {localSpeaking && (
                      <span className="absolute inset-0 animate-ping rounded-full bg-retro-yellow opacity-60" />
                    )}
                    <img
                      src={localAvatar}
                      alt="You"
                      onError={() => setLocalAvatarFailed(true)}
                      className={classNames(
                        "relative h-24 w-24 rounded-full object-cover ring-[4px]",
                        localSpeaking ? "ring-retro-orange" : "ring-ink",
                      )}
                    />
                  </>
                )}
              </div>
              <div className="text-center">
                <p className="text-sm font-extrabold uppercase tracking-wide text-ink">
                  You
                </p>
                {isMuted ? (
                  <p className="mt-0.5 text-xs font-bold uppercase tracking-wider text-retro-red">
                    Muted
                  </p>
                ) : (
                  statusText && (
                    <p
                      className={classNames(
                        "mt-0.5 text-xs font-bold uppercase tracking-wider",
                        statusText === "Disconnected"
                          ? "text-retro-red"
                          : "animate-pulse text-ink/60",
                      )}
                    >
                      {statusText}
                    </p>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4">
            <Button
              variant={isMuted ? "red" : "yellow"}
              size="icon"
              onClick={toggleMute}
              title={isMuted ? "Unmute" : "Mute"}
            >
              <MicrophoneIcon className="h-5 w-5" />
            </Button>
            <Button variant="red" size="icon" onClick={endCall} title="End Call">
              <PhoneXMarkIcon className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 w-full border-b-4 border-ink bg-retro-yellow shadow-[0_6px_0_0_var(--color-ink)]">
      <div className="relative flex h-64 w-full items-center justify-center gap-4 p-4">
        {/* Remote User Block */}
        <div className="relative h-full w-1/2 overflow-hidden border-[3px] border-ink bg-ink">
          {remoteStream ? (
            <video
              key={remoteStream.id}
              autoPlay
              playsInline
              ref={(video) => {
                if (video) video.srcObject = remoteStream;
              }}
              className={classNames(
                "h-full w-full object-cover",
                remoteSpeaking ? "ring-[6px] ring-retro-orange" : "",
              )}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-ink">
              <UserCircleIcon className="h-20 w-20 text-retro-yellow" />
              <p className="animate-pulse text-sm font-extrabold uppercase tracking-wider text-retro-yellow">
                {isCallInitiator ? "Ringing..." : "Connecting..."}
              </p>
            </div>
          )}
          <span className="absolute left-2 top-2 rounded-sm bg-retro-yellow px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-ink">
            Remote
          </span>
          {remoteStream && statusText && (
            <span
              className={classNames(
                "absolute bottom-2 left-1/2 -translate-x-1/2 rounded-sm px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider",
                statusText === "Disconnected"
                  ? "bg-retro-red text-paper"
                  : "animate-pulse bg-ink text-retro-yellow",
              )}
            >
              {statusText}
            </span>
          )}
        </div>

        {/* Local User Block */}
        <div className="relative h-full w-1/2 overflow-hidden border-[3px] border-ink bg-ink">
          {localStream && isVideoEnabled ? (
            <video
              key="local-video"
              autoPlay
              playsInline
              muted
              ref={(video) => {
                if (video) video.srcObject = localStream;
              }}
              className={classNames(
                "h-full w-full object-cover",
                localSpeaking ? "ring-[6px] ring-retro-orange" : "",
              )}
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-ink">
              <UserCircleIcon className="h-20 w-20 text-retro-yellow" />
              <p className="text-xs font-extrabold uppercase tracking-wider text-retro-yellow">
                {isVideoEnabled ? "" : "Camera Off"}
              </p>
            </div>
          )}
          <span className="absolute left-2 top-2 rounded-sm bg-retro-yellow px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-ink">
            You
          </span>
          {isMuted && (
            <span className="absolute bottom-2 left-2 rounded-sm bg-retro-red px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-paper">
              Muted
            </span>
          )}
        </div>

        {/* Controls */}
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 border-[3px] border-ink bg-cream px-4 py-2 shadow-[4px_4px_0_0_var(--color-ink)]">
          <Button
            variant={isMuted ? "red" : "yellow"}
            size="icon-sm"
            onClick={toggleMute}
          >
            <MicrophoneIcon className="h-5 w-5" />
          </Button>
          <Button
            variant={!isVideoEnabled ? "red" : "blue"}
            size="icon-sm"
            onClick={toggleVideo}
          >
            {isVideoEnabled ? (
              <VideoCameraIcon className="h-5 w-5" />
            ) : (
              <VideoCameraSlashIcon className="h-5 w-5" />
            )}
          </Button>
          <Button
            variant="yellow"
            size="icon-sm"
            onClick={toggleWhiteboard}
            title="Toggle Whiteboard"
          >
            {isVisible ? (
              <FaceFrownIcon className="h-5 w-5" />
            ) : (
              <FaceSmileIcon className="h-5 w-5" />
            )}
          </Button>
          <Button variant="red" size="icon-sm" onClick={endCall}>
            <PhoneXMarkIcon className="h-5 w-5" />
          </Button>
        </div>
      </div>

      {/* Whiteboard Overlay */}
      <div
        className={classNames(
          "fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300",
          isVisible ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        <div className="relative max-h-[90vh] w-full max-w-5xl overflow-hidden border-[3px] border-ink bg-cream shadow-[8px_8px_0_0_var(--color-ink)]">
          {isVisible && <Whiteboard chatId={chatId} />}
        </div>
      </div>
    </div>
  );
};

export default CallModal;