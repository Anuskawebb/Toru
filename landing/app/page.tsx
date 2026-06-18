"use client";

import React, { useEffect, useRef, useState } from "react";

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
const ToruMark = ({ size = 26 }: { size?: number }) => (
  <svg
    width={size}
    height={Math.round(size * (400 / 520))}
    viewBox="0 0 520 400"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M 35 230 A 125 125 0 0 0 260 305 A 125 125 0 0 0 485 230 C 485 190 460 160 430 145 L 260 55 C 230 40 190 90 160 90 C 140 90 110 40 90 40 C 60 40 35 130 35 230 Z M 250 230 A 90 90 0 1 0 70 230 A 90 90 0 1 0 250 230 Z M 450 230 A 90 90 0 1 0 270 230 A 90 90 0 1 0 450 230 Z M 227 265 A 32 32 0 1 0 163 265 A 32 32 0 1 0 227 265 Z M 427 265 A 32 32 0 1 0 363 265 A 32 32 0 1 0 427 265 Z"
    />
  </svg>
);

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

// "Two-columns" section — feature cards that fade in, staggered.
const CARDS = [
  { title: "Copy the proven", sub: "Leaderboard", body: "Follow traders ranked by real on-chain win rate and 24h volume — not hype." },
  { title: "Stay in control", sub: "Non-custodial", body: "Your capital never leaves your vault. TORU can only trade within the rules you set." },
  { title: "Always on", sub: "Autonomous", body: "A keeper watches your leader 24/7 and mirrors every move, on-chain, in real time." },
];

