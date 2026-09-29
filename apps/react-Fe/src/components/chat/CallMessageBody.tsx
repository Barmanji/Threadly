import {
    PhoneIcon,
    PhoneXMarkIcon,
    VideoCameraIcon,
} from "@heroicons/react/20/solid";
import type { CallInfoInterface } from "../../interfaces/chat";
import { classNames, formatDuration } from "../../utils";

/** "Video call", "Missed voice call", "Group video call cancelled", ... */
const describe = (call: CallInfoInterface) => {
    const medium = call.callType === "video" ? "video" : "voice";
    switch (call.status) {
        case "completed":
            return `${medium === "video" ? "Video" : "Voice"} call`;
        case "missed":
            return `Missed ${medium} call`;
        case "rejected":
            return `Declined ${medium} call`;
        case "cancelled":
            return `${call.isGroup ? "Group " : ""}${medium} call cancelled`;
    }
};

/**
 * The pill shown instead of a paragraph for a server-generated call log.
 *
 * Rendered from the structured `call` payload rather than the stored
 * `content` string, so the wording lives in one place and the bubble can show
 * an icon and the duration as separate elements.
 */
const CallMessageBody: React.FC<{ call: CallInfoInterface }> = ({ call }) => {
    const wentThrough = call.status === "completed";
    const Icon = wentThrough
        ? call.callType === "video"
            ? VideoCameraIcon
            : PhoneIcon
        : PhoneXMarkIcon;

    return (
        <div className="flex items-center gap-3 py-0.5">
            <span
                className={classNames(
                    "flex h-9 w-9 flex-shrink-0 items-center justify-center border-2 border-ink",
                    wentThrough ? "bg-retro-green" : "bg-retro-red",
                )}
            >
                <Icon className="h-4 w-4 text-ink" />
            </span>
            <span className="flex min-w-0 flex-col leading-tight">
                <span className="text-sm font-bold text-ink">
                    {describe(call)}
                </span>
                {wentThrough && call.durationSeconds > 0 ? (
                    <span className="text-xs font-semibold tabular-nums text-ink/70">
                        {formatDuration(call.durationSeconds)}
                    </span>
                ) : null}
            </span>
        </div>
    );
};

export default CallMessageBody;
