import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface NavItem {
  id: string;
  label: string;
}

/** Anchor links to the page sections; the one scrolled into the upper part of the viewport is underlined. */
export function SectionNav({ items }: { items: NavItem[] }) {
  const [current, setCurrent] = useState(items[0]?.id);
  const key = items.map((i) => i.id).join();

  useEffect(() => {
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        const first = items.find((i) => visible.has(i.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: "-130px 0px -60% 0px" },
    );
    for (const i of items) {
      const el = document.getElementById(i.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <nav
      aria-label="Sections"
      className="-mx-1 flex gap-0.5 overflow-x-auto pb-2 [scrollbar-width:none]"
    >
      {items.map((i) => (
        <a
          key={i.id}
          href={`#${i.id}`}
          aria-current={current === i.id ? "location" : undefined}
          className={cn(
            "whitespace-nowrap rounded-[3px] px-2.5 py-1 font-display text-xs font-semibold uppercase tracking-[0.06em] transition-colors hover:bg-popover hover:text-foreground",
            current === i.id
              ? "text-foreground shadow-[inset_0_-2px_0_var(--primary)]"
              : "text-muted-foreground",
          )}
        >
          {i.label}
        </a>
      ))}
    </nav>
  );
}
