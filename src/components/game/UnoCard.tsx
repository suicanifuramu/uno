import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import type { Card, CardColor, Color } from "@/shared/types";

const COLOR_BG: Record<Color, string> = {
  red: "bg-red-600",
  green: "bg-green-600",
  yellow: "bg-yellow-400",
  blue: "bg-blue-600",
};

const WILD_BG =
  "bg-[conic-gradient(from_180deg,#e7000b_0deg,#14b8a6_90deg,#f59e0b_180deg,#2563eb_270deg,#e7000b_360deg)]";

function cardLabel(c: Card): string {
  switch (c.kind) {
    case "number":
      return String(c.num ?? "");
    case "skip":
      return "⊘";
    case "reverse":
      return "⇄";
    case "draw2":
      return "+2";
    case "wild":
      return "★";
    case "wild4":
      return "+4";
    default:
      return "";
  }
}

const cardVariants = cva(
  "relative select-none shrink-0 rounded-lg border-4 border-white font-extrabold italic text-white shadow-md grid place-items-center transition-transform duration-150",
  {
    variants: {
      size: {
        xs: "h-12 w-8 text-sm rounded",
        sm: "h-16 w-11 text-xl rounded-md",
        md: "h-24 w-16 text-3xl",
        lg: "h-32 w-22 text-5xl",
      },
      interactive: {
        true: "cursor-pointer hover:-translate-y-2 hover:shadow-xl focus-visible:-translate-y-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/70",
        false: "",
      },
      dimmed: {
        true: "opacity-50 saturate-50",
        false: "",
      },
    },
    defaultVariants: {
      size: "md",
      interactive: false,
      dimmed: false,
    },
  },
);

export interface UnoCardProps
  extends Omit<VariantProps<typeof cardVariants>, "interactive"> {
  card?: Card;
  faceDown?: boolean;
  playable?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  ariaLabel?: string;
}

export function UnoCard({
  card,
  faceDown = false,
  playable = false,
  onClick,
  className,
  style,
  size,
  dimmed,
  ariaLabel,
}: UnoCardProps) {
  const isWild = !faceDown && (card?.kind === "wild" || card?.kind === "wild4");
  const bg = faceDown
    ? "bg-neutral-900"
    : isWild
      ? WILD_BG
      : COLOR_BG[(card!.color === "wild" ? "red" : card!.color) as Color];
  const label = faceDown ? "" : card ? cardLabel(card) : "";
  const textColor = !faceDown && card?.color === "yellow" ? "text-black" : "";

  return (
    <button
      type="button"
      aria-label={
        ariaLabel ?? (faceDown ? "Deck" : `Card ${card?.color ?? ""} ${label}`)
      }
      disabled={!onClick}
      onClick={onClick}
      style={style}
      className={cn(
        cardVariants({ size, interactive: !!onClick, dimmed }),
        bg,
        textColor,
        playable && "ring-4 ring-white/80 -translate-y-2 shadow-lg",
        className,
      )}
    >
      {/* 中央の白楕円 */}
      <span
        aria-hidden
        className="absolute inset-[10%] -rotate-[20deg] rounded-full bg-white/95"
      />
      {/* 裏面は赤帯 */}
      {faceDown && (
        <span
          aria-hidden
          className="absolute inset-[8%] -rotate-[20deg] rounded-full bg-red-700 border-[3px] border-white"
        />
      )}
      <span className={cn("relative z-10 not-italic", textColor)}>{label}</span>
      <span
        aria-hidden
        className={cn(
          "absolute left-0.5 top-0 z-10 text-[0.55em] leading-none not-italic",
          textColor,
        )}
      >
        {label}
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute right-0.5 bottom-0 z-10 rotate-180 text-[0.55em] leading-none not-italic",
          textColor,
        )}
      >
        {label}
      </span>
    </button>
  );
}

/** 有効色を示すドット(ワイルド後) */
export function ActiveColorDot({ color }: { color: CardColor }) {
  return (
    <span
      aria-label={`Active color: ${color}`}
      className={cn(
        "inline-block size-6 rounded-full border-2 border-white shadow",
        color === "wild" ? WILD_BG : COLOR_BG[color as Color],
      )}
    />
  );
}
