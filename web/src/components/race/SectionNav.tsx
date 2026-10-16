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
      className="-mx-2.5 flex gap-0.5 overflow-x-auto [scrollbar-width:none]"
    >
      {items.map((i) => (
        <a
          key={i.id}
          href={`#${i.id}`}
          aria-current={current === i.id ? "location" : undefined}
          className={cn(
            "cond whitespace-nowrap px-2.5 py-3 text-sm font-bold uppercase tracking-[0.06em] transition-colors hover:text-band-foreground focus-visible:outline-band-foreground",
            current === i.id
              ? "text-band-foreground shadow-[inset_0_-3px_0_var(--band-foreground)]"
              : "text-band-foreground/85",
          )}
        >
          {i.label}
        </a>
      ))}
    </nav>
  );
}
