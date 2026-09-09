import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-sm font-extrabold uppercase tracking-wide transition-all disabled:pointer-events-none disabled:opacity-50 neo-sm neo-press select-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-retro-yellow text-ink",
        retro: "bg-retro-orange text-ink",
        orange: "bg-retro-orange text-ink",
        yellow: "bg-retro-yellow text-ink",
        green: "bg-retro-green text-ink",
        red: "bg-retro-red text-paper",
        blue: "bg-retro-blue text-paper",
        dark: "bg-ink text-cream",
        cream: "bg-cream text-ink",
        ghost: "bg-transparent text-ink shadow-none",
        outline: "border-2 border-ink bg-transparent text-ink shadow-none",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-7 text-base",
        icon: "h-12 w-12",
        "icon-sm": "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };