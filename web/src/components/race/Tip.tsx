import {
  useCallback,
  useState,
  type ReactNode,
  type PointerEvent,
} from "react";

/** Lightweight cursor tooltip that works for hover and tap. */
export function useTip() {
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    content: ReactNode;
  } | null>(null);
  const show = useCallback(
    (content: ReactNode) => (e: PointerEvent) =>
      setTip({ x: e.clientX, y: e.clientY, content }),
    [],
  );
  const hide = useCallback(() => setTip(null), []);
  const node = tip ? (
    <div
      className="pointer-events-none fixed z-50 max-w-64 -translate-x-1/2 -translate-y-full border border-foreground bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg tnum"
      style={{ left: tip.x, top: tip.y - 10 }}
    >
      {tip.content}
    </div>
  ) : null;
  return { show, hide, node };
}
