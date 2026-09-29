import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { AuthProvider } from "./context/AuthContext.tsx";
import { BrowserRouter } from "react-router-dom";
import { SocketProvider } from "./context/SocketContext.tsx";
import { WebRTCProvider } from "./context/WebRTCContext.tsx";
import { GroupCallProvider } from "./context/GroupCallContext.tsx";
import { ThemeProvider } from "./context/ThemeContext.tsx";
import ChatToaster from "./components/ChatToaster.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <SocketProvider>
            <WebRTCProvider>
              <GroupCallProvider>
                <App />
                <ChatToaster />
              </GroupCallProvider>
            </WebRTCProvider>
          </SocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
