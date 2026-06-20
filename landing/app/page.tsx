"use client";

import React, { useEffect, useRef, useState } from "react";
import { CinematicFooter } from "@/components/ui/motion-footer";

const APP_URL = "https://aether-trader.vercel.app/";

// Small arrow glyph used inside the green "Try Demo" button (matches the
// reference's button-icon swap on hover).
const ArrowIcon = () => (
  <svg height="100%" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4.66699 11.3332L11.3337 4.6665" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4.66699 4.6665H11.3337V11.3332" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Original app logo (the cloud/swirl mark). Uses currentColor so it inherits
// the brand-mark colour.
const ToruMark = ({ size = 26, className }: { size?: number; className?: string }) => (
  <svg
    width={size}
    height={Math.round(size * (400 / 520))}
    viewBox="0 0 520 400"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M 35 230 A 125 125 0 0 0 260 305 A 125 125 0 0 0 485 230 C 485 190 460 160 430 145 L 260 55 C 230 40 190 90 160 90 C 140 90 110 40 90 40 C 60 40 35 130 35 230 Z M 250 230 A 90 90 0 1 0 70 230 A 90 90 0 1 0 250 230 Z M 450 230 A 90 90 0 1 0 270 230 A 90 90 0 1 0 450 230 Z M 227 265 A 32 32 0 1 0 163 265 A 32 32 0 1 0 227 265 Z M 427 265 A 32 32 0 1 0 363 265 A 32 32 0 1 0 427 265 Z"
    />
  </svg>
);

// Re-exported under the "Toru" spelling so modules that do
// `import { ToroMark }` (e.g. terminal/page.tsx) resolve correctly.
export { ToruMark as ToroMark };

// Animated "eye" version of the logo — same cloud, but the two sockets are
// hollow and each pupil is a separate <g> we can orbit (the eye-scroll motion).
const EyeLogo = ({
  pupilLeft,
  pupilRight,
}: {
  pupilLeft: React.RefObject<SVGGElement | null>;
  pupilRight: React.RefObject<SVGGElement | null>;
}) => (
  <svg viewBox="0 0 520 400" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Cloud with two hollow eye sockets (pupils removed from this path) */}
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M 35 230 A 125 125 0 0 0 260 305 A 125 125 0 0 0 485 230 C 485 190 460 160 430 145 L 260 55 C 230 40 190 90 160 90 C 140 90 110 40 90 40 C 60 40 35 130 35 230 Z M 250 230 A 90 90 0 1 0 70 230 A 90 90 0 1 0 250 230 Z M 450 230 A 90 90 0 1 0 270 230 A 90 90 0 1 0 450 230 Z"
    />
    <g ref={pupilLeft} className="eye-pupil eye-pupil-l">
      <circle cx="195" cy="265" r="32" fill="currentColor" />
    </g>
    <g ref={pupilRight} className="eye-pupil eye-pupil-r">
      <circle cx="395" cy="265" r="32" fill="currentColor" />
    </g>
  </svg>
);

// ── Right-hand media panels — on-theme mock product UI that swaps as you scroll,
//    standing in for the reference's product videos. ──────────────────────────

