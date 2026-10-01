// Import necessary modules and utilities
import axios, {
  type AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import type { ChatListItemInterface, ChatMessageInterface } from "../interfaces/chat";
import type { CompleteRecoveryResultData, FreeAPISuccessResponseInterface, LoginResponseData, RecoveryCodeResultData, RegisterResultData, ResendCodeResultData, VerifyEmailResultData } from "../interfaces/api";
import type { UserInterface } from "../interfaces/user";
import { LocalStorage } from "../utils";
import * as Sentry from "@sentry/react";

type ApiResponse<T> = AxiosResponse<FreeAPISuccessResponseInterface<T>>;

/**
 * Report an API failure that the UI already handles gracefully.
 *
 * Deliberately a `captureMessage`, not a `captureException`: a 401 on an expired
 * token or a 409 on a taken username is a normal, expected outcome that the app
 * recovers from and shows the user a message for. Capturing those as exceptions
 * would bury the real bugs under thousands of "errors" that are just the app
 * working.
 *
 * The line drawn is at 5xx and at transport-level failures: those mean the server
 * broke or never answered, which is exactly what nobody notices until a user
 * complains.
 */
const reportApiFailure = (error: unknown, phase: string) => {
  const axiosError = error as AxiosError;
  const status = axiosError.response?.status;

  // No response at all: DNS failure, refused connection, CORS preflight rejection,
  // or the 120s timeout. The user sees a spinner stop; nothing else records it.
  if (!status) {
    Sentry.captureMessage(`API request failed before a response (${phase})`, {
      level: "error",
      tags: { phase },
      extra: {
        url: axiosError.config?.url,
        method: axiosError.config?.method,
        timeout: axiosError.code,
      },
    });
    return;
  }

  if (status < 500) return;

  Sentry.captureMessage(`API ${status} from ${axiosError.config?.url} (${phase})`, {
    level: "error",
    tags: { phase, status: String(status) },
    extra: {
      method: axiosError.config?.method,
      url: axiosError.config?.url,
    },
  });
};

// Create an Axios instance for API requests
const apiClient = axios.create({
    baseURL: import.meta.env.VITE_SERVER_URI,
    withCredentials: true,
    timeout: 120000,
});

// A separate instance WITHOUT any interceptors, used only to refresh the access
// token. This avoids an infinite refresh loop when the access token is expired.
const refreshClient = axios.create({
    baseURL: import.meta.env.VITE_SERVER_URI,
    withCredentials: true,
    timeout: 30000,
});

// Add an interceptor to set authorization header with user token before requests
apiClient.interceptors.request.use(
    function (config) {
        // Retrieve user token from local storage
        const token = LocalStorage.get<string>("token");
        // Set authorization header with bearer token
        config.headers.Authorization = `Bearer ${token}`;
        return config;
    },
    function (error) {
        return Promise.reject(error);
    },
);

type RetryableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let isRedirectingToLogin = false;

// Clears auth state and sends the user back to the login page. Used when the
// refresh token itself has expired/been consumed so we cannot re-authenticate.
const handleUnauthorized = () => {
    if (isRedirectingToLogin) return;
    isRedirectingToLogin = true;
    LocalStorage.clear();
    if (typeof window !== "undefined") {
        window.location.href = "/login";
    }
};

// Response interceptor that transparently refreshes the access token once when
// a request fails with 401, retries the original request, and only logs the
// user out when the refresh token is also exhausted.
apiClient.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
        const originalRequest = error.config as
            | RetryableRequestConfig
            | undefined;
        const status = error.response?.status;

        // Network errors or requests without a config are terminal
        if (!status || !originalRequest) {
            reportApiFailure(error, "request");
            return Promise.reject(error);
        }

        // Never try to auto-refresh on login requests - eg. wrong credentials
        // should just surface the normal error message.
        if (originalRequest.url?.includes("/user/login")) {
            return Promise.reject(error);
        }

        // A 401: try to refresh the access token once and retry the request
        if (status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;
            try {
                const refreshResponse = await refreshClient.post(
                    "/user/refresh-token",
                    {
                        refreshToken:
                            LocalStorage.get<string>("refreshToken") ?? undefined,
                    },
                );
                const { accessToken, refreshToken } = refreshResponse.data
                    ?.data ?? {};
                if (!accessToken) {
                    throw new Error("Invalid refresh response");
                }
                LocalStorage.set("token", accessToken);
                if (refreshToken) LocalStorage.set("refreshToken", refreshToken);
                originalRequest.headers.Authorization = `Bearer ${accessToken}`;
                return apiClient(originalRequest);
            } catch (refreshError) {
                /*
                 * An expired refresh token is the normal end of a long-lived
                 * session and produces a clean 401, which `reportApiFailure`
                 * ignores. What it does catch is the refresh endpoint itself
                 * being down or unreachable — which logs the user out for a
                 * reason the UI cannot explain.
                 */
                reportApiFailure(refreshError, "token-refresh");
                // Refresh token expired/consumed -> log out and go to login
                handleUnauthorized();
                return Promise.reject(refreshError);
            }
        }

        // Another 401/403 (e.g. on the retried request) -> log out
        if (status === 401 || status === 403) {
            handleUnauthorized();
        } else {
            /*
             * 5xx only, by the time we get here: the 4xx cases are all expected
             * outcomes the UI turns into an inline field error, and reporting
             * them would bury the genuine server faults.
             */
            reportApiFailure(error, "request");
        }

        return Promise.reject(error);
    },
);

