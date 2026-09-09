import {
  VideoCameraIcon,
  VideoCameraSlashIcon,
  PhoneXMarkIcon,
  MicrophoneIcon,
  UserCircleIcon,
  FaceSmileIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
} from "@heroicons/react/24/solid";
import { useGroupCall } from "../../context/GroupCallContext";
import { useAuth } from "../../context/AuthContext";
import { classNames } from "../../utils";
import { useState } from "react";
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
    leaveGroupCall,
    toggleLocalVideo,
    toggleLocalAudio,
  } = useGroupCall();
  const { user } = useAuth();

  const [isMinimized, setIsMinimized] = useState(false);
  const [isWhiteboardVisible, setIsWhiteboardVisible] = useState(false);

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

      {/* Main video grid */}
      <div className="min-h-0 flex-1">
        {isWhiteboardVisible ? (
          <div className="h-full w-full overflow-hidden rounded-xl border-4 border-ink bg-paper">
            <Whiteboard chatId={chatId} />
          </div>
        ) : (
          <div className="grid h-full grid-flow-row-dense grid-cols-1 gap-4 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
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

            {/* Remote participants */}
            {participantArray.length === 0 ? (
              <div className="col-span-full flex items-center justify-center">
                <p className="neo-sm bg-cream px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-ink">
                  Waiting for others to join...
                </p>
              </div>
            ) : null}

            {participantArray.map((participant) => {
              const state = mediaStates.get(participant.id);
              const hasVideo =
                participant.stream.getVideoTracks().length > 0 &&
                state?.video !== false;

              return (
                <div
                  key={participant.id}
                  className="relative aspect-video overflow-hidden rounded-xl border-4 border-ink bg-cream"
                >
                  {hasVideo ? (
                    <video
                      autoPlay
                      playsInline
                      ref={(video) => {
                        if (
                          video &&
                          video.srcObject !== participant.stream
                        )
                          video.srcObject = participant.stream;
                      }}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <>
                      {/* No video element to carry the audio — without this,
                          audio-only participants (and camera-off ones) are
                          completely silent. Bind the track to a hidden audio
                          element instead. */}
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
        )}
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
          onClick={() => setIsWhiteboardVisible((prev) => !prev)}
          className={classNames(
            "neo-sm neo-press rounded-full p-3 transition",
            isWhiteboardVisible
              ? "bg-retro-orange text-paper"
              : "bg-paper text-ink hover:bg-retro-orange",
          )}
          title="Toggle whiteboard"
        >
          <FaceSmileIcon className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
};

export default GroupCallModal;