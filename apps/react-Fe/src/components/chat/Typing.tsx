import { classNames } from "../../utils";

const Typing: React.FC<{ label?: string }> = ({ label }) => {
  return (
    <div
      className={classNames(
        "p-3 border-2 border-ink bg-paper w-fit inline-flex items-center gap-3 shadow-[3px_3px_0_0_var(--color-ink)]",
      )}
    >
      <span className="inline-flex gap-1.5">
        <span className="animation1 mx-[0.5px] h-2 w-2 bg-retro-orange"></span>
        <span className="animation2 mx-[0.5px] h-2 w-2 bg-retro-yellow"></span>
        <span className="animation3 mx-[0.5px] h-2 w-2 bg-retro-orange"></span>
      </span>
      {label ? (
        <span className="font-extrabold uppercase tracking-wide text-ink text-xs">
          {label}
        </span>
      ) : null}
    </div>
  );
};

export default Typing;
