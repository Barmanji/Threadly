import {
  VideoCameraIcon,
  VideoCameraSlashIcon,
  PhoneXMarkIcon,
  MicrophoneIcon,
  UserCircleIcon,
  PencilSquareIcon,
  ArrowsPointingInIcon,
} from "@heroicons/react/24/solid";
import { useWebRTC } from "../../context/WebRTCContext";
import { useSocket } from "../../context/SocketContext";
import { classNames } from "../../utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useVoiceActivity from "../../utils/useVoiceActivity";
import { Button } from "../ui/button";
import { saveWhiteboardState } from "../../api";
import Whiteboard from "../WhiteBoard";

interface CallModalProps {
  chatId?: string;
  remoteAvatar?: string;
  remoteName?: string;
  localAvatar?: string;
}

const WHITEBOARD_OPEN_EVENT = "whiteboardOpen";
const WHITEBOARD_OPEN_CANCEL_EVENT = "whiteboardOpenCancel";

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
    remoteMuted,
    remoteVideoOff,
    callType,
    callConnectionState,
    isCallInitiator,
    endCall,
    toggleMute,
    toggleVideo,
  } = useWebRTC();
  const { socket } = useSocket();

  const [isVisible, setIsVisible] = useState(false);
  const [whiteboardHint, setWhiteboardHint] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [localAvatarFailed, setLocalAvatarFailed] = useState(false);
  const [whiteboardHeight, setWhiteboardHeight] = useState(400);
  const draggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragStartHRef = useRef(0);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // Reset whiteboard when a new call starts so stale state doesn't carry over.
  useEffect(() => {
    if (isCallActive) setIsVisible(false);
  }, [isCallActive]);

  const remoteSpeaking = useVoiceActivity(remoteStream);
  const localSpeaking = useVoiceActivity(localStream);

  // Track whether we've joined the chat room for this call.
  const roomJoinedRef = useRef(false);

  useEffect(() => {
    setAvatarFailed(false);
  }, [isCallActive, remoteAvatar]);

  // Remote video/audio state comes from the peer-media-state socket event
  // (set in WebRTCContext). track.enabled is local-only and doesn't reflect
  // the remote peer's toggle, so we rely on the signaling path.
  const remoteVideoOn = !remoteVideoOff;
  const remoteAudioOn = !remoteMuted;

  // `autoPlay` on its own is not enough to guarantee a picture. A media element
  // whose srcObject is assigned after insertion can sit on frame 0 forever, and
  // both tiles remount whenever the stream id or a video toggle changes (see
  // their `key` props), which restarts playback from scratch. Nudging play()
  // whenever an element or its stream changes covers both cases. The rejection
  // is swallowed on purpose: a not-yet-playable element just means no track is
  // attached yet, and the next stream change retries.
  useEffect(() => {
    const elements = [
      remoteVideoRef.current,
      localVideoRef.current,
      remoteAudioRef.current,
    ];
    for (const el of elements) void el?.play().catch(() => {});
  }, [remoteStream, localStream, isVideoEnabled, remoteVideoOn, isCallActive]);

  // Listen for the peer opening/closing the shared whiteboard.
  // Only active during an active call to avoid picking up stale events.
  useEffect(() => {
    if (!socket || !isCallActive) return;
    const onOpen = () => setWhiteboardHint(true);
    const onCancel = () => setWhiteboardHint(false);
    socket.on(WHITEBOARD_OPEN_EVENT, onOpen);
    socket.on(WHITEBOARD_OPEN_CANCEL_EVENT, onCancel);
    return () => {
      socket.off(WHITEBOARD_OPEN_EVENT, onOpen);
      socket.off(WHITEBOARD_OPEN_CANCEL_EVENT, onCancel);
    };
  }, [socket, isCallActive]);

  const toggleWhiteboard = () => {
    setWhiteboardHint(false);
    setIsVisible((prev) => !prev);
  };

