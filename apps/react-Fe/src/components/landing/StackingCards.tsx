import { useRef, useState, useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StackingCardsProps {
  children: ReactNode;
  className?: string;
}

export function StackingCards({ children, className }: StackingCardsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Global progress: 0 when container top hits viewport top,
  // 1 when container bottom hits viewport bottom.
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const rect = el!.getBoundingClientRect();
      const vh = window.innerHeight;
      const totalScroll = rect.height - vh;
      if (totalScroll <= 0) return;
      setProgress(Math.max(0, Math.min(1, -rect.top / totalScroll)));
    };

    let raf: number;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  const totalCards = Array.isArray(children) ? children.length : 1;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {Array.isArray(children)
        ? children.map((child, i) => (
            <CardItem
              key={i}
              index={i}
              totalCards={totalCards}
              progress={progress}
            >
              {child}
            </CardItem>
          ))
        : children}
    </div>
  );
}

function CardItem({
  index,
  totalCards,
  progress,
  children,
}: {
  index: number;
  totalCards: number;
  progress: number;
  children: ReactNode;
}) {
  // Each card occupies an equal share of the scroll range.
  // A card is "behind" once progress has passed its share.
  const cardShare = 1 / totalCards;
  const cardEnd = (index + 1) * cardShare;

  // How far past this card we've scrolled, 0..1
  const behind = Math.max(0, Math.min(1, (progress - cardEnd) / cardShare));

  const scale = 1 - behind * 0.06;
  const opacity = 1 - behind * 0.6;

  return (
    <div
      className="sticky h-screen w-full"
      style={{
        zIndex: index + 1,
        top: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        className="h-[65vh] w-10/12 max-w-8xl"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "center center",
          opacity,
        }}
      >
        {children}
      </div>
    </div>
  );
}
