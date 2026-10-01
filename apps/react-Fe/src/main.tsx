/*
 * MUST stay first. ES module imports evaluate in declaration order, so this is
 * what guarantees a throw during the evaluation of any later import below still
 * reaches Sentry. Moving it down the list silently loses that coverage.
 */
import * as Sentry from "@sentry/react";
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
import RouteTag from "./sentry/RouteTag.tsx";
import AppErrorFallback from "./sentry/AppErrorFallback.tsx";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/*
      Sentry's boundary, outermost.

      Above `StrictMode` deliberately: StrictMode re-renders children twice in
      development, which means a broken component throws twice, and a boundary
      underneath it would see the duplicate. Above it, one crash is one event.

      It also has to sit above `BrowserRouter` so a throw inside the router itself
      still has somewhere to land.
    */}
    <Sentry.ErrorBoundary fallback={<AppErrorFallback />}>
      <BrowserRouter>
        {/* Needs router context, and must stay mounted across navigations. */}
        <RouteTag />
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
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);