// Join the chat room so whiteboard sync + presence events reach us. This
  // runs on every render while the call is active to handle socket reconnects.
  useEffect(() => {
    if (!socket || !chatId || !isCallActive) return;
    console.log("[whiteboard] joining chat room:", chatId);
    socket.emit("joinChat", chatId);
    roomJoinedRef.current = true;
  });

  // While the whiteboard is open, keep announcing it. A peer who joins (or
  // accepts the call) after the board was already opened still sees their
  // button blink — a one-shot event would be missed entirely.
  useEffect(() => {
    if (!isVisible || !socket || !chatId) return;
    console.log("[whiteboard] emitting whiteboardOpen for chat:", chatId);
    socket.emit(WHITEBOARD_OPEN_EVENT, chatId);
    const id = setInterval(() => {
      socket.emit(WHITEBOARD_OPEN_EVENT, chatId);
    }, 2000);
    return () => {
      clearInterval(id);
      socket.emit(WHITEBOARD_OPEN_CANCEL_EVENT, chatId);
    };
  }, [isVisible, socket, chatId]);

  // Background whiteboard sync: always listen for remote updates and persist
  // them to the server so the state is available when the other user opens
  // their board — even if their WhiteBoard component isn't mounted yet.
  const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestWbRef = useRef<{
    elements: unknown[];
    appState: unknown;
  } | null>(null);

  const flushSave = useCallback(async () => {
    pendingSaveRef.current = null;
    if (!chatId || !latestWbRef.current) return;
    const data = latestWbRef.current;
    latestWbRef.current = null;
    try {
      await saveWhiteboardState(chatId, {
        elements: data.elements,
        appState: data.appState ?? null,
      });
    } catch {
      // best-effort
    }
  }, [chatId]);

  useEffect(() => {
    if (!socket || !chatId || !isCallActive) return;

    const onUpdate = (data: { elements?: unknown[]; appState?: unknown }) => {
      if (!Array.isArray(data?.elements)) return;
      latestWbRef.current = {
        elements: data.elements,
        appState: data.appState ?? null,
      };
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
      pendingSaveRef.current = setTimeout(flushSave, 1200);
    };

    socket.on("whiteboardUpdate", onUpdate);
    return () => {
      socket.off("whiteboardUpdate", onUpdate);
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    };
  }, [socket, chatId, isCallActive, flushSave]);

  // Drag-to-resize for the audio call whiteboard
  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      draggingRef.current = true;
      dragStartYRef.current = e.clientY;
      dragStartHRef.current = whiteboardHeight;

      const onMove = (ev: MouseEvent) => {
        if (!draggingRef.current) return;
        const delta = ev.clientY - dragStartYRef.current;
        // From `sm` the panel is an overlay pinned to the top of the chat pane
        // rather than a sibling in the flow, so growing it no longer pushes the
        // composer down. That also means an unbounded height would cover the
        // composer instead, so the ceiling leaves room for the header, the
        // composer and a peek of the conversation. On mobile the 45vh cap
        // dominates this anyway.
        setWhiteboardHeight(
          Math.max(150, Math.min(dragStartHRef.current + delta, window.innerHeight - 320)),
        );
      };
      const onUp = () => {
        draggingRef.current = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [whiteboardHeight],
  );

  const statusText =
    callConnectionState === "disconnected"
      ? "Disconnected"
      : remoteStream
        ? ""
        : isCallInitiator
          ? "Ringing..."
          : "Connecting...";

  const whiteboardButton = (
    <Button
      variant={whiteboardHint && !isVisible ? "orange" : "yellow"}
      size="icon"
      onClick={toggleWhiteboard}
      title={whiteboardHint ? "Peer is on the whiteboard" : "Whiteboard"}
      className={classNames(
        whiteboardHint && !isVisible ? "animate-pulse" : "",
      )}
    >
      <PencilSquareIcon className="h-5 w-5" />
    </Button>
  );

  // Shared remote/local tiles so the same video keeps rendering in the
  // normal call view and inside the whiteboard meeting layout.
  const remoteTile = (extraClass: string) => {
    return (
      <div
        className={classNames(
          "relative overflow-hidden border-[3px] border-ink bg-ink",
          extraClass,
        )}
      >
        {remoteStream && remoteVideoOn ? (
          <div
            className={classNames(
              "h-full w-full",
              remoteSpeaking ? "ring-[6px] ring-retro-orange" : "",
            )}
          >
            <video
              key={`${remoteStream.id}-${remoteVideoOn}`}
              autoPlay
              playsInline
              // Muted on purpose. This element is video-only: the remote audio
              // track is played by the dedicated <audio> below. Browsers refuse
              // to autoplay unmuted media once the gesture that started the call
              // has expired — which it always has by the time signalling
              // finishes — so an unmuted element renders as a black frame. Muted
              // autoplay is always permitted, and nothing is lost because the
              // audio moved to its own element.
              muted
              ref={(video) => {
                remoteVideoRef.current = video;
                if (video && video.srcObject !== remoteStream)
                  video.srcObject = remoteStream;
              }}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-ink">
            {remoteAvatar && !avatarFailed ? (
              <img
                src={remoteAvatar}
                alt={remoteName}
                onError={() => setAvatarFailed(true)}
                className="h-20 w-20 rounded-full border-4 border-retro-yellow object-cover"
              />
            ) : (
              <UserCircleIcon className="h-20 w-20 text-retro-yellow" />
            )}
            <p className="text-xs font-extrabold uppercase tracking-wider text-retro-yellow">
              Camera Off
            </p>
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-sm bg-retro-yellow px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-ink">
          {remoteName || "Remote"}
        </span>
        {remoteStream && !remoteAudioOn && (
          <span className="absolute bottom-2 left-2 rounded-sm bg-retro-red px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-paper">
            Muted
          </span>
        )}
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
    );
  };

  const localTile = (extraClass: string) => (
    <div
      className={classNames(
        "relative overflow-hidden border-[3px] border-ink bg-ink",
        extraClass,
      )}
    >
      {localStream && isVideoEnabled ? (
        <div
          className={classNames(
            "h-full w-full",
            localSpeaking ? "ring-[6px] ring-retro-orange" : "",
          )}
        >
          <video
            key={`local-${isVideoEnabled}`}
            autoPlay
            playsInline
            muted
            ref={(video) => {
              localVideoRef.current = video;
              if (video && video.srcObject !== localStream)
                video.srcObject = localStream;
            }}
            className="h-full w-full object-cover"
          />
        </div>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-ink">
          {localAvatar && !localAvatarFailed ? (
            <img
              src={localAvatar}
              alt="You"
              onError={() => setLocalAvatarFailed(true)}
              className="h-20 w-20 rounded-full border-4 border-retro-yellow object-cover"
            />
          ) : (
            <UserCircleIcon className="h-20 w-20 text-retro-yellow" />
          )}
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
  );

  if (!isCallActive) return null;

  // Video call: resizable layout with drag handle.
  //
  // From `sm` the panel is an overlay pinned to the top of the chat pane rather
  // than a sibling in the flow. Inline, it took its height out of the message
  // list, so dragging the handle made the whole conversation slide up and down
  // underneath it. Out of flow the list keeps its exact height and never moves;
  // a taller panel simply covers more of the older messages. Mobile keeps the
  // inline version, where the panel is capped and the conversation sits below it.
  if (callType === "video") {
    return (
      <div className="relative z-10 w-full flex-shrink-0 border-b-4 border-ink bg-retro-yellow shadow-[0_6px_0_0_var(--color-ink)] sm:absolute sm:inset-x-0 sm:top-0 sm:z-20">
        {/* Route the remote audio to the speakers. The tiles are muted
            (see remoteTile), so without this the peer's voice is dropped
            entirely in a video call. */}
        {remoteStream && (
          <audio
            autoPlay
            playsInline
            className="pointer-events-none absolute h-0 w-0 opacity-0"
            ref={(audio) => {
              remoteAudioRef.current = audio;
              if (audio && audio.srcObject !== remoteStream)
                audio.srcObject = remoteStream;
            }}
          />
        )}
        <div
          className="relative flex w-full flex-col items-center justify-center gap-4 p-4"
          style={{ height: whiteboardHeight }}
        >
          {/*
            Mobile stacks the two tiles instead of splitting the width.
            Side by side on a phone each tile is ~50% of the screen width
            but the FULL height of the panel, so a `w-1/2` box is a narrow
            vertical sliver and `object-cover` crops the frame to a strip
            through the middle of the person. Stacked, each tile gets the
            full width, which turns that sliver back into a roughly 1.4:1
            box and crops far less.

            `sm:flex-row` plus `sm:flex-1 sm:min-w-0` put the desktop layout
            back to two equal halves. It deliberately drops the `sm:w-1/2
            sm:flex-none` pair it replaces: two non-shrinking 50% tiles plus a
            `gap-4` add up to 100% + 16px in a box that is only 100% wide, so
            the row overflowed by exactly one gap and pushed the right-hand
            tile out through the panel's padding. The yellow frame showed 16px
            on the left and 0px on the right. Letting flex distribute the space
            that is left *after* the gap (`flex-basis: 0`, `flex-grow: 1`) makes
            the two tiles share the remainder exactly, so the band is the same
            on both sides. `sm:min-w-0` stops the tiles' automatic minimum
            content width from fighting that.
          */}
          <div className="flex min-h-0 w-full flex-1 flex-col gap-4 sm:flex-row">
            {remoteTile("min-h-0 w-full flex-1 sm:h-full sm:min-w-0")}
            {localTile("min-h-0 w-full flex-1 sm:h-full sm:min-w-0")}
          </div>

          {/* Controls */}
          <div className="flex flex-shrink-0 items-center gap-3 border-[3px] border-ink bg-cream px-4 py-2 shadow-[4px_4px_0_0_var(--color-ink)]">
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
              variant={whiteboardHint && !isVisible ? "orange" : "yellow"}
              size="icon-sm"
              onClick={toggleWhiteboard}
              title={whiteboardHint ? "Peer is on the whiteboard" : "Whiteboard"}
              className={classNames(
                whiteboardHint && !isVisible ? "animate-pulse" : "",
              )}
            >
              <PencilSquareIcon className="h-5 w-5" />
            </Button>
            <Button variant="red" size="icon-sm" onClick={endCall}>
              <PhoneXMarkIcon className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Drag handle to resize video call height */}
        <div
          onMouseDown={onDragStart}
          className="flex h-5 flex-shrink-0 cursor-ns-resize items-center justify-center border-t-2 border-ink bg-cream transition-colors hover:bg-retro-yellow"
          title="Drag to resize"
        >
          <div className="flex gap-1">
            <span className="h-1 w-1 rounded-full bg-ink/40" />
            <span className="h-1 w-1 rounded-full bg-ink/40" />
            <span className="h-1 w-1 rounded-full bg-ink/40" />
          </div>
        </div>

        {/* Full-screen whiteboard overlay — always mounted (for socket listeners),
            visibility toggled via CSS so strokes are never lost. */}
        {createPortal(
            <div
              // `max()` so the desktop value stays exactly the 1rem it already
              // had, while a phone with a home indicator reserves room for it.
              className="fixed inset-0 z-50 flex flex-col bg-ink p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
              style={{ display: isVisible ? "flex" : "none" }}
            >
              <div className="mb-4 flex flex-shrink-0 items-center justify-between">
                <span className="w-10" />
                <div className="neo-sm flex items-center gap-2 bg-retro-yellow px-4 py-2">
                  <span className="inline-flex gap-1">
                    <span className="animation1 h-2 w-2 rounded-full bg-retro-red" />
                    <span className="animation2 h-2 w-2 rounded-full bg-retro-orange" />
                    <span className="animation3 h-2 w-2 rounded-full bg-retro-red" />
                  </span>
                  <p className="text-sm font-extrabold uppercase tracking-wide text-ink">
                    Whiteboard
                  </p>
                </div>
                <button
                  onClick={toggleWhiteboard}
                  className="neo-sm neo-press rounded-sm bg-paper p-2 text-ink hover:bg-retro-orange hover:text-paper"
                  title="Back to call"
                >
                  <ArrowsPointingInIcon className="h-5 w-5" />
                </button>
              </div>

              {/* On a phone the 288px strip left the whiteboard 39px wide, so
                  below `sm` the tiles go into a horizontal row on top and the
                  whiteboard takes the full width underneath. The `sm:` classes
                  reproduce the desktop split exactly. */}
              <div className="flex min-h-0 flex-1 flex-col gap-3 sm:flex-row sm:gap-4">
                {/* Whiteboard */}
                <div className="min-h-0 flex-1 overflow-hidden rounded-xl border-4 border-ink bg-paper">
                  <Whiteboard chatId={chatId} onClose={toggleWhiteboard} />
                </div>

                {/* Participants strip (the call keeps running) */}
                <div className="flex h-24 flex-shrink-0 flex-row gap-3 sm:h-auto sm:w-72 sm:flex-col sm:gap-4">
                  {remoteTile(
                    "h-full w-32 min-h-0 flex-shrink-0 sm:flex-1 sm:h-auto sm:w-full",
                  )}
                  {localTile(
                    "h-full w-32 min-h-0 flex-shrink-0 sm:flex-1 sm:h-auto sm:w-full",
                  )}
                </div>
              </div>

              {/* Controls bar */}
              <div className="mt-4 flex flex-shrink-0 items-center justify-center gap-4">
                <button
                  onClick={toggleMute}
                  className={classNames(
                    "neo-sm neo-press rounded-full p-3 transition",
                    isMuted
                      ? "bg-retro-red text-paper"
                      : "bg-paper text-ink hover:bg-retro-yellow",
                  )}
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  <MicrophoneIcon className="h-6 w-6" />
                </button>
                <button
                  onClick={toggleVideo}
                  className={classNames(
                    "neo-sm neo-press rounded-full p-3 transition",
                    !isVideoEnabled
                      ? "bg-retro-red text-paper"
                      : "bg-paper text-ink hover:bg-retro-yellow",
                  )}
                  title={isVideoEnabled ? "Turn camera off" : "Turn camera on"}
                >
                  {isVideoEnabled ? (
                    <VideoCameraIcon className="h-6 w-6" />
                  ) : (
                    <VideoCameraSlashIcon className="h-6 w-6" />
                  )}
                </button>
                <button
                  onClick={endCall}
                  className="neo-sm neo-press rounded-full bg-retro-red p-3 text-paper transition hover:bg-ink"
                  title="End call"
                >
                  <PhoneXMarkIcon className="h-6 w-6" />
                </button>
              </div>
            </div>,
            document.body,
          )}
      </div>
    );
  }

  // Audio call: whiteboard always mounted (hidden via CSS), toggled by user.
  //
  // `sm:absolute` for the same reason as the video panel: inline, the drag
  // handle resized the board out of the message list's height and the
  // conversation visibly jumped on every pixel of the drag.
  return (
    <div className="relative z-10 w-full flex-shrink-0 border-b-4 border-ink bg-retro-yellow shadow-[0_6px_0_0_var(--color-ink)] sm:absolute sm:inset-x-0 sm:top-0 sm:z-20">
      {/* Route the remote audio to the speakers */}
      {remoteStream && (
        <audio
          autoPlay
          playsInline
          className="pointer-events-none absolute h-0 w-0 opacity-0"
          ref={(audio) => {
            if (audio && audio.srcObject !== remoteStream)
              audio.srcObject = remoteStream;
          }}
        />
      )}

      {/* Always-mounted whiteboard panel — hidden via CSS when not visible
          so socket listeners stay active and strokes are never lost. */}
      <div
        // A 400px panel left no room for the conversation on a phone — header
        // plus panel plus composer filled the screen, so there was nothing to
        // read or type into. Capping at 45vh keeps a usable slice of messages
        // below the board; `sm:max-h-none` leaves the desktop panel alone, and
        // the drag handle still resizes it either way.
        className="flex max-h-[45vh] w-full flex-col gap-0 sm:max-h-none"
        style={{
          display: isVisible ? "flex" : "none",
          height: whiteboardHeight,
        }}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-0 sm:flex-row">
          {/* Whiteboard panel — first on mobile so the board gets the full
              width; `sm:order-2` slots it back between avatars and controls. */}
          <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col sm:order-2">
            <Whiteboard
              chatId={chatId}
              onClose={() => setIsVisible(false)}
            />
          </div>

          {/* Faces and controls share a row on mobile. `sm:contents` removes
              this wrapper on desktop so both become plain flex items of the row
              above, leaving that layout byte-identical.

              `border-t-4` draws the rule that separates the board from the faces
              below it on a phone, where the board is stacked on top and this
              row sits under it. On desktop the same rule is drawn by the
              absolute children inside the avatars column and the control strip,
              level with the toolbar's own underline.

              `sm:border-t-0` is a guard, not tidying. `sm:contents` generates no
              box, so this border would not paint on desktop anyway — but that
              safety currently rests on a subtlety. Stating it explicitly means
              that if `sm:contents` is ever swapped for a real box, this rule
              cannot silently reappear on desktop. */}
          <div className="order-2 flex min-h-0 flex-row border-t-4 border-ink sm:contents sm:border-t-0">
            {/* Avatars — a horizontal pair on mobile, the original column from
                `sm` up. The 192px column left the board ~127px wide on a phone.
                `sm:flex-none` restores `flex: 0 0 auto`: the mobile `flex-1`
                would otherwise set `flex-basis: 0%`, which overrides `w-48`
                and lets this column grow into the board.

                The absolute child continues the board's toolbar underline
                across this column, so the rule runs the full width of the
                panel instead of stopping at the board's edges. Absolute rather
                than a spacer so `justify-center` still centres the avatars.
                h-12 matches the toolbar's pinned height. */}
            <div className="relative flex min-w-0 flex-1 items-center justify-center gap-4 border-r-4 border-ink p-2 sm:w-48 sm:flex-none sm:flex-col sm:gap-4 sm:p-3">
              <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-12 border-b-4 border-ink sm:block" />
              {/* Remote */}
              <div className="flex min-w-0 items-center gap-2 sm:contents">
                <div
                  className={classNames(
                    "relative rounded-full transition-transform duration-150",
                    remoteSpeaking ? "scale-110" : "",
                  )}
                >
                  {avatarFailed || !remoteAvatar ? (
                    <div className="neo flex h-16 w-16 items-center justify-center rounded-full bg-cream">
                      <UserCircleIcon className="h-12 w-12 text-ink" />
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
                          "relative h-16 w-16 rounded-full object-cover ring-[3px]",
                          remoteSpeaking ? "ring-retro-orange" : "ring-ink",
                        )}
                      />
                    </>
                  )}
                </div>
                <p className="max-w-24 truncate text-center text-[10px] font-extrabold uppercase tracking-wider text-ink">
                  {remoteName || "..."}
                </p>
              </div>

              {/* Local */}
              <div className="flex min-w-0 items-center gap-2 sm:contents">
                <div
                  className={classNames(
                    "relative rounded-full transition-transform duration-150",
                    localSpeaking ? "scale-110" : "",
                  )}
                >
                  {localAvatarFailed || !localAvatar ? (
                    <div className="neo flex h-16 w-16 items-center justify-center rounded-full bg-cream">
                      <UserCircleIcon className="h-12 w-12 text-ink" />
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
                          "relative h-16 w-16 rounded-full object-cover ring-[3px]",
                          localSpeaking ? "ring-retro-orange" : "ring-ink",
                        )}
                      />
                    </>
                  )}
                </div>
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-ink">
                  You{isMuted ? " (Muted)" : ""}
                </p>
              </div>
            </div>

            {/* Controls strip. The avatars' right border separates them on mobile,
                so the left border is only needed in the desktop column layout.
                The absolute child continues the toolbar underline across this
                strip too, completing the rule. */}
            <div className="relative flex w-14 flex-shrink-0 flex-col items-center justify-center gap-3 bg-cream p-2 sm:border-l-4 sm:border-ink">
              <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-12 border-b-4 border-ink sm:block" />
              <button
                onClick={toggleMute}
                className={classNames(
                  "neo-sm neo-press rounded-full p-2 transition",
                  isMuted
                    ? "bg-retro-red text-paper"
                    : "bg-paper text-ink hover:bg-retro-yellow",
                )}
                title={isMuted ? "Unmute" : "Mute"}
              >
                <MicrophoneIcon className="h-4 w-4" />
              </button>
              <button
                onClick={toggleWhiteboard}
                className="neo-sm neo-press rounded-full bg-retro-yellow p-2 text-ink transition hover:bg-retro-orange hover:text-paper"
                title="Close whiteboard"
              >
                <ArrowsPointingInIcon className="h-4 w-4" />
              </button>
              <button
                onClick={endCall}
                className="neo-sm neo-press rounded-full bg-retro-red p-2 text-paper transition hover:bg-ink"
                title="End call"
              >
                <PhoneXMarkIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Drag handle to resize whiteboard height */}
        <div
          onMouseDown={onDragStart}
          className="flex h-5 flex-shrink-0 cursor-ns-resize items-center justify-center border-t-2 border-ink bg-cream transition-colors hover:bg-retro-yellow"
          title="Drag to resize"
        >
          <div className="flex gap-1">
            <span className="h-1 w-1 rounded-full bg-ink/40" />
            <span className="h-1 w-1 rounded-full bg-ink/40" />
            <span className="h-1 w-1 rounded-full bg-ink/40" />
          </div>
        </div>
      </div>

      {/* Normal audio call bar — hidden when whiteboard is visible */}
      <div
        className="relative flex w-full flex-col items-center justify-center gap-3 p-4"
        style={{
          display: isVisible ? "none" : "flex",
          height: 256,
        }}
      >
        <p className="neo bg-ink px-4 py-1 text-sm font-extrabold uppercase tracking-widest text-retro-yellow">
          Voice Call
        </p>

        {/* Both participants side by side */}
        <div className="flex items-center justify-center gap-10">
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
          {whiteboardButton}
          <Button variant="red" size="icon" onClick={endCall} title="End Call">
            <PhoneXMarkIcon className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CallModal;