// API functions for different actions
const loginUser = (data: {
    username: string;
    password: string;
}): Promise<ApiResponse<LoginResponseData>> => {
    return apiClient.post("/user/login", data);
};

const registerUser = (data: {
    email: string;
    username: string;
    password: string;
    avatar: File | null;
}): Promise<ApiResponse<RegisterResultData>> => {
    return apiClient.post("/user/register", data, {
        headers: {
            "Content-Type": "multipart/form-data",
        },
    });
};

const verifyEmail = (data: {
    email: string;
    code: string;
}): Promise<ApiResponse<VerifyEmailResultData>> => {
    return apiClient.post("/user/verify-email", data);
};

const resendVerificationCode = (data: {
    email: string;
}): Promise<ApiResponse<ResendCodeResultData>> => {
    return apiClient.post("/user/resend-verification", data);
};

/**
 * Ask for a code that authorises changing an existing account's details.
 *
 * Unauthenticated on purpose: the user reaching this has no session — they
 * either abandoned a signup or forgot the password they signed up with. The
 * emailed code is the credential.
 */
const requestAccountRecovery = (data: {
    email: string;
}): Promise<ApiResponse<RecoveryCodeResultData>> => {
    return apiClient.post("/user/recover-account", data);
};

/**
 * Send the code back, plus whichever of password / username / avatar changed.
 *
 * Multipart because the picture is optional and has to ride along when the user
 * picked a new one; the text fields alone are enough to change a password.
 * Nothing on the account is applied unless the code is valid.
 */
const completeAccountRecovery = (data: {
    email: string;
    code: string;
    newPassword?: string;
    newUsername?: string;
    avatar?: File | null;
}): Promise<ApiResponse<CompleteRecoveryResultData>> => {
    return apiClient.post("/user/recover-account/complete", data, {
        headers: {
            "Content-Type": "multipart/form-data",
        },
    });
};

const logoutUser = (): Promise<ApiResponse<LoginResponseData>> => {
    return apiClient.post("/user/logout");
};

const getAvailableUsers = (): Promise<ApiResponse<UserInterface[]>> => {
    return apiClient.get("/chats/users");
};

const getUserChats = (): Promise<ApiResponse<ChatListItemInterface[]>> => {
    return apiClient.get(`/chats`);
};

const createUserChat = (
    receiverId: string,
): Promise<ApiResponse<ChatListItemInterface>> => {
    return apiClient.post(`/chats/c/${receiverId}`);
};

