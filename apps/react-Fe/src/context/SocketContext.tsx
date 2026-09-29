import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import socketio, { type Socket } from "socket.io-client";
import { LocalStorage } from "../utils";
import { useAuth } from "./AuthContext";

type AppSocket = ReturnType<typeof socketio>;

// Function to establish a socket connection with authorization token
const getSocket = (token?: string | null) => {
  const authToken = token ?? LocalStorage.get("token");
  const socketURI = import.meta.env.VITE_SOCKET_URI;
  if (!socketURI) {
    console.error("[socket] VITE_SOCKET_URI is missing from the environment.");
  }
  return socketio(socketURI, {
    withCredentials: true,
    auth: { token: authToken },
  });
};

interface SocketContextValue {
  /**
   * The live socket, or `null` when there's no auth token.
   *
   * Deliberately derived with `useMemo` rather than stored in state behind a
   * `useEffect`: the old version left `socket` null for the first render
   * after login, so anything running on mount raced the effect and saw no
   * socket. Deriving it makes the instance available immediately.
   */
  socket: AppSocket | null;
  /** True once the socket has completed its handshake with the server. */
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  isConnected: false,
});
const useSocket = () => useContext(SocketContext);

const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { token } = useAuth();
  const [isConnected, setIsConnected] = useState(false);

  // Only connect when there is a token ... otherwise the backend rejects the
  // handshake and the socketError handler below would reload the page in a loop.
  const socket = useMemo<AppSocket | null>(
    () => (token ? getSocket(token) : null),
    [token],
  );

  // Track the connection state so consumers can wait for the handshake rather
  // than guessing (or showing the user a "socket not available" toast).
  useEffect(() => {
    if (!socket) {
      setIsConnected(false);
      return;
    }

    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);

    setIsConnected(socket.connected);
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [socket]);

  // Tear the connection down when the token changes or we unmount.
  useEffect(() => {
    if (!socket) return;
    return () => {
      try {
        socket.removeAllListeners();
        socket.disconnect();
      } catch {
        /* already torn down */
      }
    };
  }, [socket]);

  // socketError => hard logout + redirect to /login
  useEffect(() => {
    if (!socket) return;
    const handleSocketError = () => {
      if (!token) return;
      LocalStorage.clear();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    };
    socket.on("socketError", handleSocketError);
    return () => {
      socket.off("socketError", handleSocketError);
    };
  }, [socket, token]);

  const value = useMemo<SocketContextValue>(
    () => ({ socket, isConnected }),
    [socket, isConnected],
  );

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
};

export { SocketProvider, useSocket };
export type { AppSocket };
