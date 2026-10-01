import { Routes, Route, Navigate } from "react-router-dom";
import { withProfiler } from "@sentry/react";
import Login from "./pages/login";
import Register from "./pages/register";
import Landing from "./pages/landing";
import Changelog from "./pages/changelog";
import ChatPage from "./pages/chat";
import { useAuth } from "./context/AuthContext";
import PrivateRoute from "./components/PrivateRoute";
import PublicRoute from "./components/PublicRoute";

/**
 * Route components wrapped in Sentry's React profiler.
 *
 * This is what makes `profilesSampleRate` in the Sentry config do anything for
 * React: the SDK ships V8 CPU profiles, but it only knows what to attribute them
 * to if the component tree is wrapped. The `id` becomes the profile's name, so
 * `threadly-chat-page` and `threadly-register-page` are directly comparable
 * instead of both being "the app".
 *
 * Wrapping the page, not the guard, is deliberate: `PrivateRoute` is three lines
 * of redirect logic and profiling it would only add noise.
 */
const ProfilerChatPage = withProfiler(ChatPage, { name: "threadly-chat-page" });
const ProfilerLoginPage = withProfiler(Login, { name: "threadly-login-page" });
const ProfilerRegisterPage = withProfiler(Register, { name: "threadly-register-page" });
const ProfilerLandingPage = withProfiler(Landing, { name: "threadly-landing-page" });
const ProfilerChangelogPage = withProfiler(Changelog, { name: "threadly-changelog-page" });

const App = () => {
  const { token, user } = useAuth();

  return (
    <Routes>
      <Route
        path="/"
        element={
          token && user?._id ? (
            <Navigate to="/chat" />
          ) : (
            <ProfilerLandingPage />
          )
        }
      ></Route>

      {/* Private chat route: Can only be accessed by authenticated users */}
      <Route
        path="/chat"
        element={
          <PrivateRoute>
            <ProfilerChatPage />
          </PrivateRoute>
        }
      />

      {/* Public login route: Accessible by everyone */}
      <Route
        path="/login"
        element={
          <PublicRoute>
            <ProfilerLoginPage />
          </PublicRoute>
        }
      />

      {/* Changelog: intentionally unguarded. `PublicRoute` bounces signed-in
          users to /chat, which would make the sidebar footer's link dead for
          exactly the people who can see it, so this route is open to both. */}
      <Route path="/changelog" element={<ProfilerChangelogPage />} />

      {/* Public register route: Accessible by everyone */}
      <Route
        path="/register"
        element={
          <PublicRoute>
            <ProfilerRegisterPage />
          </PublicRoute>
        }
      />
    </Routes>
  );
};
export default App;