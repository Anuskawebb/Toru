"use client";

import React, { useState, useEffect, useRef } from "react";

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

  // SVG Stencil gradient animation elements
  const circleRef = useRef<SVGCircleElement>(null);
  const blurFilterRef = useRef<SVGFEGaussianBlurElement>(null);
  const stop1Ref = useRef<SVGStopElement>(null);
  const stop2Ref = useRef<SVGStopElement>(null);

  useEffect(() => {
    let animationFrameId: number;
    const startTime = Date.now();

    // Physics positions (starting pooled at left 'A' / 'I')
    let curX = 380;
    let curRadius = 240;
    let curBlur = 48;
    let curCoreOpacity = 1.0;
    let curEdgeOpacity = 0.9;

    const tick = () => {
      const elapsed = (Date.now() - startTime) % 12000;

      let targetX = 380;
      let targetRadius = 240;
      let targetBlur = 48;
      let targetCoreOpacity = 1.0;
      let targetEdgeOpacity = 0.9;

      // Chronological Animation Timeline
      if (elapsed >= 0 && elapsed < 2000) {
        // 00:00 - 00:02 Left Anchor (Pooled behind 'A' and 'I')
        targetX = 380;
        targetRadius = 240;
        targetBlur = 48;
        targetCoreOpacity = 1.0;
        targetEdgeOpacity = 0.95;
      } else if (elapsed >= 2000 && elapsed < 5000) {
        // 00:02 - 00:05 Horizontal liquid drift to the right (towards 'S')
        targetX = 1120;
        targetRadius = 240;
        targetBlur = 50;
        targetCoreOpacity = 1.0;
        targetEdgeOpacity = 0.95;
      } else if (elapsed >= 5000 && elapsed < 6000) {
        // 00:05 - 00:06 Right Peak (Settle behind 'S' in electric-orange)
        targetX = 1120;
        targetRadius = 240;
        targetBlur = 48;
        targetCoreOpacity = 1.0;
        targetEdgeOpacity = 0.95;
      } else if (elapsed >= 6000 && elapsed < 6200) {
        // 00:06 - 00:06.2 Sudden blackout/pull away
        targetX = 1120;
        targetRadius = 120;
        targetBlur = 24;
        targetCoreOpacity = 0.0;
        targetEdgeOpacity = 0.0;
      } else if (elapsed >= 6200 && elapsed < 7200) {
        // 00:06.2 - 00:07.2 Rapid bloom reset from center-left
        const bloomProgress = (elapsed - 6200) / 1000; // 0 to 1
        targetX = 380;
        // Start massive and highly diffused, then shrink back
        targetRadius = 600 - bloomProgress * 360;
        targetBlur = 160 - bloomProgress * 112;
        targetCoreOpacity = Math.min(1.0, bloomProgress * 1.6);
        targetEdgeOpacity = Math.min(0.95, bloomProgress * 1.6);
      } else {
        // 00:07.2 - 00:12 Stabilizer at starting position
        targetX = 380;
        targetRadius = 240;
        targetBlur = 48;
        targetCoreOpacity = 1.0;
        targetEdgeOpacity = 0.95;
      }

      // Physics constants (heavy-inertia easing values)
      const easingX = 0.022; // Slow glide
      const easingRadius = 0.035;
      const easingBlur = 0.035;
      const easingOpacity = 0.07;

      curX += (targetX - curX) * easingX;
      curRadius += (targetRadius - curRadius) * easingRadius;
      curBlur += (targetBlur - curBlur) * easingBlur;
      curCoreOpacity += (targetCoreOpacity - curCoreOpacity) * easingOpacity;
      curEdgeOpacity += (targetEdgeOpacity - curEdgeOpacity) * easingOpacity;

      // Directly update DOM elements for maximum rendering speed and 60fps consistency
      if (circleRef.current) {
        circleRef.current.setAttribute("cx", curX.toFixed(2));
        circleRef.current.setAttribute("r", curRadius.toFixed(2));
      }
      if (blurFilterRef.current) {
        blurFilterRef.current.setAttribute("stdDeviation", curBlur.toFixed(2));
      }
      if (stop1Ref.current) {
        stop1Ref.current.setAttribute("stop-opacity", curCoreOpacity.toFixed(3));
      }
      if (stop2Ref.current) {
        stop2Ref.current.setAttribute("stop-opacity", curEdgeOpacity.toFixed(3));
      }

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  return (
    <>
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
            <span className="logo-text">Aionis</span>
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



      </main>


      {/* Footer Row — floats just above the AIONIS stencil */}
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

      {/* Massive AIONIS Stencil & Animation Layer */}
      <div className="midu-stencil-container">
        <svg
          className="stencil-svg"
          viewBox="0 0 1400 550"
          preserveAspectRatio="xMidYMax slice"
        >
          <defs>
            {/* The SVG Stencil Mask: Letters are white, background is black */}
            <mask id="midu-mask" maskUnits="userSpaceOnUse">
              <rect width="1400" height="550" fill="black" />
              <text
                x="50%"
                y="465"
                textAnchor="middle"
                className="stencil-text"
                fontSize="260"
              >
                AIONIS
              </text>
            </mask>

            {/* Glowing radial gradient with golden yellow core and amber edges */}
            <radialGradient id="liquid-gradient" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#edc564" ref={stop1Ref} stopOpacity="1" />
              <stop offset="55%" stopColor="#e8b848" ref={stop2Ref} stopOpacity="0.95" />
              <stop offset="100%" stopColor="#e8b848" stopOpacity="0" />
            </radialGradient>

            {/* High Gaussian Blur filter to blend the radial gradient into a smoke/fluid light blob */}
            <filter id="glow-blur" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur ref={blurFilterRef} stdDeviation="60" />
            </filter>
          </defs>

          {/* This group contains the glowing fluid light masked by the letters */}
          <g mask="url(#midu-mask)">
            {/* Base layer background */}
            <rect width="1400" height="550" fill="#000000" />
            
            {/* Animated liquid light circle with blur filter */}
            <circle
              ref={circleRef}
              cx="380"
              cy="260"
              r="240"
              fill="url(#liquid-gradient)"
              filter="url(#glow-blur)"
            />
          </g>
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

      {/* Why Aionis */}
      <section className="content-section features">
        <h2 className="section-title">Why Aionis</h2>
        <div className="features-grid">
          <div className="feature-card">
            <h3>Non-custodial vaults</h3>
            <p>Your funds stay in a smart contract vault you control — Aionis never takes custody of your assets.</p>
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
        <span>© 2026 Aionis · Built on Mantle Sepolia Testnet</span>
        <div className="site-footer-links">
          <a href="https://aionis-agent.vercel.app/traders">Leaderboard</a>
          <a href="https://aionis-agent.vercel.app/watcher">Live Activity</a>
          <a href="https://aionis-agent.vercel.app/">Launch App</a>
        </div>
      </footer>
    </>
  );
}
