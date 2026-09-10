import { Link } from "react-router-dom";

export default function HeroSection() {
  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-doodle px-4">
      {/* Decorative floating shapes */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="hero-float absolute left-[8%] top-[15%] h-16 w-16 rotate-12 border-[3px] border-ink bg-retro-orange shadow-[4px_4px_0_0_var(--color-ink)]" />
        <div className="hero-float-delayed absolute right-[12%] top-[20%] h-12 w-12 -rotate-6 border-[3px] border-ink bg-retro-blue shadow-[4px_4px_0_0_var(--color-ink)]" />
        <div className="hero-float absolute bottom-[25%] left-[15%] h-10 w-10 rotate-45 border-[2px] border-ink bg-retro-green shadow-[3px_3px_0_0_var(--color-ink)]" />
        <div className="hero-float-delayed absolute bottom-[20%] right-[10%] h-14 w-14 -rotate-12 border-[3px] border-ink bg-retro-yellow shadow-[4px_4px_0_0_var(--color-ink)]" />
        <div className="hero-float absolute left-[45%] top-[10%] h-8 w-8 rotate-[30deg] border-[2px] border-ink bg-retro-pink shadow-[3px_3px_0_0_var(--color-ink)]" />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center gap-8 text-center">
        {/* Title badge */}
        <h1 className="neo hero-title rotate-[-2deg] bg-retro-yellow px-8 py-3 text-5xl font-extrabold uppercase tracking-tight text-ink sm:text-6xl md:text-7xl">
          Threadly
        </h1>

        {/* Tagline */}
        <p className="max-w-2xl text-lg font-bold uppercase tracking-wide text-ink/80 sm:text-xl md:text-2xl">
          Real-time chat. Group calls. Collaborative whiteboard.
          <br />
          <span className="text-retro-orange">All in one place.</span>
        </p>

        {/* CTA buttons */}
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <Link
            to="/register"
            className="neo neo-press bg-retro-green px-8 py-3 text-lg font-extrabold uppercase tracking-wide text-ink"
          >
            Get Started
          </Link>
          <Link
            to="/login"
            className="neo neo-press bg-retro-yellow px-8 py-3 text-lg font-extrabold uppercase tracking-wide text-ink"
          >
            I Have an Account
          </Link>
        </div>

        {/* Scroll hint */}
        <div className="mt-12 flex flex-col items-center gap-2 text-sm font-bold uppercase tracking-widest text-ink/50">
          <span>Scroll to explore</span>
          <div className="scroll-bounce h-5 w-5 border-b-[3px] border-r-[3px] border-ink/40 rotate-45" />
        </div>
      </div>
    </section>
  );
}
