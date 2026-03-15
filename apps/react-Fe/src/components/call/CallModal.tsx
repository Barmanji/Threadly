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
import { useState } from "react";
import Whiteboard from "../WhiteBoard";

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

  if (!isCallActive) return null;

  {
    /* TEST: WhiteBoard Socket Conn: Test#1 */
  }
  const [isVisible, setIsVisible] = useState(false);

  // 2. Define the toggle function
  const toggleWhiteboard = () => {
    setIsVisible(!isVisible);
  };
  {
    /* TEST: WhiteBoard Socket Conn: Test#1 */
  }
  return (
    <div className="relative z-10 w-full border-b border-gray-700 bg-gray-900 shadow-xl">
      <div className="relative flex h-64 w-full items-center justify-center gap-4 p-4">
        {/* Remote User Block */}
        <div className="relative h-full w-1/2 overflow-hidden rounded-lg bg-black">
          {remoteStream ? (
            <video
              key={remoteStream.id} // Re-binds stream if ID changes
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
          <div className="absolute bottom-2 left-2 rounded bg-black bg-opacity-50 px-2 py-1 text-xs text-white">
            Remote
          </div>
        </div>

        {/* Local User Block */}
        <div className="relative h-full w-1/2 overflow-hidden rounded-lg bg-black">
          {localStream && isVideoEnabled ? (
            <video
              key="local-video"
              autoPlay
              playsInline
              muted // Local video MUST be muted
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

        {/* Controls */}
        <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-4 rounded-full bg-gray-800 bg-opacity-90 px-6 py-2 shadow-lg">
          <button
            onClick={toggleMute}
            className={classNames(
              "rounded-full p-3 transition",
              isMuted ? "bg-red-600 text-white" : "text-white",
            )}
          >
            <MicrophoneIcon className="h-5 w-5" />
          </button>
          <button
            onClick={toggleVideo}
            className={classNames(
              "rounded-full p-3 transition",
              !isVideoEnabled ? "bg-red-600 text-white" : "text-white",
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
          {/*  TEST: WhiteBoard Socket Conn: Test#1 -->
                TODO: Gotta put it inside a call, else how the hell would i access it via call  */}
          <button
            onClick={toggleWhiteboard}
            className="rounded-full bg-red-600 p-3 text-white transition hover:bg-red-700"
          >
            {isVisible ? (
              <FaceFrownIcon className="w-6 h-6" />
            ) : (
              <FaceSmileIcon className="w-6 h-6" />
            )}
          </button>
          {isVisible && <Whiteboard />}
          {/*  TEST: WhiteBoard Socket Conn: Test#1  */}
        </div>
      </div>
    </div>
  );
};

export default CallModal;
