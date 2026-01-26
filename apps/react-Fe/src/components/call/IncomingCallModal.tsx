import { PhoneIcon, PhoneXMarkIcon } from "@heroicons/react/24/solid";
import { useWebRTC } from "../../context/WebRTCContext";

const IncomingCallModal = () => {
  const { incomingCall, acceptIncomingCall, rejectIncomingCall } = useWebRTC();

  if (!incomingCall) {
    return null;
  }

  // FIX: Modified AI CODE STARTS HERE
  // Top-bar banner style (Embedded)
  return (
    <div className="relative z-10 flex w-full items-center justify-between border-b border-gray-700 bg-gray-800 px-6 py-4 shadow-md">
      <div className="flex items-center gap-x-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-700">
          <PhoneIcon className="h-6 w-6 animate-pulse text-white" />
        </div>
        <div>
          <p className="text-lg font-bold text-white">Incoming Call</p>
          <p className="text-sm text-gray-400">From: {incomingCall.from}</p>
        </div>
      </div>
      <div className="flex gap-x-4">
        <button
          onClick={rejectIncomingCall}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-700"
          title="Decline"
        >
          <PhoneXMarkIcon className="h-6 w-6" />
        </button>
        <button
          onClick={acceptIncomingCall}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-green-600 text-white transition hover:bg-green-700"
          title="Accept"
        >
          <PhoneIcon className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
  // FIX: ENDS HERE
};

export default IncomingCallModal;
