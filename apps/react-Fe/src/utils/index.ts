import type { AxiosResponse } from "axios";
import type {
  ApiFieldErrorInterface,
  FreeAPISuccessResponseInterface,
} from "../interfaces/api";
import type { ChatListItemInterface } from "../interfaces/chat";
import type { UserInterface } from "../interfaces/user";

/**
 * A normalised API failure.
 *
 * The backend always replies with a JSON body shaped like
 * `{ statusCode, success, message, code, errors, data }`, so this can always
 * produce a message worth showing to a human instead of a generic
 * "Something went wrong".
 */
export interface ApiFailure {
  message: string;
  statusCode: number;
  code: string;
  /** Per-field problems, e.g. `{ path: "email", message: "Invalid email" }`. */
  fieldErrors: ApiFieldErrorInterface[];
  /** True when the request never reached the server. */
  isNetworkError: boolean;
}

/**
 * Partially mask an address, mirroring the server's `maskEmail` in
 * `emailVerification.service.ts`.
 *
 * Needed client-side only where the server has nothing to mask for us:
 * `POST /user/resend-verification` echoes no address back, but the UI still
 * wants to show which one a code was just sent to. Display only — if the two
 * implementations ever drift the worst case is a cosmetic difference.
 */
export const maskEmail = (email: string): string => {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"*".repeat(
    Math.max(3, local.length - visible.length),
  )}@${domain}`;
};

/** Turn an axios rejection into an `ApiFailure` with a usable message. */
export const toApiFailure = (error: unknown): ApiFailure => {
  const fallback = (message: string, statusCode = 0, isNetworkError = false): ApiFailure => ({
    message,
    statusCode,
    code: isNetworkError ? "NETWORK_ERROR" : "UNKNOWN",
    fieldErrors: [],
    isNetworkError,
  });

  // Deliberately loose rather than `AxiosError`: this function is also handed
  // a synthesised `{ response: { data } }` from `requestHandler`, which is
  // not a real axios error.
  const err = error as {
    response?: {
      data?: Partial<FreeAPISuccessResponseInterface> & { errors?: unknown };
      status?: number;
    };
    message?: string;
    code?: string;
  };

  const data = err?.response?.data;

  // A JSON error body from our own API — the happy path for surfacing errors.
  if (data && typeof data === "object" && typeof data.message === "string") {
    const fieldErrors: ApiFieldErrorInterface[] = Array.isArray(data.errors)
      ? (data.errors as ApiFieldErrorInterface[]).filter(
          (e) => e && typeof e.path === "string" && typeof e.message === "string",
        )
      : [];

    return {
      // Prefer a field-level message when one is available: it is far more
      // actionable than a generic headline.
      message: fieldErrors[0]?.message || data.message,
      statusCode: typeof data.statusCode === "number" ? data.statusCode : err?.response?.status ?? 0,
      code: typeof data.code === "string" ? data.code : "UNKNOWN",
      fieldErrors,
      isNetworkError: false,
    };
  }

  // No response at all: offline, DNS failure, CORS, or a timeout.
  if (!err?.response) {
    if (err?.code === "ECONNABORTED") {
      return fallback("The server took too long to respond. Please try again.");
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return fallback("You appear to be offline. Check your connection and try again.", 0, true);
    }
    return fallback(
      "Couldn't reach the server. Please check your connection and try again.",
      0,
      true,
    );
  }

  // A response that wasn't our JSON error shape (proxy/gateway HTML, etc).
  return fallback(
    err?.message || "Something went wrong. Please try again.",
    err?.response?.status ?? 0,
  );
};

/**
 * Shared request wrapper.
 *
 * `onError` still receives a plain string so existing call sites keep
 * working, but the resolved value is the full `ApiFailure` (or `null` on
 * success) so callers that want to render errors inline — rather than toast
 * them — can.
 */
export const requestHandler = async <T>(
  api: () => Promise<AxiosResponse<FreeAPISuccessResponseInterface<T>>>,
  setLoading: ((loading: boolean) => void) | null,
  onSuccess: (data: FreeAPISuccessResponseInterface<T>) => void,
  onError: (error: string) => void
): Promise<ApiFailure | null> => {
  // Show loading state if setLoading function is provided
  if (setLoading) setLoading(true);
  try {
    // Make the API request
    const response = await api();
    const { data } = response;
    if (data?.success) {
      // Call the onSuccess callback with the response data
      onSuccess(data);
    } else {
      // A 2xx that still reports `success: false` is still a failure.
      const failure = toApiFailure({ response: { data } });
      onError(failure.message);
      return failure;
    }
    return null;
  } catch (error: unknown) {
    // Handle error cases. 401/403 (token expiry / auth failure) are already
    // handled centrally by the axios interceptor in api/index.ts, which logs
    // the user out and redirects to the login page when the tokens are exhausted.
    const failure = toApiFailure(error);
    onError(failure.message);
    return failure;
  } finally {
    // Hide loading state if setLoading function is provided
    if (setLoading) setLoading(false);
  }
};

// A utility function to concatenate CSS class names with proper spacing
export const classNames = (...className: string[]) => {
  // Filter out any empty class names and join them with a space
  return className.filter(Boolean).join(" ");
};

// Check if the code is running in a browser environment
export const isBrowser = typeof window !== "undefined";

// Classify an attachment so the UI can pick the right rendering. For files
// uploaded before the mimetype was stored, fall back to the URL extension.
export const getFileKind = (
  url?: string,
  mimetype?: string,
): "image" | "video" | "pdf" | "file" => {
  const mime = (mimetype ?? "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime === "application/pdf") return "pdf";
  const rawExt = (url ?? "").split("?")[0].split(".").pop() ?? "";
  const ext = rawExt.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "avif"].includes(ext))
    return "image";
  if (["mp4", "webm", "mov", "ogg", "mkv"].includes(ext)) return "video";
  if (ext === "pdf") return "pdf";
  return "file";
};

export const formatBytes = (bytes?: number) => {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

/**
 * "45s", "2m 05s", "1h 03m" — how a phone shows a call duration.
 * Clamped at zero so a clock skew between client and server can't render a
 * negative duration.
 */
export const formatDuration = (seconds?: number) => {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60)
    return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
};

// Real download instead of an <a download> link. The download attribute is
// ignored for cross-origin resources (e.g. Cloudinary), which makes the
// browser navigate to the object-storage page instead of downloading. We
// proxy the file through the backend (which sets Content-Disposition:
// attachment) and download the resulting blob from our own origin.
export const downloadFile = async (url: string, fileName?: string) => {
  const token = LocalStorage.get<string>("token");
  const apiUri = (import.meta.env.VITE_SERVER_URI as string | undefined) ?? "";
  const name = fileName || url.split("?")[0].split("/").pop() || "download";
  const params = new URLSearchParams({ url, filename: name });
  // VITE_SERVER_URI already ends with "/api/v1" (same base the axios client
  // uses), so only append the route, otherwise the path gets duplicated.
  const proxyUrl = `${apiUri.replace(/\/+$/, "")}/messages/attachments/download?${params.toString()}`;

  try {
    const response = await fetch(proxyUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    console.info("[download] status", response.status, "bytes-will-be", response.headers.get("content-length"));
    if (!response.ok) throw new Error("bad response");
    const blob = await response.blob();
    console.info("[download] blob size", blob.size, "type", blob.type);
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Last resort: open the storage URL in a new tab so the chat page isn't
    // lost.
    window.open(url, "_blank", "noopener,noreferrer");
  }
};

// This utility function generates metadata for chat objects.
// It takes into consideration both group chats and individual chats.
export const getChatObjectMetadata = (
  chat: ChatListItemInterface, // The chat item for which metadata is being generated.
  loggedInUser: UserInterface // The currently logged-in user details.
) => {
  // Determine the content of the last message, if any.
  // If the last message contains only attachments, indicate their count.
  const lastMessage = chat.lastMessage?.content
    ? chat.lastMessage?.content
    : chat.lastMessage
    ? `${chat.lastMessage?.attachments?.length} attachment${
        chat.lastMessage.attachments.length > 1 ? "s" : ""
      }`
    : "No messages yet"; // Placeholder text if there are no messages.

  if (chat.isGroupChat) {
    // Case: Group chat
    // Return metadata specific to group chats.
    return {
      // Default avatar for group chats.
      avatar: "https://w.wallhaven.cc/full/1p/wallhaven-1p5z71.jpg",
      title: chat.name, // Group name serves as the title.
      description: `${chat.participants.length} members in the chat`, // Description indicates the number of members.
      lastMessage: chat.lastMessage
        ? chat.lastMessage?.sender?.username + ": " + lastMessage
        : lastMessage,
    };
  } else {
    // Case: Individual chat
    // Identify the participant other than the logged-in user.
    const participant = chat.participants.find(
      (p) => p._id !== loggedInUser?._id
    );
    // Return metadata specific to individual chats.
    return {
      avatar: participant?.avatar, // Participant's avatar URL.
      title: participant?.username, // Participant's username serves as the title.
      description: participant?.email, // Email address of the participant.
      lastMessage,
    };
  }
};

// A class that provides utility functions for working with local storage
export class LocalStorage {
  /**
   * Get a value from local storage by key.
   *
   * Generic so callers get a typed value instead of `any` — everything read
   * back here is JSON parsed from a string, so the type is only ever an
   * assertion, but it still catches wrong-shaped reads at the call site.
   * Returns `null` for a missing key, an unparseable value, or SSR.
   */
  static get<T = unknown>(key: string): T | null {
    if (!isBrowser) return null;
    const value = localStorage.getItem(key);
    if (value) {
      try {
        return JSON.parse(value) as T;
      } catch {
        return null;
      }
    }
    return null;
  }

  // Set a value in local storage by key
  static set<T>(key: string, value: T) {
    if (!isBrowser) return;
    localStorage.setItem(key, JSON.stringify(value));
  }

  // Remove a value from local storage by key
  static remove(key: string) {
    if (!isBrowser) return;
    localStorage.removeItem(key);
  }

  // Clear all items from local storage
  static clear() {
    if (!isBrowser) return;
    localStorage.clear();
  }
}
