import { useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/20/solid";
import { useAuth } from "../context/AuthContext";
import ThemeToggle from "../components/ThemeToggle";

/**
 * One themed group of changes. `ref` is the commit that introduced it, shown as
 * a badge so every claim on this page can be checked against the history rather
 * than taken on trust.
 */
type ChangelogEntry = {
  title: string;
  points: string[];
  ref: string;
  accent: string;
  onAccent: string;
};

/**
 * V2 — everything added on top of v1.
 */
const V2: ChangelogEntry[] = [
  {
    title: "Email OTP verification",
    ref: "025001c",
    accent: "bg-retro-green",
    onAccent: "text-ink",
    points: [
      "Register and login validate as you type, before the request is sent.",
      "A six-digit code is emailed through Resend and checked server-side, so a wrong code is rejected instead of silently creating an account.",
      "Server errors are surfaced in readable form rather than swallowed.",
    ],
  },
  {
    title: "Emoji reactions",
    ref: "785d695",
    accent: "bg-retro-yellow",
    onAccent: "text-ink",
    points: [
      "Tap any message to react, WhatsApp-style, with a 269-emoji picker.",
      "A toolbar follows the message on hover, and opens on long-press on touch.",
      "Tap your own reaction to take it back; long-press to see exactly who reacted.",
      "Counts stay live as other people react, re-aggregated server-side.",
      "Fixed the reaction payload being read in the wrong shape — counts and 'remove mine' were both reading undefined, so chips stayed grey and clicking one did nothing.",
    ],
  },
  {
    title: "Dark mode",
    ref: "fd6f268",
    accent: "bg-retro-blue",
    onAccent: "text-paper",
    points: [
      "Every page follows a light/dark theme, defaulting to light.",
      "The hard offset shadow is theme-aware now — hard-coding it left a black shadow in dark mode.",
      "The toggle matches the Log Out and Add chat buttons it sits beside.",
    ],
  },
  {
    title: "Mobile layout",
    ref: "e8781f5",
    accent: "bg-retro-pink",
    onAccent: "text-ink",
    points: [
      "Single-screen phone layout: the chat list and the conversation are separate screens, the way a messaging app should behave.",
      "The sidebar gets out of the way when a chat is open.",
      "On web the sidebar still resizes, but is clamped so the call buttons stay pinned to the right edge instead of being squeezed off it.",
    ],
  },
  {
    title: "Calls that actually connect",
    ref: "020473e",
    accent: "bg-retro-red",
    onAccent: "text-paper",
    points: [
      "Remote video plays. Audio was being routed through the video tiles, so muting them muted the peer along with the echo.",
      "Remote audio now has its own element; tiles are muted and stay out of the way.",
      "The call UI sits below the chat header and can never cover it.",
    ],
  },
  {
    title: "A whiteboard that works on a phone",
    ref: "29e917b",
    accent: "bg-retro-orange",
    onAccent: "text-ink",
    points: [
      "The board stacks under the video instead of squeezing itself to 143px between two columns.",
      "Chat stays readable and typeable with the call UI open — a capped board leaves the conversation below it.",
      "Dragging the resize handle no longer makes the chat jump up and down; it overlays the messages instead of resizing them.",
      "Continuous separator rules mark the board as its own surface, on phone and on web alike.",
    ],
  },
  {
    title: "Calls in the transcript",
    ref: "75879c3",
    accent: "bg-retro-green",
    onAccent: "text-ink",
    points: [
      "P2P and group calls are logged as messages, so the history of a conversation accounts for the calls that happened in it.",
    ],
  },
  {
    title: "Under the hood",
    ref: "8c507c4",
    accent: "bg-retro-blue",
    onAccent: "text-paper",
    points: [
      "API errors reach the client at all: the error middleware is mounted and 404s come back as JSON instead of HTML.",
      "No more 'socket not available' toasts or console noise.",
      "Toasts centre on whatever is actually on screen.",
      "The reaction popover no longer closes before you can reach it.",
    ],
  },
];

/**
 * V1 — the original build, for anyone who remembers it or never saw it.
 */
const V1: ChangelogEntry[] = [
  {
    title: "Accounts",
    ref: "de71e5b",
    accent: "bg-retro-yellow",
    onAccent: "text-ink",
    points: [
      "Register and log in with JWT, matched on username or email, case-insensitively.",
      "A typed request layer with a token-refresh interceptor and auth redirects.",
    ],
  },
  {
    title: "Real-time 1:1 chat",
    ref: "d080ece",
    accent: "bg-retro-green",
    onAccent: "text-ink",
    points: [
      "Socket.IO messaging with typing indicators.",
      "Optimistic pending messages and a sending flag, so a slow network doesn't look like a dropped message.",
      "Chat search.",
    ],
  },
  {
    title: "Attachments",
    ref: "466fb12",
    accent: "bg-retro-orange",
    onAccent: "text-ink",
    points: [
      "Per-type attachment cards for images, video and files.",
      "Upload via Cloudinary with a streaming download proxy, and Escape to close a preview.",
    ],
  },
  {
    title: "Peer-to-peer calls",
    ref: "1b51f05",
    accent: "bg-retro-red",
    onAccent: "text-paper",
    points: [
      "WebRTC audio and video with mute and camera toggles.",
      "Call glare resolved for simultaneous calls, remote tracks accumulated into a stable stream, and the call lifecycle hardened.",
      "Notification sounds for calls and messages.",
    ],
  },
  {
    title: "Group calls",
    ref: "a9e1dd3",
    accent: "bg-retro-blue",
    onAccent: "text-paper",
    points: [
      "MediaSoup SFU for multi-participant calls.",
      "Grid view with per-participant mute and camera controls.",
      "Invite and cancel toasts, with invitee tracking.",
    ],
  },
  {
    title: "Collaborative whiteboard",
    ref: "b1aae42",
    accent: "bg-retro-pink",
    onAccent: "text-ink",
    points: [
      "Canvas-based drawing with real-time stroke sync over the socket.",
      "Whiteboards persist server-side and open inside the call modal.",
    ],
  },
  {
    title: "Look and feel",
    ref: "11c4922",
    accent: "bg-retro-yellow",
    onAccent: "text-ink",
    points: [
      "Neo-brutalist design system restyle, and the rebrand to Threadly.",
      "Landing page with stacking cards and full-bleed feature screenshots.",
      "Resizable sidebar, and a faint doodle background behind the conversation.",
    ],
  },
];

function EntryCard({ entry }: { entry: ChangelogEntry }) {
  return (
    <li className="border-4 border-ink bg-paper">
      {/* Accent header. The badge carries the commit, so each claim on this page
          can be traced back to the history. */}
      <div
        className={`flex items-center justify-between gap-3 border-b-4 border-ink px-4 py-3 ${entry.accent}`}
      >
        <h3
          className={`text-sm font-extrabold uppercase tracking-wide sm:text-base ${entry.onAccent}`}
        >
          {entry.title}
        </h3>
        <span
          className={`neo-sm flex-shrink-0 bg-paper px-2 py-0.5 font-mono text-[10px] font-bold text-ink`}
          title="Commit that introduced this"
        >
          {entry.ref}
        </span>
      </div>
      <ul className="flex flex-col gap-2 px-4 py-4">
        {entry.points.map((point) => (
          <li key={point} className="flex gap-3 text-sm leading-relaxed text-ink">
            <span className="mt-2 h-2 w-2 flex-shrink-0 bg-ink" aria-hidden="true" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function Section({
  version,
  tagline,
  entries,
}: {
  version: string;
  tagline: string;
  entries: ChangelogEntry[];
}) {
  const isV2 = version === "V2";
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`neo flex items-center px-4 py-2 text-xl font-extrabold uppercase tracking-tight sm:text-2xl ${
            isV2 ? "bg-retro-orange text-ink" : "bg-retro-blue text-paper"
          }`}
        >
          {version}
        </span>
        <p className="text-sm font-bold uppercase tracking-wide text-ink/70">
          {tagline}
        </p>
      </div>
      <ul className="grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2">
        {entries.map((entry) => (
          <EntryCard key={entry.ref} entry={entry} />
        ))}
      </ul>
    </section>
  );
}

const Changelog: React.FC = () => {
  const navigate = useNavigate();
  const { token, user } = useAuth();

  // Signed-in users have no hero page to go back to, so send them to the chat.
  const backTo = token && user?._id ? "/chat" : "/";

  return (
    <div className="relative flex min-h-dvh flex-col bg-cream">
      <header className="border-b-4 border-ink bg-cream px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => navigate(backTo)}
          className="neo neo-press inline-flex h-11 flex-shrink-0 items-center gap-2 bg-paper px-4 text-xs font-extrabold uppercase tracking-wide text-ink sm:h-12 sm:text-sm"
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
          Back
        </button>
      </header>

      {/* Same `absolute right-4 top-4 z-20 flex items-center gap-3` row the hero,
          login and register use, so the toggle lands in the identical spot on
          every page. No ChangelogLink beside it here — this IS the changelog,
          and a link to yourself is noise. */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-3">
        <ThemeToggle />
      </div>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-12 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8">
        <div className="flex flex-col gap-3">
          <h1 className="neo w-fit -rotate-1 bg-retro-yellow px-6 py-3 text-3xl font-extrabold uppercase tracking-tight text-ink sm:text-4xl">
            Changelog
          </h1>
          <p className="max-w-2xl text-sm font-bold uppercase tracking-wide text-ink/70 sm:text-base">
            What shipped, and what it replaced. Commit references on every card.
          </p>
        </div>

        <Section
          version="V2"
          tagline={`${V2.length} groups — everything new`}
          entries={V2}
        />
        <Section
          version="V1"
          tagline={`${V1.length} groups — the original build`}
          entries={V1}
        />
      </main>
    </div>
  );
};

export default Changelog;
