"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

const TITLE_BASE = "NOON OPS";
const SCRAMBLE_CHARS = "01<>/[]{}=+*#ABCDEF0123456789";
const DURATION = 1100;

function useScramble(target: string, duration = DURATION) {
  const [active, setActive] = useState(false);
  const [text, setText] = useState(target);
  useEffect(() => {
    setActive(true);
  }, []);
  useEffect(() => {
    if (!active) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setText(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const reveal = Math.floor(p * target.length);
      let out = "";
      for (let i = 0; i < target.length; i++) {
        if (i < reveal || target[i] === " ") out += target[i];
        else
          out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      }
      setText(out);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setText(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);
  return text;
}

function useClock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const fmt = () => {
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      setNow(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
    };
    fmt();
    const id = setInterval(fmt, 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function WorkbenchHeader() {
  const titleText = useScramble(TITLE_BASE);
  const clock = useClock();
  return (
    <>
      <div className="wb-eyebrow-row wb-reveal" style={{ animationDelay: "0ms" }}>
        <span className="wb-eyebrow">
          <span className="wb-pulse" aria-hidden />
          <span>SYSTEM ONLINE · 工作台</span>
        </span>
        <span className="wb-clock" aria-label="本地时间">
          <span className="wb-clock-label">LOCAL</span>
          <span className="wb-clock-time">{clock || "--:--:--"}</span>
        </span>
      </div>
      <h1 className="wb-title wb-reveal" style={{ animationDelay: "90ms" }}>
        <span className="wb-title-glitch" data-text={titleText}>{titleText}</span>
        <span className="wb-title-cn"> Noon 运营终端</span>
        <span className="cursor" aria-hidden>█</span>
      </h1>
      <p className="wb-sub wb-reveal" style={{ animationDelay: "180ms" }}>
        本地电商运营控制台。采集、仓库、店铺、上架与 Noon 批量操作集中在一个终端。
      </p>
      <div className="wb-strip wb-reveal" style={{ animationDelay: "260ms" }} aria-label="系统状态">
        <span className="wb-strip-item">
          <span className="wb-strip-dot ok" aria-hidden />
          <span>RUNTIME</span>
          <b>ready</b>
        </span>
        <span className="wb-strip-item">
          <span className="wb-strip-dot ok" aria-hidden />
          <span>1688</span>
          <b>connected</b>
        </span>
        <span className="wb-strip-item">
          <span className="wb-strip-dot warn" aria-hidden />
          <span>NOON</span>
          <b>session idle</b>
        </span>
        <span className="wb-strip-item">
          <span className="wb-strip-dot ok" aria-hidden />
          <span>NODE</span>
          <b>v22</b>
        </span>
      </div>
    </>
  );
}

export function WorkbenchCardInner({
  index,
  name,
  desc,
  tag,
  external,
}: {
  index: string;
  name: string;
  desc: string;
  tag: string;
  external?: boolean;
}) {
  return (
    <>
      <span className="tick tl" aria-hidden />
      <span className="tick tr" aria-hidden />
      <span className="tick bl" aria-hidden />
      <span className="tick br" aria-hidden />
      <span className="wb-beam" aria-hidden />
      <div className="wb-card-top">
        <span className="wb-index">{index}</span>
        <span className="wb-arrow" aria-hidden>
          <ArrowIcon />
        </span>
      </div>
      <div className="wb-card-body">
        <h2 className="wb-name">{name}</h2>
        <p className="wb-desc">{desc}</p>
      </div>
      <div className="wb-card-foot">
        <span className="wb-tag">
          <span className="wb-strip-dot ok" aria-hidden />
          {tag}
        </span>
        <span className="wb-tag wb-tag-ext">{external ? "EXTERNAL ↗" : "OPEN →"}</span>
        <span className="wb-bar" aria-hidden>
          <span className="wb-bar-fill" />
        </span>
      </div>
    </>
  );
}

function ArrowIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M3 9L9 3M9 3H4M9 3V8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function WorkbenchCardLink({
  href,
  external,
  revealDelay,
  children,
}: {
  href: string;
  external?: boolean;
  revealDelay: number;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    const el = ref.current ?? (e.currentTarget as HTMLElement);
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    el.style.setProperty("--px", `${px}%`);
  };
  const cls = "wb-card wb-reveal" + (external ? " wb-ext" : "");
  const style = { animationDelay: `${revealDelay}ms` } as React.CSSProperties;
  if (external) {
    return (
      <a ref={ref as React.RefObject<HTMLAnchorElement>} className={cls} style={style} href={href} onMouseMove={onMove}>
        {children}
      </a>
    );
  }
  return (
    <Link ref={ref as React.RefObject<HTMLAnchorElement>} className={cls} style={style} href={href} onMouseMove={onMove}>
      {children}
    </Link>
  );
}
