import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import * as Sentry from "@sentry/react";

/**
 * Tags every Sentry event with the route the user was actually on.
 *
 * Sentry's first-class React Router integration generates parameterized route
 * names (`/chat/:chatId`), which is the ideal grouping — but it requires the
 * data-router API (`createBrowserRouter` + `RouterProvider`). This app uses the
 * declarative `<BrowserRouter>` + `<Routes>`, and migrating the router to get
 * telemetry is a much larger change than the telemetry itself.
 *
 * So this reads the pathname off `useLocation` instead. The trade-off is real and
 * worth stating: `/chat`, `/login` and `/changelog` are static and group exactly
 * as well as parameters would, but a path with an id in it (`/chats/65f...`)
 * creates one Sentry issue per id instead of one shared issue. Today every route
 * in this app is static, so there is no difference in practice.
 *
 * It sets a tag (indexed, so it is what the Issues list groups by) AND a breadcrumb
 * (so the breadcrumb trail shows the click path that led to the error, not just
 * the final URL).
 *
 * Rendered once inside `BrowserRouter` — it needs router context, and putting it
 * here rather than inside `App` keeps it mounted across every navigation.
 */
const RouteTag: React.FC = () => {
  const { pathname, search } = useLocation();

  /*
   * Held in a ref so the effect keys only on the pathname. `search` changes on
   * unrelated re-renders of the URL (pagination, filters) and would otherwise
   * add a breadcrumb for something the user did not navigate to.
   */
  const lastPathname = useRef<string | null>(null);

  useEffect(() => {
    /*
     * React 19 StrictMode double-invokes effects in development. Guarding keeps
     * one navigation from producing two identical breadcrumbs.
     */
    if (lastPathname.current === pathname) return;

    // Read the previous value BEFORE overwriting it — the first render has no
    // previous route, and logging "navigated to /chat" on a cold page load is
    // noise rather than a navigation the user performed.
    const isFirstRun = lastPathname.current === null;
    lastPathname.current = pathname;

    Sentry.setTag("route", pathname);

    if (!isFirstRun) {
      Sentry.addBreadcrumb({
        category: "navigation",
        message: `Navigated to ${pathname}`,
        data: { search },
        level: "info",
      });
    }
  }, [pathname, search]);

  return null;
};

export default RouteTag;