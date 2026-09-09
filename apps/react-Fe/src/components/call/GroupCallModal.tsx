import {
  VideoCameraIcon,
  VideoCameraSlashIcon,
  PhoneXMarkIcon,
  MicrophoneIcon,
  UserCircleIcon,
  FaceSmileIcon,
} from "@heroicons/react/24/solid";
import { useGroupCall } from "../../context/GroupCallContext";
import { classNames } from "../../utils";
import { useState } from "react";
import Whiteboard from "../WhiteBoard";

interface GroupCallModalProps {
  chatId?: string;
}

const GroupCallModal: React.FC<GroupCallModalProps> = ({ chatId }) => {
  const {
    isInCall,
    localStream,
    participants,
    leaveGroupCall,
    toggleLocalVideo,
    toggleLocalAudio,
  } = useGroupCall();

  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isWhiteboardVisible, setIsWhiteboardVisible] = useState(false);

  const handleToggleVideo = () => {
    toggleLocalVideo();
    setIsVideoEnabled(!isVideoEnabled);
  };

  const handleToggleMute = () => {
    toggleLocalAudio();
    setIsMuted(!isMuted);
  };

  if (!isInCall) return null;

  const participantArray = Array.from(participants.values());

  return (
    <div className="relative z-50 flex h-full flex-col bg-gray-900">
      {/* Main Video Grid */}
      <div className="flex-1 p-4">
        {isWhiteboardVisible ? (
          <div className="h-full w-full rounded-lg overflow-hidden">
            <Whiteboard chatId={chatId} />
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 h-full">
            {/* Local User */}
            <div className="relative aspect-video rounded-lg bg-gray-800 overflow-hidden">
              {localStream && isVideoEnabled ? (
                <video
                  autoPlay
                  playsInline
                  muted
                  ref={(video) => {
                    if (video && localStream) video.srcObject = localStream;
                  }}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <UserCircleIcon className="h-16 w-16 text-gray-500" />
                </div>
              )}
              <div className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-xs text-white">
                You
              </div>
            </div>

            {/* Remote Participants */}
            {participantArray.map((participant) => (
              <div
                key={participant.socketId}
                className="relative aspect-video rounded-lg bg-gray-800 overflow-hidden"
              >
                {participant.stream ? (
                  participant.isVideoEnabled ? (
                    <video
                      autoPlay
                      playsInline
                      ref={(video) => {
                        if (video && participant.stream)
                          video.srcObject = participant.stream;
                      }}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center bg-gray-700">
                      {participant.avatar ? (
                        <img
                          src={participant.avatar}
                          alt="Avatar"
                          className="h-16 w-16 rounded-full"
                        />
                      ) : (
                        <UserCircleIcon className="h-16 w-16 text-gray-400" />
                      )}
                    </div>
                  )
                ) : (
                  <div className="flex h-full items-center justify-center bg-gray-700">
                    <UserCircleIcon className="h-16 w-16 text-gray-400" />
                  </div>
                )}
                <div className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-1 text-xs text-white">
                  {participant.isAudioEnabled ? "Audio" : "Participant"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Controls Bar */}
      <div className="flex items-center justify-center gap-4 p-4 bg-gray-800/50">
        <button
          onClick={handleToggleMute}
          className={classNames(
            "rounded-full p-3 transition",
            isMuted
              ? "bg-red-600 text-white"
              : "bg-gray-700 text-white hover:bg-gray-600",
          )}
        >
          <MicrophoneIcon className="h-5 w-5" />
        </button>

        <button
          onClick={handleToggleVideo}
          className={classNames(
            "rounded-full p-3 transition",
            !isVideoEnabled
              ? "bg-red-600 text-white"
              : "bg-gray-700 text-white hover:bg-gray-600",
          )}
        >
          {isVideoEnabled ? (
            <VideoCameraIcon className="h-5 w-5" />
          ) : (
            <VideoCameraSlashIcon className="h-5 w-5" />
          )}
        </button>

        <button
          onClick={leaveGroupCall}
          className="rounded-full bg-red-600 p-3 text-white transition hover:bg-red-700"
        >
          <PhoneXMarkIcon className="h-5 w-5" />
        </button>

        <button
          onClick={() => setIsWhiteboardVisible(!isWhiteboardVisible)}
          className={classNames(
            "rounded-full p-3 transition",
            isWhiteboardVisible
              ? "bg-blue-600 text-white"
              : "bg-gray-700 text-white hover:bg-gray-600",
          )}
        >
          <FaceSmileIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
};

export default GroupCallModal;
