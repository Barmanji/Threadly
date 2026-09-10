// Import necessary modules and utilities
import axios, {
  type AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import type { ChatListItemInterface, ChatMessageInterface } from "../interfaces/chat";
import type { FreeAPISuccessResponseInterface, LoginResponseData } from "../interfaces/api";
import type { UserInterface } from "../interfaces/user";
import { LocalStorage } from "../utils";

type ApiResponse<T> = AxiosResponse<FreeAPISuccessResponseInterface<T>>;

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
        const token = LocalStorage.get("token");
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
                            LocalStorage.get("refreshToken") ?? undefined,
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
                // Refresh token expired/consumed -> log out and go to login
                handleUnauthorized();
                return Promise.reject(refreshError);
            }
        }

        // Another 401/403 (e.g. on the retried request) -> log out
        if (status === 401 || status === 403) {
            handleUnauthorized();
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
}): Promise<ApiResponse<LoginResponseData>> => {
    return apiClient.post("/user/register", data, {
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
    registerUser,
    removeParticipantFromGroup,
    saveWhiteboardState,
    sendMessage,
    updateGroupName,
};