import {
  VideoCameraIcon,
  VideoCameraSlashIcon,
  PhoneXMarkIcon,
  MicrophoneIcon,
  UserCircleIcon,
} from "@heroicons/react/24/solid";
import { useWebRTC } from "../../context/WebRTCContext";
import { classNames } from "../../utils";

const CallModal: React.FC = () => {
  const {
    localStream,
    remoteStream,
    isCallActive,
    isMuted,
    isVideoEnabled,
    endCall,
    toggleMute,
    toggleVideo,
  } = useWebRTC();

  if (!isCallActive) {
    return null;
  }

  // FIX: Modified AI CODE STARTS HERE
  // Embedded Top-bar banner style (Discord-like)
  return (
    <div className="relative z-10 w-full border-b border-gray-700 bg-gray-900 shadow-xl">
      <div className="relative flex h-64 w-full items-center justify-center gap-4 p-4">
        {/* Remote User */}
        <div className="relative h-full w-1/2 overflow-hidden rounded-lg bg-black">
          {remoteStream &&
          remoteStream.getVideoTracks().length > 0 &&
          remoteStream.getVideoTracks().some((track) => track.enabled) ? (
            <video
              autoPlay
              playsInline
              ref={(video) => {
                if (video) video.srcObject = remoteStream;
              }}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gray-800">
              <UserCircleIcon className="h-20 w-20 text-gray-500" />
            </div>
          )}
          {/* Status Indicator (Optional) */}
          <div className="absolute bottom-2 left-2 rounded bg-black bg-opacity-50 px-2 py-1 text-xs text-white">
            Remote
          </div>
        </div>

        {/* Local User */}
        <div className="relative h-full w-1/2 overflow-hidden rounded-lg bg-black">
          {localStream &&
          localStream.getVideoTracks().length > 0 &&
          isVideoEnabled ? (
            <video
              autoPlay
              playsInline
              muted
              ref={(video) => {
                if (video) video.srcObject = localStream;
              }}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gray-800">
              <UserCircleIcon className="h-20 w-20 text-gray-500" />
            </div>
          )}
          <div className="absolute bottom-2 left-2 rounded bg-black bg-opacity-50 px-2 py-1 text-xs text-white">
            You
          </div>
        </div>

        {/* Controls Overlay */}
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-4 rounded-full bg-gray-800 bg-opacity-90 px-6 py-2 shadow-lg">
          <button
            onClick={toggleMute}
            className={classNames(
              "rounded-full p-3 transition hover:bg-gray-700",
              isMuted ? "bg-red-600 text-white hover:bg-red-700" : "text-white",
            )}
          >
            <MicrophoneIcon
              className={classNames("h-5 w-5", isMuted ? "" : "")}
            />
          </button>
          <button
            onClick={toggleVideo}
            className={classNames(
              "rounded-full p-3 transition hover:bg-gray-700",
              !isVideoEnabled
                ? "bg-red-600 text-white hover:bg-red-700"
                : "text-white",
            )}
          >
            {isVideoEnabled ? (
              <VideoCameraIcon className="h-5 w-5" />
            ) : (
              <VideoCameraSlashIcon className="h-5 w-5" />
            )}
          </button>
          <button
            onClick={endCall}
            className="rounded-full bg-red-600 p-3 text-white transition hover:bg-red-700"
          >
            <PhoneXMarkIcon className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>
  );
  // FIX: ENDS HERE
};

export default CallModal;
