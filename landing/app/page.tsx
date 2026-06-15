"use client";

import React, { useState, useEffect } from "react";
import Aurora from "@/components/ui/Aurora";

// Micro sun/asterisk icon
const SunAsteriskIcon = () => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 10 10"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: "inline-block", verticalAlign: "middle" }}
  >
    <circle cx="5" cy="5" r="1.5" fill="currentColor" />
    <line x1="5" y1="1" x2="5" y2="3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="5" y1="7" x2="5" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="1" y1="5" x2="3" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="7" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="2.2" y1="2.2" x2="3.6" y2="3.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <line x1="6.4" y1="6.4" x2="7.8" y2="7.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <line x1="7.8" y1="2.2" x2="6.4" y2="3.6" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    <line x1="3.6" y1="6.4" x2="2.2" y2="7.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
  </svg>
);

// Bento menu icon (4 small squares forming a larger square)
const BentoIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect x="0" y="0" width="5" height="5" rx="1" fill="currentColor" />
    <rect x="7" y="0" width="5" height="5" rx="1" fill="currentColor" />
    <rect x="0" y="7" width="5" height="5" rx="1" fill="currentColor" />
    <rect x="7" y="7" width="5" height="5" rx="1" fill="currentColor" />
  </svg>
);

// Minimal downward arrow
const DownArrowIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ display: "inline-block", verticalAlign: "middle" }}
  >
    <path
      d="M6 2V10M6 10L2.5 6.5M6 10L9.5 6.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Plus / minus glyph for the FAQ accordion rows
const PlusMinusIcon = ({ open }: { open: boolean }) => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ flexShrink: 0 }}
  >
    <line x1="2" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <line
      x1="8"
      y1="2"
      x2="8"
      y2="14"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      style={{
        transformOrigin: "center",
        transform: open ? "scaleY(0)" : "scaleY(1)",
        transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    />
  </svg>
);

// Single expandable FAQ row (midu-style accordion)
function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`faq-item${open ? " open" : ""}`}>
      <button
        className="faq-question interactive-element"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>{question}</span>
        <PlusMinusIcon open={open} />
      </button>
      <div className="faq-answer-wrap" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
        <div className="faq-answer-inner">
          <p>{answer}</p>
        </div>
      </div>
    </div>
  );
}

// Live local time display, detected from the visitor's timezone (hydration-safe)
function LocalTime() {
  const [timeStr, setTimeStr] = useState<string>("");
  const [zoneLabel, setZoneLabel] = useState<string>("");

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const city = timeZone.split("/").pop()?.replace(/_/g, " ") ?? timeZone;
    setZoneLabel(city);

    const updateTime = () => {
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      }).format(new Date());
      setTimeStr(formatted);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return <span>{timeStr ? `${timeStr} ${zoneLabel}` : "10:50 AM"}</span>;
}

