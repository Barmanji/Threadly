import * as Sentry from "@sentry/react";

/**
 * What the user sees when a render throws and `Sentry.ErrorBoundary` catches it.
 *
 * Sentry captures the exception before this renders, so this component's only
 * jobs are (a) not lose the stack, and (b) give the user a way out. It must
 * never throw itself — a boundary that crashes is an infinite loop.
 *
 * It deliberately does NOT offer "copy details" or show a raw stack: the app
 * ships real user data through its context and a stack can embed component
 * props. "Report this" is enough, and the replay behind the event carries the
 * detail for us.
 */
const AppErrorFallback: React.FC = () => {
  /*
   * `flush` is the safety net. By the time the boundary renders, `captureException`
   * has already been queued, so this usually resolves immediately — it matters
   * when the crash happens during unload, where the queued event would otherwise
   * be dropped with the page.
   */
  const report = () => {
    void Sentry.flush(2000).then(() => {
      window.location.href = "/login";
    });
  };

  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-6 bg-doodle px-4 py-10">
      <div className="neo flex w-full max-w-md flex-col items-center gap-5 bg-retro-orange p-8">
        <h1 className="neo-sm flex items-center bg-cream px-6 py-2 text-center text-2xl">
          Something broke
        </h1>

        <p className="text-center text-sm font-semibold leading-relaxed text-ink">
          The app hit an error it could not recover from. The details have been
          reported — nothing you typed was lost.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="neo neo-press bg-retro-green px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-ink"
          >
            Reload
          </button>

          <button
            type="button"
            onClick={report}
            className="neo neo-press bg-retro-yellow px-6 py-3 text-sm font-extrabold uppercase tracking-wide text-ink"
          >
            Back to login
          </button>
        </div>
      </div>
    </div>
  );
};

export default AppErrorFallback;