function LeadersPanel() {
  const rows = [
    { rank: "01", name: "0xVega", win: "92%", vol: "$2.4M", up: true },
    { rank: "02", name: "satoshi.eth", win: "88%", vol: "$1.9M", up: true },
    { rank: "03", name: "0xNova", win: "81%", vol: "$1.1M", up: true },
    { rank: "04", name: "deltahunter", win: "76%", vol: "$840K", up: false },
  ];
  return (
    <div className="toru-card">
      <div className="toru-card-head">
        <span className="toru-card-title">Leaderboard</span>
        <span className="toru-pill-live"><span className="toru-dot" /> 24h</span>
      </div>
      <div className="toru-leaders">
        {rows.map((r, i) => (
          <div className="toru-leader-row" key={r.name}>
            <span className="toru-leader-rank">{r.rank}</span>
            <span className="toru-leader-name">{r.name}</span>
            <span className="toru-leader-win">{r.win}</span>
            <span className="toru-leader-vol">{r.vol}</span>
            <span className={`toru-copy${i === 0 ? " is-active" : ""}`}>{i === 0 ? "Copying" : "Copy"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeedPanel() {
  const rows = [
    { side: "BUY", asset: "ETH", amt: "1.20", t: "now", ok: true },
    { side: "SELL", asset: "MNT", amt: "4,800", t: "12s", ok: true },
    { side: "BUY", asset: "USDC", amt: "5,000", t: "1m", ok: true },
    { side: "SKIP", asset: "PEPE", amt: "—", t: "2m", ok: false },
  ];
  return (
    <div className="toru-card">
      <div className="toru-card-head">
        <span className="toru-card-title">Agent activity</span>
        <span className="toru-pill-live"><span className="toru-dot" /> Live</span>
      </div>
      <div className="toru-feed">
        {rows.map((r, i) => (
          <div className="toru-feed-row" key={i}>
            <span className={`toru-side ${r.side.toLowerCase()}`}>{r.side}</span>
            <span className="toru-feed-asset">{r.amt} {r.asset}</span>
            <span className="toru-feed-time">{r.t}</span>
            <span className={`toru-feed-status${r.ok ? "" : " skip"}`}>{r.ok ? "Mirrored" : "Over limit"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VaultPanel() {
  const limits = [
    { label: "Max trade size", value: "$1,000" },
    { label: "Daily loss limit", value: "$250" },
    { label: "Allowed tokens", value: "ETH · MNT · USDC" },
  ];
  return (
    <div className="toru-card">
      <div className="toru-card-head">
        <span className="toru-card-title">Your vault</span>
        <span className="toru-pill-ghost">Non-custodial</span>
      </div>
      <div className="toru-vault-balance">
        <span className="toru-vault-label">Vault balance</span>
        <span className="toru-vault-value">$12,480<span className="toru-vault-cur"> aUSD</span></span>
      </div>
      <div className="toru-limits">
        {limits.map((l) => (
          <div className="toru-limit-row" key={l.label}>
            <span className="toru-limit-label">{l.label}</span>
            <span className="toru-limit-value">{l.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const TABS = [
  {
    heading: (
      <>
        Follow the best traders with <span className="text-color-green">one tap</span>
      </>
    ),
    body: "Browse the live leaderboard, compare win rates and 24h volume, and start following a proven trader in seconds — no charts to watch.",
    Panel: LeadersPanel,
  },
  {
    heading: (
      <>
        Your agent trades <span className="text-color-green">24/7 on-chain</span>
      </>
    ),
    body: "A keeper watches your leader's every move and mirrors it into your vault in real time — fully autonomous, every trade recorded on-chain.",
    Panel: FeedPanel,
  },
  {
    heading: (
      <>
        Your funds, <span className="text-color-green">always in your control</span>
      </>
    ),
    body: "TORU never takes custody. Your capital lives in a smart-contract vault you own, and your agent can only act within the risk limits you set.",
    Panel: VaultPanel,
  },
];

// Masthead ticker row (placeholder prices).
const TICKERS = [
  { sym: "BTC", price: "$58,887", chg: "-1.35%", up: false },
  { sym: "ETH", price: "$4,130", chg: "-1.42%", up: false },
  { sym: "SOL", price: "$214", chg: "+5.98%", up: true },
  { sym: "MNT", price: "$1.18", chg: "+7.09%", up: true },
  { sym: "aUSD", price: "$1.00", chg: "+0.01%", up: true },
];

// "Two-columns" section — feature cards that fade in, staggered.
const CARDS = [
  { title: "Copy the proven", sub: "Leaderboard", body: "Follow traders ranked by real on-chain win rate and 24h volume — not hype." },
  { title: "Stay in control", sub: "Non-custodial", body: "Your capital never leaves your vault. TORU can only trade within the rules you set." },
  { title: "Always on", sub: "Autonomous", body: "A keeper watches your leader 24/7 and mirrors every move, on-chain, in real time." },
];

const FEATURED_ITEMS = [
  {
    title: "Smart Copy-Trading",
    subtitle: "Mirror top traders' moves automatically — your agent watches 24/7 and executes on-chain in real time.",
  },
  {
    title: "AI Risk Engine",
    subtitle: "Built-in risk scoring evaluates every trade before execution, protecting your vault from reckless moves.",
  },
  {
    title: "Non-Custodial Vaults",
    subtitle: "Your funds stay in your smart-contract vault. TORU agents can only trade within the limits you define.",
  },
  {
    title: "On-Chain Analytics",
    subtitle: "Track every trade, win rate, and P&L transparently on-chain — no hidden data, no trust required.",
  },
];

const PARTNERS = [
  { name: "BNB Chain", img: "/bnb-logo.png" },
  { name: "PancakeSwap", img: "/pancakeSwap-logo.png" },
  { name: "Trust Wallet", img: "/trust-logo.png" },
];

function FeaturedSection() {
  const [isPlaying, setIsPlaying] = useState(false);

  return (
    <section className="featured-section" id="features">
      <div className="featured-inner">
        <header className="featured-header">
          <h2 className="featured-title">
            Empowering traders<br />with autonomous agents.
          </h2>
        </header>

        <div className="featured-grid">
          {/* Main media card */}
          <div className="featured-main-card">
            <div className="featured-media">
              {isPlaying ? (
                <video
                  src="https://pub-940ccf6255b54fa799a9b01050e6c227.r2.dev/crm(1)(1)(1).mp4"
                  autoPlay muted loop playsInline
                  style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "12px" }}
                />
              ) : (
                <div className="featured-media-inner" onClick={() => setIsPlaying(true)}>
                  <img
                    src="https://pub-940ccf6255b54fa799a9b01050e6c227.r2.dev/crm-featured.png"
                    alt="TORU Platform"
                    style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "12px" }}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Feature cards grid */}
          <div className="featured-cards-grid">
            {FEATURED_ITEMS.map((f, i) => (
              <div className="featured-card" key={i}>
                <div className="featured-card-thumb" />
                <div className="featured-card-text">
                  <h3 className="featured-card-title">{f.title}</h3>
                  <p className="featured-card-sub">{f.subtitle}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Partners row */}
        <div className="featured-partners">
          {PARTNERS.map((p) => (
            <div className="featured-partner" key={p.name}>
              <img src={p.img} alt={p.name} className="featured-partner-img" />
              <span className="featured-partner-name">{p.name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Loader eye — standalone animated version for the splash screen
const LoaderEye = () => (
  <svg viewBox="0 0 520 400" fill="none" xmlns="http://www.w3.org/2000/svg" className="loader-eye-svg">
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M 35 230 A 125 125 0 0 0 260 305 A 125 125 0 0 0 485 230 C 485 190 460 160 430 145 L 260 55 C 230 40 190 90 160 90 C 140 90 110 40 90 40 C 60 40 35 130 35 230 Z M 250 230 A 90 90 0 1 0 70 230 A 90 90 0 1 0 250 230 Z M 450 230 A 90 90 0 1 0 270 230 A 90 90 0 1 0 450 230 Z"
    />
    <g className="loader-pupil-l">
      <circle cx="195" cy="265" r="32" fill="currentColor" />
    </g>
    <g className="loader-pupil-r">
      <circle cx="395" cy="265" r="32" fill="currentColor" />
    </g>
  </svg>
);

export default function Home() {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLAnchorElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const pLeftRef = useRef<SVGGElement>(null);
  const pRightRef = useRef<SVGGElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const revealWordRef = useRef<HTMLHeadingElement>(null);
  const revealKickRef = useRef<HTMLParagraphElement>(null);
  const startRef = useRef({ cx: 0, cy: 0, size: 56 });
  const mouseRef = useRef({ x: -9999, y: -9999 });

  useEffect(() => {
    // easeInOutCubic
    const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

    // Capture the logo's resting position (the nav slot) in scroll-0 viewport
    // coordinates, so we can interpolate from there to the centre.
    const computeStart = () => {
      const a = anchorRef.current;
      if (!a) return;
      const r = a.getBoundingClientRect();
      startRef.current = {
        cx: r.left + r.width / 2 + window.scrollX,
        cy: r.top + r.height / 2 + window.scrollY,
        size: r.width || 56,
      };
      if (logoRef.current) logoRef.current.style.width = `${startRef.current.size}px`;
    };

    const onScroll = () => {
      // ── Scroll-driven tab switcher (no GSAP): map how far the tall track has
      //    scrolled past the sticky viewport into an active index (0..2). ──
      const el = trackRef.current;
      if (el) {
        const rect = el.getBoundingClientRect();
        const total = el.offsetHeight - window.innerHeight;
        const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
        const ratio = scrolled / Math.max(total, 1);
        const idx = Math.min(TABS.length - 1, Math.floor(ratio * TABS.length));
        setActive((prev) => (prev === idx ? prev : idx));
      }

      // ── Hero parallax: blur and fade as user scrolls toward reveal ──
      const hero = heroRef.current;
      if (hero) {
        const heroH = hero.offsetHeight;
        const p = Math.min(Math.max(window.scrollY / heroH, 0), 1);
        const blur = p * 8;
        const opacity = 1 - p * 1.3;
        hero.style.filter = `blur(${blur}px)`;
        hero.style.opacity = `${Math.max(opacity, 0)}`;
      }

      // ── Tile spotlight: closest row to mouse cursor gets full color ──
      const { y: my } = mouseRef.current;
      const tiles = document.querySelectorAll('.tile-img');
      if (tiles.length === 20) {
        const rowAvgY: number[] = [];
        for (let r = 0; r < 4; r++) {
          let sum = 0;
          for (let c = 0; c < 5; c++) {
            const tr = tiles[r * 5 + c].getBoundingClientRect();
            sum += tr.top + tr.height / 2;
          }
          rowAvgY.push(sum / 5);
        }
        let mouseRow = -1;
        let mouseMin = Infinity;
        for (let r = 0; r < 4; r++) {
          const mDist = Math.abs(my - rowAvgY[r]);
          if (mDist < mouseMin) { mouseMin = mDist; mouseRow = r; }
        }
        tiles.forEach((tile, i) => {
          const row = Math.floor(i / 5);
          if (row === mouseRow) {
            tile.classList.add('in-spotlight');
          } else {
            tile.classList.remove('in-spotlight');
          }
        });
      }

      // ── Brand reveal: blooms in from small to large (flower-like) as the
      //    section enters the viewport, then scales further as it scrolls past. ──
      const rv = revealRef.current;
      if (rv) {
        const rect = rv.getBoundingClientRect();
        const vh = window.innerHeight;

        // Phase 1: bloom-in — section enters viewport from bottom
        // When rect.top == vh → just off-screen (enterP=0)
        // When rect.top == 0  → fully entered (enterP=1)
        const enterP = Math.min(Math.max(1 - rect.top / vh, 0), 1);
        const bloomEase = enterP * enterP * (3 - 2 * enterP); // smoothstep

        // Phase 2: scroll-through — section scrolls past (existing behavior)
        const total = Math.max(rv.offsetHeight - vh, 1);
        const throughP = Math.min(Math.max(-rect.top, 0), total) / total;

        if (revealWordRef.current) {
          // Bloom: 0.3 → 1.0 as it enters, then 1.0 → 5.0 as it scrolls past
          const bloomScale = 0.3 + bloomEase * 0.7;
          const scrollScale = 1 + throughP * 4;
          const finalScale = enterP < 1 ? bloomScale : scrollScale;
          const fadeOut = throughP < 0.65 ? 1 : Math.max(1 - (throughP - 0.65) / 0.35, 0);
          revealWordRef.current.style.transform = `scale(${finalScale})`;
          revealWordRef.current.style.opacity = `${bloomEase * fadeOut}`;
        }
        if (revealKickRef.current) {
          const kickFade = enterP < 1 ? bloomEase : Math.max(1 - throughP / 0.4, 0);
          revealKickRef.current.style.opacity = `${kickFade}`;
          revealKickRef.current.style.transform = `translateY(${(1 - bloomEase) * 30}px)`;
        }

        // Bloom the floating logo squares too
        const squares = rv.querySelector('.reveal-squares') as HTMLElement | null;
        if (squares) {
          const sqScale = 0.4 + bloomEase * 0.6;
          squares.style.transform = `scale(${sqScale})`;
          squares.style.opacity = `${bloomEase * 0.85}`;
        }
      }

      // ── Parallax transition: "Why beginners" content shifts at different speeds ──
      const sdTwo = document.querySelector('.sd-two .two-columns') as HTMLElement | null;
      if (sdTwo) {
        const sdRect = sdTwo.getBoundingClientRect();
        const scrollPast = Math.max(-sdRect.top, 0);
        const h2El = sdTwo.querySelector('h2') as HTMLElement | null;
        const cardsEl = sdTwo.querySelector('.cards') as HTMLElement | null;
        const previewEl = sdTwo.querySelector('.preview') as HTMLElement | null;
        if (h2El) h2El.style.transform = `translateY(${scrollPast * 0.15}px)`;
        if (cardsEl) cardsEl.style.transform = `translateY(${scrollPast * 0.08}px)`;
        if (previewEl) previewEl.style.transform = `translateY(${scrollPast * 0.25}px)`;
      }

      // ── Parallax footer: layers move at different speeds ──
      const pfSection = document.querySelector('.parallax-footer') as HTMLElement | null;
      if (pfSection) {
        const rect = pfSection.getBoundingClientRect();
        const offset = -rect.top;
        const layers = pfSection.querySelectorAll('.pf-layer');
        const speeds = [0, 0.15, 0.3, 0.5]; // back to front
        layers.forEach((layer, i) => {
          (layer as HTMLElement).style.transform = `translateY(${offset * (speeds[i] || 0)}px)`;
        });
      }
    };

    const onResize = () => {
      computeStart();
      onScroll();
    };

    const onMouseMove = (e: MouseEvent) => {
      mouseRef.current = { x: e.clientX, y: e.clientY };
      onScroll(); // re-run spotlight check on mouse move
    };

    computeStart();
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
    };
  }, []);

  return (
    <>
      {/* ── Sticky site navbar — stays fixed across the whole page ───────── */}
      <header className="site-nav">
        <div className="site-nav-inner">
          <a href={APP_URL} className="mag-logo" aria-label="TORU home">
            <img src="/toru.png" alt="TORU" className="mag-logo-img" />
            <span className="eye-anchor" ref={anchorRef} />
          </a>
          <div className="mag-top-right">
            <nav className="mag-menu">
              <a href="#about">About</a>
              <a href="#how-it-works">How it works</a>
              <a href="#features">Features</a>
              <a href={APP_URL}>Try Demo</a>
            </nav>
          </div>
        </div>
      </header>

      {/* ── Head — editorial masthead (cloned layout) ─────────────────────── */}
      <header className="mag" ref={heroRef}>
        <div className="mag-grid">
          {/* Lead story */}
          <section className="mag-feature">
            <h1 className="mag-headline">Why climb the mountain when your agent can?</h1>
            <div className="mag-ph mag-feature-img">
              <img src="/pepe-pic.jpeg" alt="Hero" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
          </section>

          {/* Middle column — intentionally left empty for now */}
          <section className="mag-news" aria-hidden="true" />

          {/* Right column */}
          <section className="mag-hot">
            <div className="mag-ph mag-hot-img">
              <img src="/bullish-bearishcropped.jpeg" alt="Bullish Bearish" style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center", display: "block" }} />
            </div>
            <div className="mag-ph mag-hot-img">
              <img src="/dolphin-bnb.jpeg" alt="Dolphin BNB" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            </div>
          </section>
        </div>
      </header>

      {/* ── Brand reveal — "Introducing TORU" masthead-style scroll reveal ── */}
      <section className="reveal" id="about" ref={revealRef}>
        <div className="reveal-inner">
          <div className="reveal-squares" aria-hidden="true">
            <span className="reveal-square s1">
              <img src="/bnb-logo.png" alt="BNB" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </span>
            <span className="reveal-square s2">
              <img src="/pancakeSwap-logo.png" alt="PancakeSwap" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </span>
            <span className="reveal-square s3">
              <img src="/trust-logo.png" alt="Trust Wallet" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </span>
          </div>
          <div className="reveal-stack">
            <p className="reveal-kicker" ref={revealKickRef}>Introducing</p>
            <h2 className="reveal-word" ref={revealWordRef}>TORU</h2>
          </div>
        </div>
      </section>

      {/* ── Scroll-driven story sections (tiles · text · columns · subscribe) ── */}
      <div className="sd">
        {/* Tiles — animated grid transition */}
        <section className="sd-section sd-tiles" style={{ "--name": "--tiles-s" } as React.CSSProperties}>
          <div className="tile-section">
            <div className="tile-container">
              {Array.from({ length: 20 }).map((_, i) => {
                const imgs = ["/monkey-dealer.jpeg", "/genesis-block.jpeg", "/silhouette.jpeg"];
                const src = imgs[i % imgs.length];
                return (
                  <span className="tile tile-img" key={i}>
                    <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  </span>
                );
              })}
            </div>
          </div>
        </section>

        {/* Two columns — cards + a preview image that slides in from the right */}
        <section className="sd-section sd-two" id="how-it-works" style={{ "--name": "--two-columns-s" } as React.CSSProperties}>
          <div className="two-columns">
            <h2>Why beginners choose TORU</h2>
            <div className="content">
              <div className="cards">
                {CARDS.map((c, i) => (
                  <div className="card" key={i}>
                    <h3 className="title">{c.title}</h3>
                    <div className="subtitle">{c.sub}</div>
                    <p>{c.body}</p>
                  </div>
                ))}
              </div>
              <div className="preview">
                <div className="img" />
              </div>
            </div>
          </div>
        </section>

      </div>

      {/* ── Featured Section ─────────────────────────────────────────── */}
      <FeaturedSection />

      {/* ── Cinematic Footer ──────────────────────────────────────────── */}
      <CinematicFooter />

    </>
  );
}
