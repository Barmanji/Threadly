import React from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import App from "./App.tsx";
import "./index.css";
import { AuthProvider } from "./context/AuthContext.tsx";
import { BrowserRouter } from "react-router-dom";
import { SocketProvider } from "./context/SocketContext.tsx";
import { WebRTCProvider } from "./context/WebRTCContext.tsx";
import { GroupCallProvider } from "./context/GroupCallContext.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SocketProvider>
          <WebRTCProvider>
            <GroupCallProvider>
              <App />
              <Toaster
                position="top-center"
                style={{
                  left: "66.67%",
                  transform: "translateX(-50%)",
                }}
                toastOptions={{
                  className:
                    "neo-sm border-ink! bg-cream! text-ink! font-semibold",
                }}
              />
            </GroupCallProvider>
          </WebRTCProvider>
        </SocketProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
