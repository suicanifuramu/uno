// 純粋関数のみ。DO とクライアント両方から使える
import type { Card, CardColor, Color, Kind } from "./types";

export const COLORS: Color[] = ["red", "green", "yellow", "blue"];

let seq = 0;
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const color of COLORS) {
    deck.push({ id: `c${seq++}`, kind: "number", color, num: 0 });
    for (let n = 1; n <= 9; n++) {
      deck.push({ id: `c${seq++}`, kind: "number", color, num: n });
      deck.push({ id: `c${seq++}`, kind: "number", color, num: n });
    }
    for (const kind of ["skip", "reverse", "draw2"] as const) {
      deck.push({ id: `c${seq++}`, kind, color });
      deck.push({ id: `c${seq++}`, kind, color });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: `c${seq++}`, kind: "wild", color: "wild" });
    deck.push({ id: `c${seq++}`, kind: "wild4", color: "wild" });
  }
  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** スタッキング中かどうかを問わず、このカードが今出せるか */
export function isPlayable(
  card: Card,
  top: Card | null,
  activeColor: CardColor,
): boolean {
  if (!top) return true;
  if (card.kind === "wild" || card.kind === "wild4") return true;
  if (card.color === activeColor) return true;
  // 数字は数字同士で番号一致。記号札は種類一致(skip on skip 等)
  if (
    card.kind === "number" &&
    top.kind === "number" &&
    card.num === top.num
  ) {
    return true;
  }
  return card.kind !== "number" && card.kind === top.kind;
}

/** スタッキング中に出せるのは同種の罰札だけ(+2は+2に、+4は+4に) */
export function canStackOn(card: Card, pendingKind: Kind | null): boolean {
  return (
    (pendingKind === "draw2" && card.kind === "draw2") ||
    (pendingKind === "wild4" && card.kind === "wild4")
  );
}

export function jumpInEligible(card: Card, top: Card | null): boolean {
  if (!top || !isPlayable(card, top, top.color)) return false;
  // 完全同一(色と数字/記号)。ワイルドは色未確定なので対象外
  if (card.kind === "wild" || card.kind === "wild4") return false;
  if (card.color !== top.color) return false;
  if (card.kind !== top.kind) return false;
  return !(card.kind === "number" && card.num !== top.num);
}

export function cardLabel(c: Card): string {
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
      return "W";
    case "wild4":
      return "+4";
  }
}