const createGroupChat = (data: {
    name: string;
    participants: string[];
}): Promise<ApiResponse<ChatListItemInterface>> => {
    return apiClient.post(`/chats/group`, data);
};

const getGroupInfo = (
    chatId: string,
): Promise<ApiResponse<ChatListItemInterface>> => {
    return apiClient.get(`/chats/group/${chatId}`);
};

const updateGroupName = (
    chatId: string,
    name: string,
): Promise<ApiResponse<ChatListItemInterface>> => {
    return apiClient.patch(`/chats/group/${chatId}`, { name });
};

const deleteGroup = (chatId: string): Promise<ApiResponse<ChatListItemInterface>> => {
    return apiClient.delete(`/chats/group/${chatId}`);
};

const deleteOneOnOneChat = (
    chatId: string,
): Promise<ApiResponse<ChatListItemInterface>> => {
    return apiClient.delete(`/chats/remove/${chatId}`);
};

const addParticipantToGroup = (
    chatId: string,
    participantId: string,
): Promise<ApiResponse<ChatListItemInterface>> => {
    return apiClient.post(`/chats/group/${chatId}/${participantId}`);
};

const removeParticipantFromGroup = (
    chatId: string,
    participantId: string,
): Promise<ApiResponse<ChatListItemInterface>> => {
    return apiClient.delete(`/chats/group/${chatId}/${participantId}`);
};

const getChatMessages = (
    chatId: string,
): Promise<ApiResponse<ChatMessageInterface[]>> => {
    return apiClient.get(`/messages/${chatId}`);
};

const sendMessage = (
    chatId: string,
    content: string,
    attachments: File[],
): Promise<ApiResponse<ChatMessageInterface>> => {
    const formData = new FormData();
    if (content) {
        formData.append("content", content);
    }
    attachments?.map((file) => {
        formData.append("attachments", file);
    });
    return apiClient.post(`/messages/${chatId}`, formData);
};

const deleteMessage = (
    chatId: string,
    messageId: string,
): Promise<ApiResponse<ChatMessageInterface>> => {
    return apiClient.delete(`/messages/${chatId}/${messageId}`);
};

/**
 * Add, change or remove a reaction.
 *
 * One endpoint for all three: the server decides based on what this user
 * already reacted with, so the client doesn't have to duplicate the toggle
 * rules. The response carries the full reaction list, which the caller
 * applies to its own copy of the message.
 */
const reactToMessage = (
    chatId: string,
    messageId: string,
    emoji: string,
): Promise<ApiResponse<{ messageId: string; reactions: ChatMessageInterface["reactions"]; myReaction: string | null }>> => {
    return apiClient.put(`/messages/${chatId}/${messageId}/reaction`, { emoji });
};

const getWhiteboard = (
    chatId: string,
): Promise<ApiResponse<{ whiteboard: { elements?: unknown[]; appState?: unknown } }>> => {
    return apiClient.get(`/chats/whiteboard/${chatId}`);
};

const saveWhiteboardState = (
    chatId: string,
    data: { elements: unknown[]; appState?: unknown },
): Promise<ApiResponse<{ whiteboard: { elements?: unknown[]; appState?: unknown } }>> => {
    return apiClient.put(`/chats/whiteboard/${chatId}`, data);
};

// Export all the API functions
export {
    addParticipantToGroup,
    completeAccountRecovery,
    createGroupChat,
    createUserChat,
    deleteGroup,
    deleteMessage,
    deleteOneOnOneChat,
    getAvailableUsers,
    getChatMessages,
    getGroupInfo,
    getUserChats,
    getWhiteboard,
    loginUser,
    logoutUser,
    reactToMessage,
    registerUser,
    removeParticipantFromGroup,
    requestAccountRecovery,
    resendVerificationCode,
    saveWhiteboardState,
    sendMessage,
    updateGroupName,
    verifyEmail,
};