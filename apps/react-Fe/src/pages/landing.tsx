import { Link } from "react-router-dom";
import { Github, Linkedin, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import HeroSection from "../components/landing/HeroSection";
import { StackingCards } from "../components/landing/StackingCards";

const SOCIAL_LINKS = [
  {
    name: "GitHub",
    url: "https://github.com/barmanji",
    icon: Github,
  },
  {
    name: "LinkedIn",
    url: "https://www.linkedin.com/in/ajay-barman-0b37011a7/",
    icon: Linkedin,
  },
  {
    name: "Email",
    url: "mailto:barmanjiaj@gmail.com",
    icon: Mail,
  },
];

const FEATURES = [
  {
    title: "Instant Chat",
    description:
      "Send messages, share files, get typing indicators — all in real-time with a retro aesthetic that pops.",
    color: "bg-retro-orange",
    textColor: "text-retro-orange",
    borderColor: "border-retro-orange",
    placeholder: "bg-retro-orange/10",
    image: "/InstantChat.png",
  },
  {
    title: "Video & Audio Calls",
    description:
      "Jump into face-to-face conversations with resizable whiteboard support. Crystal clear, zero lag.",
    color: "bg-retro-blue",
    textColor: "text-retro-blue",
    borderColor: "border-retro-blue",
    placeholder: "bg-retro-blue/10",
    image: "/videoCall.png",
  },
  {
    title: "Group Calls",
    description:
      "SFU-powered multi-participant calls with grid view, mute controls, and camera toggles. Everyone's invited.",
    color: "bg-retro-green",
    textColor: "text-retro-green",
    borderColor: "border-retro-green",
    placeholder: "bg-retro-green/10",
    image: "/GroupCall.png",
  },
  {
    title: "Collaborative Whiteboard",
    description:
      "Draw, sketch, and brainstorm together with real-time stroke sync. Your ideas, persisted forever.",
    color: "bg-retro-yellow",
    textColor: "text-retro-yellow",
    borderColor: "border-retro-yellow",
    placeholder: "bg-retro-yellow/10",
    image: "/WhiteBoard.png",
  },
  {
    title: "Media Sharing",
    description:
      "Drop images, videos, and files directly into chats with inline previews. Sharing made effortless.",
    color: "bg-retro-pink",
    textColor: "text-retro-pink",
    borderColor: "border-retro-pink",
    placeholder: "bg-retro-pink/10",
    image: "/MediaShare.png",
  },
];

const FeatureCard = ({
  feature,
  index,
}: {
  feature: (typeof FEATURES)[number];
  index: number;
}) => (
  <div
    className={cn(
      "flex h-full w-full flex-col overflow-hidden border-[3px] border-ink bg-paper shadow-[5px_5px_0_0_var(--color-ink)] md:flex-row",
    )}
  >
    {/* Text content — left 40% */}
    <div className="flex w-full flex-col justify-center gap-3 p-6 md:w-[40%] md:p-10">
      {/* Feature number badge */}
      <div
        className={cn(
          "neo-sm inline-flex h-9 w-9 items-center justify-center font-extrabold text-ink",
          feature.color,
        )}
      >
        {index + 1}
      </div>

      {/* Title */}
      <h2 className="text-2xl font-extrabold uppercase tracking-tight text-ink md:text-3xl">
        {feature.title}
      </h2>

      {/* Description */}
      <p className="text-sm font-semibold leading-relaxed text-ink/70 md:text-base">
        {feature.description}
      </p>

      {/* Decorative line */}
      <div className={cn("mt-1 h-1 w-16 border-[3px] border-ink", feature.color)} />
    </div>

    {/* Image — right 60% */}
    <div
      className={cn(
        "flex flex-1 items-center justify-center border-t-[3px] border-ink p-6 md:border-t-0 md:border-l-[3px] md:p-10",
        feature.placeholder,
      )}
    >
      <img
        src={feature.image}
        alt={`${feature.title} screenshot`}
        className="neo-sm max-h-[70%] w-auto max-w-full object-contain"
      />
    </div>
  </div>
);

export default function Landing() {
  return (
    <div className="bg-doodle">
      {/* Hero */}
      <HeroSection />

      {/* Feature stacking cards */}
      <section className="relative bg-doodle">
        {/* Section header */}
        <div className="flex flex-col items-center gap-4 pb-8 pt-16 text-center">
          <h2 className="neo rotate-[-1deg] bg-retro-orange px-6 py-2 text-3xl font-extrabold uppercase tracking-tight text-ink sm:text-4xl">
            What&apos;s Inside
          </h2>
          <p className="max-w-lg text-base font-bold uppercase tracking-wide text-ink/60">
            Everything you need, nothing you don&apos;t.
          </p>
        </div>

        {/* Stacking cards */}
        <StackingCards>
          {FEATURES.map((feature, i) => (
            <FeatureCard key={feature.title} feature={feature} index={i} />
          ))}
        </StackingCards>
      </section>

      {/* Footer CTA */}
      <footer className="relative border-t-[4px] border-ink bg-ink py-20 text-center">
        <div className="flex flex-col items-center gap-6">
          <h2 className="text-3xl font-extrabold uppercase tracking-tight text-paper sm:text-4xl md:text-5xl">
            Ready to start chatting?
          </h2>
          <Link
            to="/register"
            className="neo neo-press bg-retro-green px-10 py-4 text-xl font-extrabold uppercase tracking-wide text-ink"
          >
            Get Started — It&apos;s Free
          </Link>
          <p className="mt-4 text-sm font-bold uppercase tracking-widest text-paper/40">
            Threadly &copy; {new Date().getFullYear()}
          </p>

          {/* Connect with me */}
          <div className="mt-6 flex flex-col items-center gap-4">
            <p className="text-sm font-bold uppercase tracking-widest text-paper/60">
              Connect with me
            </p>
            <div className="flex items-center gap-5">
              {SOCIAL_LINKS.map((link) => {
                const isMail = link.url.startsWith("mailto:");
                const Icon = link.icon;
                return (
                  <a
                    key={link.name}
                    href={link.url}
                    target={isMail ? undefined : "_blank"}
                    rel={isMail ? undefined : "noopener noreferrer"}
                    aria-label={link.name}
                    className="neo-sm flex h-10 w-10 items-center justify-center bg-paper text-ink transition-transform hover:-translate-y-0.5 hover:bg-retro-yellow"
                  >
                    <Icon className="h-5 w-5" />
                  </a>
                );
              })}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