export default function Home() {

  return (
    <>
      {/* Aurora background — fixed behind the whole page. The wrapper is sized
          explicitly (inset:0) since the app has no Tailwind, so Aurora's
          internal `w-full h-full` resolves against a real size. */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          // Flip vertically so the aurora sits at the bottom, black at the top.
          transform: "scaleY(-1)",
        }}
      >
        <Aurora
          colorStops={["#C9B8F3", "#9D7BE6", "#5B2BD6"]}
          blend={0.5}
          amplitude={1.6}
          speed={0.5}
        />
      </div>

      {/* Global Grain/Noise Overlay */}
      <div className="noise-overlay" />

      <section className="hero-section">

      {/* Main Viewport Safe Zone */}
      <main className="viewport-layout" id="main-viewport">
        
        {/* Header Row */}
        <header className="header-row">
          {/* Logo (Top-Left) */}
          <div className="logo-container interactive-element" id="header-logo">
            <svg
              width="36"
              height="28"
              viewBox="0 0 520 400"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ color: "#ffffff" }}
            >
              <path
                fill="currentColor"
                fillRule="evenodd"
                d="M 35 230 A 125 125 0 0 0 260 305 A 125 125 0 0 0 485 230 C 485 190 460 160 430 145 L 260 55 C 230 40 190 90 160 90 C 140 90 110 40 90 40 C 60 40 35 130 35 230 Z M 250 230 A 90 90 0 1 0 70 230 A 90 90 0 1 0 250 230 Z M 450 230 A 90 90 0 1 0 270 230 A 90 90 0 1 0 450 230 Z M 227 265 A 32 32 0 1 0 163 265 A 32 32 0 1 0 227 265 Z M 427 265 A 32 32 0 1 0 363 265 A 32 32 0 1 0 427 265 Z"
              />
            </svg>
            <span className="logo-text">Aether</span>
          </div>



          {/* Primary CTA (Top-Right) */}
          <a
            href="https://aionis-agent.vercel.app/"
            className="cta-button interactive-element"
            id="contact-button"
            style={{ display: "inline-block", textDecoration: "none" }}
          >
            Try Demo
          </a>
        </header>

        {/* Hero tagline — upper-right, mirrors the reference's placement/style */}
        <div className="hero-wrapper">
          <h1 className="hero-text">
            For those who want to trade like the best
            without ever watching the charts.
          </h1>
        </div>

      </main>


      {/* Footer Row — floats just above the AETHER stencil */}
      <footer className="footer-row footer-above-stencil interactive-element">
        <div className="footer-left" id="footer-left-status">
          <SunAsteriskIcon />
          <span className="live-time-wrapper">
            <LocalTime />
          </span>
        </div>
        <div className="footer-right interactive-element" id="scroll-indicator">
          <span>Scroll to explore</span>
          <DownArrowIcon />
        </div>
      </footer>

      {/* Massive AETHER wordmark — a color-dodge stencil: the letters stay pure
          black where the backdrop is dark, and bloom bright only where the aurora
          light passes behind them (the MIDU reveal behaviour). */}
      <div className="midu-stencil-container">
        <svg
          className="stencil-svg"
          viewBox="0 0 1400 550"
          preserveAspectRatio="xMidYMax slice"
        >
          <defs>
            {/* Opaque grey fill drives the color-dodge: brighter grey = stronger
                bloom where light hits. Heavier toward the baseline (where the
                flipped aurora sits) so the bottoms of the letters light up. */}
            <linearGradient id="aether-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2c2c2c" />
              <stop offset="100%" stopColor="#8a8a8a" />
            </linearGradient>
          </defs>

          <text
            x="50%"
            y="525"
            textAnchor="middle"
            className="stencil-text"
            fontSize="345"
            fill="url(#aether-fill)"
          >
            AETHER
          </text>
        </svg>
      </div>

      </section>

      {/* ───────────────────────── Below the hero (midu-style) ───────────────────────── */}

      {/* Philosophy / About — large-type statement band */}
      <section className="m-section m-about">
        <span className="m-eyebrow">( About )</span>
        <h2 className="m-statement">
          Aether is built for people who want the returns of the best traders —{" "}
          <span className="m-dim">without the screens, the stress, or the 3&nbsp;a.m. price checks.</span>{" "}
          Your capital, your rules, an autonomous agent that does the watching for you.
        </h2>
      </section>

      {/* How it works — numbered steps */}
      <section className="m-section m-steps">
        <div className="m-section-head">
          <span className="m-eyebrow">( How it works )</span>
          <h3 className="m-heading">Three steps from sign-in to on-chain copy-trading.</h3>
        </div>
        <div className="m-steps-grid">
          <div className="m-step">
            <span className="m-step-num">01</span>
            <h4>Connect your wallet</h4>
            <p>Sign in with email or wallet via Privy — fully non-custodial, deployed on the Mantle Sepolia Testnet.</p>
          </div>
          <div className="m-step">
            <span className="m-step-num">02</span>
            <h4>Pick a leader to copy</h4>
            <p>Browse the leaderboard, compare win rates and 24h volume, and choose a trader to follow.</p>
          </div>
          <div className="m-step">
            <span className="m-step-num">03</span>
            <h4>Your agent trades on-chain</h4>
            <p>Deposit aUSD into your vault and let your agent mirror the leader&apos;s trades in real time, within the risk limits you set.</p>
          </div>
        </div>
      </section>

      {/* Stats / social-proof band */}
      <section className="m-section m-stats">
        <div className="m-stats-grid">
          <div className="m-stat">
            <span className="m-stat-value">100%</span>
            <span className="m-stat-label">Non-custodial</span>
          </div>
          <div className="m-stat">
            <span className="m-stat-value">24/7</span>
            <span className="m-stat-label">Autonomous execution</span>
          </div>
          <div className="m-stat">
            <span className="m-stat-value">On-chain</span>
            <span className="m-stat-label">Every trade & P&amp;L update</span>
          </div>
          <div className="m-stat">
            <span className="m-stat-value">3 steps</span>
            <span className="m-stat-label">From sign-in to copy-trading</span>
          </div>
        </div>
      </section>

      {/* Why Aether — service/feature cards */}
      <section className="m-section m-features">
        <div className="m-section-head">
          <span className="m-eyebrow">( Why Aether )</span>
          <h3 className="m-heading">Built so your money never leaves your control.</h3>
        </div>
        <div className="m-features-grid">
          <div className="m-feature">
            <span className="m-feature-index">01</span>
            <div>
              <h4>Non-custodial vaults</h4>
              <p>Your funds stay in a smart-contract vault you control — Aether never takes custody of your assets.</p>
            </div>
          </div>
          <div className="m-feature">
            <span className="m-feature-index">02</span>
            <div>
              <h4>Real-time execution</h4>
              <p>A keeper watches leader trades and mirrors them to your vault on-chain, with execution latency tracked end-to-end.</p>
            </div>
          </div>
          <div className="m-feature">
            <span className="m-feature-index">03</span>
            <div>
              <h4>Configurable risk limits</h4>
              <p>Set max trade size, daily loss limits, and allowed tokens per agent — your agent will never exceed them.</p>
            </div>
          </div>
          <div className="m-feature">
            <span className="m-feature-index">04</span>
            <div>
              <h4>Fully transparent</h4>
              <p>Every trade, skip, and P&amp;L update is recorded on-chain and viewable in the live activity feed.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Built on — tech strip */}
      <section className="m-section m-stack">
        <span className="m-eyebrow">( Built on )</span>
        <div className="m-stack-row">
          <span>Mantle</span>
          <span>FusionX</span>
          <span>Privy</span>
          <span>ERC-8004</span>
          <span>aUSD</span>
        </div>
      </section>

      {/* FAQ — accordion */}
      <section className="m-section m-faq">
        <div className="m-faq-head">
          <span className="m-eyebrow">( FAQ )</span>
          <h3 className="m-heading">Answers before you ask.</h3>
        </div>
        <div className="m-faq-list">
          <FaqItem
            question="Is Aether custodial?"
            answer="No. Your funds stay in a smart-contract vault that only you control. Aether never takes custody of your assets — it can only execute trades within the risk limits you set."
          />
          <FaqItem
            question="Which network does it run on?"
            answer="Aether is deployed on the Mantle Sepolia Testnet. You trade with test aUSD, so no real funds are ever at risk during the demo."
          />
          <FaqItem
            question="Can I limit how much my agent risks?"
            answer="Yes. Set a maximum trade size, a daily loss limit, and the list of allowed tokens per agent. Your agent will never place a trade that exceeds them."
          />
          <FaqItem
            question="How are leader trades executed?"
            answer="A keeper watches the leader's on-chain activity and mirrors each trade into your vault via FusionX, with end-to-end execution latency tracked the whole way."
          />
          <FaqItem
            question="Can I see everything my agent does?"
            answer="Every trade, skip, and P&L update is recorded on-chain and streamed to the live activity feed — fully transparent, nothing hidden."
          />
        </div>
      </section>

      {/* CTA */}
      <section className="m-section m-cta">
        <span className="m-eyebrow">( Get started )</span>
        <h2 className="m-cta-title">Ready to put your aUSD to work?</h2>
        <a
          href="https://aionis-agent.vercel.app/"
          className="cta-button interactive-element"
          style={{ display: "inline-block", textDecoration: "none" }}
        >
          Try Demo
        </a>
      </section>

      {/* Footer — multi-column */}
      <footer className="m-footer">
        <div className="m-footer-top">
          <div className="m-footer-brand">
            <div className="m-footer-logo">
              <svg
                width="32"
                height="25"
                viewBox="0 0 520 400"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                style={{ color: "#ffffff" }}
              >
                <path
                  fill="currentColor"
                  fillRule="evenodd"
                  d="M 35 230 A 125 125 0 0 0 260 305 A 125 125 0 0 0 485 230 C 485 190 460 160 430 145 L 260 55 C 230 40 190 90 160 90 C 140 90 110 40 90 40 C 60 40 35 130 35 230 Z M 250 230 A 90 90 0 1 0 70 230 A 90 90 0 1 0 250 230 Z M 450 230 A 90 90 0 1 0 270 230 A 90 90 0 1 0 450 230 Z M 227 265 A 32 32 0 1 0 163 265 A 32 32 0 1 0 227 265 Z M 427 265 A 32 32 0 1 0 363 265 A 32 32 0 1 0 427 265 Z"
                />
              </svg>
              <span>Aether</span>
            </div>
            <p>Trade like the best without ever watching the charts.</p>
          </div>
          <div className="m-footer-cols">
            <div className="m-footer-col">
              <span className="m-footer-col-title">Product</span>
              <a href="https://aionis-agent.vercel.app/">Launch App</a>
              <a href="https://aionis-agent.vercel.app/traders">Leaderboard</a>
              <a href="https://aionis-agent.vercel.app/watcher">Live Activity</a>
            </div>
            <div className="m-footer-col">
              <span className="m-footer-col-title">Built on</span>
              <a href="https://www.mantle.xyz/" target="_blank" rel="noreferrer">Mantle</a>
              <a href="https://www.privy.io/" target="_blank" rel="noreferrer">Privy</a>
              <span className="m-footer-static">ERC-8004 Identity</span>
            </div>
            <div className="m-footer-col">
              <span className="m-footer-col-title">Get started</span>
              <a href="https://aionis-agent.vercel.app/">Try Demo</a>
            </div>
          </div>
        </div>
        <div className="m-footer-bottom">
          <span>© 2026 Aether · Built on Mantle Sepolia Testnet</span>
          <span>Testnet demo — no real funds at risk.</span>
        </div>
      </footer>
    </>
  );
}
