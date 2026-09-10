import {
  VideoCameraIcon,
  VideoCameraSlashIcon,
  PhoneXMarkIcon,
  MicrophoneIcon,
  UserCircleIcon,
  PencilSquareIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
} from "@heroicons/react/24/solid";
import { useGroupCall } from "../../context/GroupCallContext";
import { useSocket } from "../../context/SocketContext";
import { useAuth } from "../../context/AuthContext";
import { classNames } from "../../utils";
import { useEffect, useState } from "react";
import Whiteboard from "../WhiteBoard";

interface GroupCallModalProps {
  chatId?: string;
}

const MutedMicIcon: React.FC<{ className?: string }> = ({ className }) => (
  <span
    className={classNames("relative inline-flex flex-shrink-0", className ?? "")}
    aria-hidden="true"
  >
    <MicrophoneIcon className="h-full w-full" />
    <span className="absolute left-1/2 top-1/2 h-[2px] w-full -translate-x-1/2 -translate-y-1/2 rotate-45 bg-current" />
  </span>
);

const Avatar: React.FC<{ src?: string; username?: string }> = ({
  src,
  username,
}) =>
  src ? (
    <img
      src={src}
      alt={username ?? "Participant"}
      className="h-10 w-10 flex-shrink-0 rounded-sm border-[3px] border-ink object-cover"
    />
  ) : (
    <div className="h-10 w-10 flex-shrink-0 rounded-sm border-[3px] border-ink bg-retro-orange">
      <UserCircleIcon className="h-full w-full text-ink" />
    </div>
  );

