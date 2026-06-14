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

      {/* How It Works */}
      <section className="content-section how-it-works">
        <h2 className="section-title">How it works</h2>
        <div className="steps-grid">
          <div className="step-card">
            <span className="step-number">01</span>
            <h3>Connect your wallet</h3>
            <p>Sign in with email or wallet via Privy — fully non-custodial, deployed on the Mantle Sepolia Testnet.</p>
          </div>
          <div className="step-card">
            <span className="step-number">02</span>
            <h3>Pick a leader to copy</h3>
            <p>Browse the leaderboard, compare win rates and 24h volume, and choose a trader to follow.</p>
          </div>
          <div className="step-card">
            <span className="step-number">03</span>
            <h3>Your agent trades on-chain</h3>
            <p>Deposit aUSD into your vault and let your agent mirror the leader&apos;s trades in real time, within the risk limits you set.</p>
          </div>
        </div>
      </section>

      {/* Why Aether */}
      <section className="content-section features">
        <h2 className="section-title">Why Aether</h2>
        <div className="features-grid">
          <div className="feature-card">
            <h3>Non-custodial vaults</h3>
            <p>Your funds stay in a smart contract vault you control — Aether never takes custody of your assets.</p>
          </div>
          <div className="feature-card">
            <h3>Real-time execution</h3>
            <p>A keeper watches leader trades and mirrors them to your vault on-chain, with execution latency tracked end-to-end.</p>
          </div>
          <div className="feature-card">
            <h3>Configurable risk limits</h3>
            <p>Set max trade size, daily loss limits, and allowed tokens per agent — your agent will never exceed them.</p>
          </div>
          <div className="feature-card">
            <h3>Fully transparent</h3>
            <p>Every trade, skip, and P&amp;L update is recorded on-chain and viewable in the live activity feed.</p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="content-section cta-section">
        <h2>Ready to put your aUSD to work?</h2>
        <a
          href="https://aionis-agent.vercel.app/"
          className="cta-button interactive-element"
          style={{ display: "inline-block", textDecoration: "none" }}
        >
          Try Demo
        </a>
      </section>

      {/* Footer */}
      <footer className="site-footer">
        <span>© 2026 Aether · Built on Mantle Sepolia Testnet</span>
        <div className="site-footer-links">
          <a href="https://aionis-agent.vercel.app/traders">Leaderboard</a>
          <a href="https://aionis-agent.vercel.app/watcher">Live Activity</a>
          <a href="https://aionis-agent.vercel.app/">Launch App</a>
        </div>
      </footer>
    </>
  );
}
