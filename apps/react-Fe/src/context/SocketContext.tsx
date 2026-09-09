import React, { createContext, useContext, useEffect, useState } from "react";
import socketio from "socket.io-client";
import { LocalStorage } from "../utils";
import { useAuth } from "./AuthContext";

// Function to establish a socket connection with authorization token
const getSocket = (token?: string | null) => {
  const authToken = token ?? LocalStorage.get("token");
  // TEST: Modified AI CODE STARTS HERE
  const socketURI = import.meta.env.VITE_SOCKET_URI;
  console.log("Initializing socket...", {
    uri: socketURI,
    hasToken: !!authToken,
  });
  if (!socketURI) {
    console.error("Socket URI is missing in environment variables!");
  }
  return socketio(socketURI, {
    // TEST: ENDS HERE
    withCredentials: true,
    auth: { token: authToken },
  });
};

// Create a context to hold the socket instance
const SocketContext = createContext<{
  socket: ReturnType<typeof socketio> | null;
}>({
  socket: null,
});

// Custom hook to access the socket instance from the context
const useSocket = () => useContext(SocketContext);

// SocketProvider component to manage the socket instance and provide it through context
const SocketProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // State to store the socket instance
  const [socket, setSocket] = useState<ReturnType<typeof socketio> | null>(
    null,
  );
  const { token } = useAuth();

  // Initialize or re-initialize the socket connection when token changes.
  // Only connect when there is a token: without one (login/register page),
  // the backend rejects the handshake and the socketError handler below would
  // otherwise reload the page in an infinite loop.
  useEffect(() => {
    if (!token) {
      setSocket(null);
      return;
    }
    const newSocket = getSocket(token);
    setSocket(newSocket);
    return () => {
      try {
        newSocket.disconnect();
      } catch {
        // Ignore errors while disconnecting a stale socket
      }
    };
  }, [token]);

  // If the socket is rejected because of an invalid/expired token, log the user
  // out and redirect to the login page (same behavior as the API interceptor).
  // The redirect is skipped when there is nothing to log out of or we are
  // already on the login page to avoid reload loops.
  useEffect(() => {
    if (!socket) return;
    const handleSocketError = () => {
      if (!token) return;
      LocalStorage.clear();
      if (
        typeof window !== "undefined" &&
        window.location.pathname !== "/login"
      ) {
        window.location.href = "/login";
      }
    };
    socket.on("socketError", handleSocketError);
    return () => {
      socket.off("socketError", handleSocketError);
    };
  }, [socket, token]);

  return (
    // Provide the socket instance through context to its children
    <SocketContext.Provider value={{ socket }}>
      {children}
    </SocketContext.Provider>
  );
};

export { SocketProvider, useSocket };