const GroupCallModal: React.FC<GroupCallModalProps> = ({ chatId }) => {
  const {
    isInCall,
    localStream,
    participants,
    mediaStates,
    roomId: groupCallRoomId,
    leaveGroupCall,
    toggleLocalVideo,
    toggleLocalAudio,
  } = useGroupCall();
  const { user } = useAuth();

  const [isMinimized, setIsMinimized] = useState(false);
  const [isWhiteboardVisible, setIsWhiteboardVisible] = useState(false);
  const [whiteboardHint, setWhiteboardHint] = useState(false);
  const { socket } = useSocket();

  // Use the group call's roomId (the SFU room) for whiteboard sync — this is
  // the one ID that ALL participants share regardless of which chat they're
  // viewing. Fall back to the chatId prop for persistence if no group room.
  const whiteboardChatId = groupCallRoomId ?? chatId;

  // Reset whiteboard when a new call starts
  useEffect(() => {
    if (isInCall) setIsWhiteboardVisible(false);
  }, [isInCall]);

  // Listen for peer whiteboard open/close presence events
  useEffect(() => {
    if (!socket || !whiteboardChatId) return;
    socket.emit("joinChat", whiteboardChatId);

    const onOpen = () => setWhiteboardHint(true);
    const onCancel = () => setWhiteboardHint(false);
    socket.on("whiteboardOpen", onOpen);
    socket.on("whiteboardOpenCancel", onCancel);
    return () => {
      socket.off("whiteboardOpen", onOpen);
      socket.off("whiteboardOpenCancel", onCancel);
    };
  }, [socket, whiteboardChatId]);

  // While whiteboard is open, announce presence periodically
  useEffect(() => {
    if (!isWhiteboardVisible || !socket || !whiteboardChatId) return;
    socket.emit("whiteboardOpen", whiteboardChatId);
    const id = setInterval(() => {
      socket.emit("whiteboardOpen", whiteboardChatId);
    }, 2000);
    return () => {
      clearInterval(id);
      socket.emit("whiteboardOpenCancel", whiteboardChatId);
    };
  }, [isWhiteboardVisible, socket, whiteboardChatId]);

  if (!isInCall) return null;

  const participantArray = Array.from(participants.values());
  const totalInCall = participantArray.length + 1;

  const ownMediaState = user?._id ? mediaStates.get(user._id) : undefined;
  const cameraOn = ownMediaState
    ? ownMediaState.video
    : !!localStream?.getVideoTracks()[0];
  const micOn = ownMediaState ? ownMediaState.audio : true;

  const nameSummary = [
    "You",
    ...participantArray.slice(0, 3).map((p) => p.username),
  ]
    .filter(Boolean)
    .join(", ");

  const handleToggleVideo = () => {
    void toggleLocalVideo();
  };

  const handleToggleMute = () => {
    toggleLocalAudio();
  };

  // Minimized float: a small card (similar footprint to the 1:1 incoming call
  // notification) that shows how many people are on the call and lets you
  // expand back into the full call UI.
  if (isMinimized) {
    return (
      <div className="fixed bottom-4 left-4 z-[60] w-[300px]">
        <div className="neo flex flex-col gap-3 bg-retro-yellow p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-flex gap-1">
                <span className="animation1 h-2 w-2 rounded-full bg-retro-red" />
                <span className="animation2 h-2 w-2 rounded-full bg-retro-orange" />
                <span className="animation3 h-2 w-2 rounded-full bg-retro-red" />
              </span>
              <p className="text-sm font-extrabold uppercase tracking-wide text-ink">
                Group call
              </p>
            </div>
            <span className="neo-sm bg-ink px-2 py-0.5 text-xs font-extrabold uppercase tracking-wider text-retro-yellow">
              {totalInCall} in call
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex flex-shrink-0 -space-x-2">
              <div className="h-10 w-10 flex-shrink-0 rounded-sm border-[3px] border-ink bg-cream">
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt="You"
                    className="h-full w-full rounded-sm object-cover"
                  />
                ) : (
                  <UserCircleIcon className="h-full w-full text-ink" />
                )}
              </div>
              {participantArray.slice(0, 2).map((participant) => (
                <Avatar
                  key={participant.id}
                  src={participant.avatar}
                  username={participant.username}
                />
              ))}
              {totalInCall > 3 && (
                <span className="neo-sm flex h-10 w-10 flex-shrink-0 items-center justify-center bg-retro-orange text-xs font-extrabold text-paper">
                  +{totalInCall - 3}
                </span>
              )}
            </div>
            <p className="min-w-0 flex-1 truncate text-xs font-bold uppercase tracking-wide text-ink/80">
              {nameSummary}
            </p>
          </div>

          <div className="flex items-center justify-center gap-3 border-t-[3px] border-ink pt-3">
            <button
              onClick={() => setIsMinimized(false)}
              className="neo-sm neo-press flex items-center gap-2 rounded-sm bg-paper px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-ink hover:bg-retro-orange hover:text-paper"
              title="Maximize"
            >
              <ArrowsPointingOutIcon className="h-5 w-5" />
              Back to call
            </button>
            <button
              onClick={leaveGroupCall}
              className="neo-sm neo-press flex items-center gap-2 rounded-sm bg-retro-red px-4 py-2 text-xs font-extrabold uppercase tracking-wide text-paper hover:bg-ink"
              title="Leave call"
            >
              <PhoneXMarkIcon className="h-5 w-5" />
              Leave
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-ink p-4">
      {/* Header */}
      <div className="mb-4 flex flex-shrink-0 items-center justify-between">
        <span className="w-10" />
        <div className="neo-sm flex items-center gap-2 bg-retro-yellow px-4 py-2">
          <span className="inline-flex gap-1">
            <span className="animation1 h-2 w-2 rounded-full bg-retro-red" />
            <span className="animation2 h-2 w-2 rounded-full bg-retro-orange" />
            <span className="animation3 h-2 w-2 rounded-full bg-retro-red" />
          </span>
          <p className="text-sm font-extrabold uppercase tracking-wide text-ink">
            Group call
          </p>
        </div>
        <button
          onClick={() => setIsMinimized(true)}
          className="neo-sm neo-press rounded-sm bg-paper p-2 text-ink hover:bg-retro-orange hover:text-paper"
          title="Minimize"
        >
          <ArrowsPointingInIcon className="h-5 w-5" />
        </button>
      </div>

      {/* Main content — always-mounted whiteboard (hidden via CSS),
          grid layout toggled via CSS. */}
      <div className="min-h-0 flex-1">
        {/* Whiteboard layout — always mounted, hidden when not visible */}
        <div
          className="flex h-full gap-4"
          style={{ display: isWhiteboardVisible ? "flex" : "none" }}
        >
          {/* Whiteboard */}
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border-4 border-ink bg-paper">
            <Whiteboard
              chatId={whiteboardChatId}
              onClose={() => setIsWhiteboardVisible(false)}
            />
          </div>
          {/* Participant thumbnails (compact) */}
          <div className="flex w-48 flex-shrink-0 flex-col gap-3 overflow-y-auto rounded-xl border-4 border-ink bg-cream p-3">
            <p className="text-center text-[10px] font-extrabold uppercase tracking-wider text-ink">
              Participants
            </p>
            {/* Local */}
            <div className="relative aspect-video overflow-hidden rounded-lg border-[3px] border-ink bg-retro-yellow">
              {localStream &&
              localStream.getVideoTracks().length > 0 &&
              cameraOn ? (
                <video
                  autoPlay
                  playsInline
                  muted
                  ref={(video) => {
                    if (video && video.srcObject !== localStream)
                      video.srcObject = localStream;
                  }}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  {user?.avatar ? (
                    <img
                      src={user.avatar}
                      alt="You"
                      className="h-10 w-10 rounded-full border-2 border-ink object-cover"
                    />
                  ) : (
                    <UserCircleIcon className="h-10 w-10 text-ink" />
                  )}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-ink/70 px-2 py-0.5">
                <p className="text-[9px] font-extrabold uppercase text-paper">
                  You
                </p>
                {micOn ? (
                  <MicrophoneIcon className="h-3 w-3 text-retro-green" />
                ) : (
                  <MutedMicIcon className="h-3 w-3 text-retro-red" />
                )}
              </div>
            </div>
            {/* Remote participants */}
            {participantArray.map((participant) => {
              const state = mediaStates.get(participant.id);
              const videoTrack = participant.stream.getVideoTracks()[0];
              const hasVideo = !!videoTrack && videoTrack.enabled;
              const videoTrackId = videoTrack?.id ?? "none";
              return (
                <div
                  key={participant.id}
                  className="relative aspect-video overflow-hidden rounded-lg border-[3px] border-ink bg-retro-orange"
                >
                  {hasVideo ? (
                    <video
                      key={`${participant.id}-${videoTrackId}`}
                      autoPlay
                      playsInline
                      ref={(video) => {
                        if (video && video.srcObject !== participant.stream)
                          video.srcObject = participant.stream;
                      }}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      {participant.avatar ? (
                        <img
                          src={participant.avatar}
                          alt={participant.username ?? "Participant"}
                          className="h-10 w-10 rounded-full border-2 border-ink object-cover"
                        />
                      ) : (
                        <UserCircleIcon className="h-10 w-10 text-ink" />
                      )}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-ink/70 px-2 py-0.5">
                    <p className="truncate text-[9px] font-extrabold uppercase text-paper">
                      {participant.username ?? "Participant"}
                    </p>
                    {participant.stream.getAudioTracks().length === 0 ||
                    state?.audio === false ? (
                      <MutedMicIcon className="h-3 w-3 text-retro-red" />
                    ) : (
                      <MicrophoneIcon className="h-3 w-3 text-retro-green" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Video grid layout — hidden when whiteboard is visible */}
        <div
          className="grid h-full grid-flow-row-dense grid-cols-1 gap-4 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3"
          style={{ display: isWhiteboardVisible ? "none" : "grid" }}
        >
            {/* Local User */}
            <div className="relative aspect-video overflow-hidden rounded-xl border-4 border-ink bg-cream">
              {localStream &&
              localStream.getVideoTracks().length > 0 &&
              cameraOn ? (
                <video
                  autoPlay
                  playsInline
                  muted
                  ref={(video) => {
                    if (video && video.srcObject !== localStream)
                      video.srcObject = localStream;
                  }}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-retro-yellow">
                  {user?.avatar ? (
                    <img
                      src={user.avatar}
                      alt="You"
                      className="h-20 w-20 rounded-full border-4 border-ink object-cover"
                    />
                  ) : (
                    <UserCircleIcon className="h-20 w-20 text-ink" />
                  )}
                </div>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-ink/70 px-3 py-1.5">
                <p className="text-xs font-extrabold uppercase tracking-wide text-paper">
                  You
                </p>
                {micOn ? (
                  <MicrophoneIcon className="h-4 w-4 text-retro-green" />
                ) : (
                  <MutedMicIcon className="h-4 w-4 text-retro-red" />
                )}
              </div>
            </div>

            {participantArray.length === 0 ? (
              <div className="col-span-full flex items-center justify-center">
                <p className="neo-sm bg-cream px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-ink">
                  Waiting for others to join...
                </p>
              </div>
            ) : null}

            {participantArray.map((participant) => {
              const state = mediaStates.get(participant.id);
              const videoTrack = participant.stream.getVideoTracks()[0];
              const hasVideo = !!videoTrack && videoTrack.enabled;
              const videoTrackId = videoTrack?.id ?? "none";

              return (
                <div
                  key={participant.id}
                  className="relative aspect-video overflow-hidden rounded-xl border-4 border-ink bg-cream"
                >
                  {hasVideo ? (
                    <video
                      key={`${participant.id}-${videoTrackId}`}
                      autoPlay
                      playsInline
                      ref={(video) => {
                        if (video && video.srcObject !== participant.stream)
                          video.srcObject = participant.stream;
                      }}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <>
                      <audio
                        autoPlay
                        playsInline
                        className="pointer-events-none absolute h-0 w-0 opacity-0"
                        ref={(media) => {
                          if (
                            media &&
                            media.srcObject !== participant.stream
                          )
                            media.srcObject = participant.stream;
                        }}
                      />
                      <div className="flex h-full w-full items-center justify-center bg-retro-orange">
                        {participant.avatar ? (
                          <img
                            src={participant.avatar}
                            alt={participant.username ?? "Participant"}
                            className="h-20 w-20 rounded-full border-4 border-ink object-cover"
                          />
                        ) : (
                          <UserCircleIcon className="h-20 w-20 text-ink" />
                        )}
                      </div>
                    </>
                  )}
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-ink/70 px-3 py-1.5">
                    <p className="truncate text-xs font-extrabold uppercase tracking-wide text-paper">
                      {participant.username ?? "Participant"}
                    </p>
                    {participant.stream.getAudioTracks().length === 0 ||
                    state?.audio === false ? (
                      <MutedMicIcon className="h-4 w-4 text-retro-red" />
                    ) : (
                      <MicrophoneIcon className="h-4 w-4 text-retro-green" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
      </div>

      {/* Always-on hidden audio tracks so participants are heard even when
          the whiteboard is open and the video grid is hidden. */}
      <div className="sr-only" aria-hidden="true">
        {participantArray.map((participant) => (
          <audio
            key={`audio-${participant.id}`}
            autoPlay
            playsInline
            ref={(el) => {
              if (el && el.srcObject !== participant.stream)
                el.srcObject = participant.stream;
            }}
          />
        ))}
      </div>

      {/* Controls bar */}
      <div className="mt-4 flex flex-shrink-0 items-center justify-center gap-4">
        <button
          onClick={handleToggleMute}
          className={classNames(
            "neo-sm neo-press rounded-full p-3 transition",
            !micOn
              ? "bg-retro-red text-paper"
              : "bg-paper text-ink hover:bg-retro-yellow",
          )}
          title={micOn ? "Mute" : "Unmute"}
        >
          {micOn ? (
            <MicrophoneIcon className="h-6 w-6" />
          ) : (
            <MutedMicIcon className="h-6 w-6" />
          )}
        </button>

        <button
          onClick={handleToggleVideo}
          className={classNames(
            "neo-sm neo-press rounded-full p-3 transition",
            !cameraOn
              ? "bg-retro-red text-paper"
              : "bg-paper text-ink hover:bg-retro-yellow",
          )}
          title={cameraOn ? "Turn camera off" : "Turn camera on"}
        >
          {cameraOn ? (
            <VideoCameraIcon className="h-6 w-6" />
          ) : (
            <VideoCameraSlashIcon className="h-6 w-6" />
          )}
        </button>

        <button
          onClick={leaveGroupCall}
          className="neo-sm neo-press rounded-full bg-retro-red p-3 text-paper transition hover:bg-ink"
          title="Leave call"
        >
          <PhoneXMarkIcon className="h-6 w-6" />
        </button>

        <button
          onClick={() => {
            setWhiteboardHint(false);
            setIsWhiteboardVisible((prev) => !prev);
          }}
          className={classNames(
            "neo-sm neo-press rounded-full p-3 transition",
            isWhiteboardVisible
              ? "bg-retro-orange text-paper"
              : whiteboardHint
                ? "bg-retro-orange text-paper animate-pulse"
                : "bg-paper text-ink hover:bg-retro-orange",
          )}
          title={whiteboardHint && !isWhiteboardVisible ? "Peer is on the whiteboard" : "Whiteboard"}
        >
          <PencilSquareIcon className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
};

export default GroupCallModal;