export default function Home() {
  const [active, setActive] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const logoRef = useRef<HTMLAnchorElement>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const pLeftRef = useRef<SVGGElement>(null);
  const pRightRef = useRef<SVGGElement>(null);
  const heroBgRef = useRef<HTMLDivElement>(null);
  const heroTextRef = useRef<HTMLDivElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const revealWordRef = useRef<HTMLHeadingElement>(null);
  const revealKickRef = useRef<HTMLParagraphElement>(null);
  const startRef = useRef({ cx: 0, cy: 0, size: 56 });

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

      // ── Eye logo: fly from the nav to the centre + shrink over the first
      //    ~viewport of scroll, then hold centred for the rest of the page. ──
      const logo = logoRef.current;
      if (logo) {
        const flyDist = window.innerHeight * 0.9;
        const p = Math.min(Math.max(window.scrollY / flyDist, 0), 1);
        const e = ease(p);
        const { cx, cy, size } = startRef.current;
        const dx = (1 - e) * (cx - window.innerWidth / 2);
        const dy = (1 - e) * (cy - window.innerHeight / 2);
        const endScale = size > 0 ? 42 / size : 0.75; // small in the centre
        const scale = 1 + (endScale - 1) * e;
        logo.style.transform = `translate3d(calc(-50% + ${dx}px), calc(-50% + ${dy}px), 0) scale(${scale})`;
        logo.style.opacity = "1";
      }

      // ── Hero background: zoom out + blur + fade as you scroll (adapted from
      //    the reference's background-size shrink → a robust transform scale). ──
      const heroP = Math.min(Math.max(window.scrollY / (window.innerHeight * 0.8), 0), 1);
      const hero = heroBgRef.current;
      if (hero) {
        // Slight zoom-in keeps it covering the hero (no edge gaps), then fade out.
        hero.style.transform = `scale(${1 + 0.1 * heroP})`;
        hero.style.opacity = `${Math.max(1 - heroP * 1.1, 0)}`;
      }
      // Hero headline: blur out + fade away on scroll (mirrors the image).
      const heroText = heroTextRef.current;
      if (heroText) {
        heroText.style.filter = `blur(${heroP * 6}px)`;
        heroText.style.opacity = `${Math.max(1 - heroP * 1.2, 0)}`;
      }

      // ── Pupils roll with scroll — the eye-scroll motion. ──
      const rot = window.scrollY * 0.18;
      if (pLeftRef.current) pLeftRef.current.style.transform = `rotate(${rot}deg)`;
      if (pRightRef.current) pRightRef.current.style.transform = `rotate(${rot}deg)`;

      // ── Brand reveal: the word scales up + fades as the section scrolls past
      //    (masthead-style), the kicker fades out early. ──
      const rv = revealRef.current;
      if (rv) {
        const rect = rv.getBoundingClientRect();
        const total = Math.max(rv.offsetHeight - window.innerHeight, 1);
        const p = Math.min(Math.max(-rect.top, 0), total) / total;
        if (revealWordRef.current) {
          revealWordRef.current.style.transform = `scale(${1 + p * 4})`;
          revealWordRef.current.style.opacity = `${p < 0.65 ? 1 : Math.max(1 - (p - 0.65) / 0.35, 0)}`;
        }
        if (revealKickRef.current) {
          revealKickRef.current.style.opacity = `${Math.max(1 - p / 0.4, 0)}`;
        }
      }
    };

    const onResize = () => {
      computeStart();
      onScroll();
    };

    computeStart();
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <>
      {/* Minimal top bar — brand slot + primary CTA, floating over the light
          intro. The visible logo is the fixed .eye-logo below; this anchor just
          reserves its resting position + keeps the top-left link clickable. */}
      <header className="toru-nav">
        <a href={APP_URL} className="toru-brand" aria-label="TORU home">
          <span className="eye-anchor" ref={anchorRef} />
        </a>
        <a href={APP_URL} className="button is-green toru-nav-cta">
          <span className="button-text">Try Demo</span>
        </a>
      </header>

      {/* Eye logo — rests in the nav slot, flies to the centre on scroll and
          rides along while its pupils roll (the eye-scroll effect). */}
      <a href={APP_URL} className="eye-logo" ref={logoRef} aria-label="TORU home">
        <EyeLogo pupilLeft={pLeftRef} pupilRight={pRightRef} />
      </a>

      {/* ── Intro — pinned statement on a light panel ─────────────────────── */}
      <section className="intro-wrapper">
        <div className="intro">
          {/* Mountain background — fills the hero (cover) and recedes/fades on scroll */}
          <div className="hero-bg" ref={heroBgRef} aria-hidden="true" />
          {/* Split headline, stacked over several lines — green serif top-left,
              black condensed bottom-right */}
          <div className="hero-edit" ref={heroTextRef}>
            <h1 className="hero-line-1">
              Why<br />climb the<span className="hero-ink">mountain</span>
            </h1>
            <span className="hero-line-2">
              when your<br />agent can?
            </span>
          </div>
        </div>
      </section>

      {/* ── Brand reveal — "Introducing TORU" masthead-style scroll reveal ── */}
      <section className="reveal" ref={revealRef}>
        <div className="reveal-inner">
          <div className="reveal-squares" aria-hidden="true">
            <span className="reveal-square s1" />
            <span className="reveal-square s2" />
            <span className="reveal-square s3" />
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
              {Array.from({ length: 20 }).map((_, i) => (
                <span className="tile" key={i} />
              ))}
            </div>
          </div>
        </section>

        {/* Two columns — cards + a preview image that slides in from the right */}
        <section className="sd-section sd-two" style={{ "--name": "--two-columns-s" } as React.CSSProperties}>
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

        {/* Subscribe — the form scales up into view */}
        <section className="sd-section sd-subscribe" style={{ "--name": "--subscribe-s" } as React.CSSProperties}>
          <div className="subscribe">
            <h2>Ready to skip the climb?</h2>
            <p>Get early access to TORU and let an agent trade like the best — while you watch the summit from the couch.</p>
            <form onSubmit={(e) => e.preventDefault()}>
              <input type="email" placeholder="Enter your email" aria-label="Email" />
              <button className="sd-btn" type="submit"><span>Get early access</span></button>
            </form>
          </div>
        </section>
      </div>

      {/* ── Tabs — dark sticky scroll story ──────────────────────────────── */}
      <section className="section_tabs">
        <div className="padding-section-large">
          <div className="tabs_height" ref={trackRef}>
            <div className="tabs_sticky-wrapper">
              <div className="tabs_container">
                <div className="tabs_component">
                  {/* Left: rotating copy + CTA */}
                  <div className="tabs_left">
                    <div className="tabs_left-top">
                      {TABS.map((tab, i) => (
                        <div className={`tabs_let-content${i === active ? " is-active" : ""}`} key={i}>
                          <h2 className="heading-style-h4 text-color-gray100">{tab.heading}</h2>
                          <div className="tabs_line" />
                          <p className="text-size-small text-color-gray400">{tab.body}</p>
                        </div>
                      ))}
                    </div>
                    <div className="tabs_left-bottom">
                      <a href={APP_URL} className="button is-green is-secondary">
                        <div className="button-text">Try Demo</div>
                        <div className="button-circle-wrapper">
                          <div className="button-icon _1"><ArrowIcon /></div>
                          <div className="button-icon _2"><ArrowIcon /></div>
                        </div>
                        <div className="button-circlee" />
                      </a>
                    </div>
                  </div>

                  {/* Right: rotating media panels */}
                  <div className="tabs_right">
                    {TABS.map((tab, i) => {
                      const Panel = tab.Panel;
                      return (
                        <div className={`tabs_video${i === active ? " is-active" : ""}`} key={i}>
                          <Panel />
                        </div>
                      );
                    })}
                    {/* Step indicator */}
                    <div className="tabs_progress">
                      {TABS.map((_, i) => (
                        <span className={`tabs_dot${i === active ? " is-active" : ""}`} key={i} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Closing strip */}
        <footer className="toru-foot">
          <a href={APP_URL} className="toru-brand">
            <span className="toru-brand-mark"><ToruMark size={22} /></span>
            <span className="toru-brand-text">TORU</span>
          </a>
          <span className="toru-foot-note">Autonomous on-chain copy-trading · Testnet demo</span>
          <a href={APP_URL} className="button is-green toru-nav-cta">
            <span className="button-text">Try Demo</span>
          </a>
        </footer>
      </section>
    </>
  );
}
