"use client";

import * as React from "react";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800;900&display=swap');

.cf-wrap {
  font-family: 'Plus Jakarta Sans', sans-serif;
  -webkit-font-smoothing: antialiased;
}

@keyframes cf-breathe {
  0% { transform: translate(-50%, -50%) scale(1); opacity: 0.6; }
  100% { transform: translate(-50%, -50%) scale(1.1); opacity: 1; }
}
@keyframes cf-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
@keyframes cf-heartbeat {
  0%, 100% { transform: scale(1); }
  15%, 45% { transform: scale(1.2); }
  30% { transform: scale(1); }
}

.cf-aurora {
  position: absolute;
  left: 50%; top: 50%;
  width: 80vw; height: 60vh;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  filter: blur(80px);
  pointer-events: none;
  z-index: 0;
  background: radial-gradient(circle at 50% 50%, rgba(21,163,116,0.15) 0%, rgba(27,178,127,0.15) 40%, transparent 70%);
  animation: cf-breathe 8s ease-in-out infinite alternate;
}

.cf-grid-bg {
  position: absolute; inset: 0; z-index: 0; pointer-events: none;
  background-size: 60px 60px;
  background-image:
    linear-gradient(to right, rgba(239,236,227,0.03) 1px, transparent 1px),
    linear-gradient(to bottom, rgba(239,236,227,0.03) 1px, transparent 1px);
  mask-image: linear-gradient(to bottom, transparent, black 30%, black 70%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, transparent, black 30%, black 70%, transparent);
}

.cf-giant-text {
  position: absolute;
  bottom: -5vh; left: 50%;
  transform: translateX(-50%);
  font-size: 26vw; line-height: 0.75;
  font-weight: 900; letter-spacing: -0.05em;
  white-space: nowrap; z-index: 0;
  pointer-events: none; user-select: none;
  color: transparent;
  -webkit-text-stroke: 1px rgba(239,236,227,0.05);
  background: linear-gradient(180deg, rgba(239,236,227,0.1) 0%, transparent 60%);
  -webkit-background-clip: text; background-clip: text;
}

.cf-marquee-bar {
  position: absolute; top: 48px; left: 0; width: 100%;
  overflow: hidden; padding: 16px 0; z-index: 10;
  transform: rotate(-2deg) scale(1.1);
  border-top: 1px solid rgba(239,236,227,0.12);
  border-bottom: 1px solid rgba(239,236,227,0.12);
  background: rgba(13,13,13,0.6);
  backdrop-filter: blur(12px);
  box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);
}
.cf-marquee-track {
  display: flex; width: max-content;
  animation: cf-marquee 40s linear infinite;
  font-size: 0.75rem; font-weight: 700;
  letter-spacing: 0.3em; text-transform: uppercase;
  color: rgba(239,236,227,0.5);
}
.cf-marquee-track span { white-space: nowrap; }
.cf-marquee-group {
  display: flex; align-items: center; gap: 48px; padding: 0 24px;
}

.cf-center {
  position: relative; z-index: 10;
  display: flex; flex: 1; flex-direction: column;
  align-items: center; justify-content: center;
  padding: 80px 24px 0; width: 100%; max-width: 960px; margin: 0 auto;
}

.cf-heading {
  font-size: clamp(2.5rem, 8vw, 6rem);
  font-weight: 900; letter-spacing: -0.04em;
  margin-bottom: 48px; text-align: center;
  background: linear-gradient(180deg, #efece3 0%, rgba(239,236,227,0.4) 100%);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
  filter: drop-shadow(0 0 20px rgba(239,236,227,0.15));
}

.cf-buttons {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; width: 100%;
}
.cf-btn-primary {
  display: inline-flex; align-items: center; gap: 12px;
  padding: 20px 40px; border-radius: 999px;
  font-weight: 700; font-size: 0.9rem;
  color: #efece3; text-decoration: none;
  background: linear-gradient(145deg, rgba(239,236,227,0.06) 0%, rgba(239,236,227,0.02) 100%);
  border: 1px solid rgba(239,236,227,0.08);
  backdrop-filter: blur(16px);
  box-shadow: 0 10px 30px -10px rgba(13,13,13,0.5), inset 0 1px 1px rgba(239,236,227,0.1);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
}
.cf-btn-primary:hover {
  background: linear-gradient(145deg, rgba(239,236,227,0.1) 0%, rgba(239,236,227,0.04) 100%);
  border-color: rgba(239,236,227,0.2);
  box-shadow: 0 20px 40px -10px rgba(13,13,13,0.7), inset 0 1px 1px rgba(239,236,227,0.2);
  transform: translateY(-2px);
}

.cf-links {
  display: flex; flex-wrap: wrap; justify-content: center;
  gap: 12px; width: 100%; margin-top: 16px;
}
.cf-link {
  padding: 12px 24px; border-radius: 999px;
  font-weight: 500; font-size: 0.8rem;
  color: rgba(239,236,227,0.5); text-decoration: none;
  background: linear-gradient(145deg, rgba(239,236,227,0.03) 0%, rgba(239,236,227,0.01) 100%);
  border: 1px solid rgba(239,236,227,0.06);
  backdrop-filter: blur(16px);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
}
.cf-link:hover {
  color: #efece3;
  background: linear-gradient(145deg, rgba(239,236,227,0.08) 0%, rgba(239,236,227,0.03) 100%);
  border-color: rgba(239,236,227,0.15);
}

.cf-bottom {
  position: relative; z-index: 20;
  width: 100%; padding: 0 24px 32px;
  display: flex; align-items: center; justify-content: space-between;
  flex-wrap: wrap; gap: 24px;
}
.cf-copyright {
  font-size: 0.6rem; font-weight: 600;
  letter-spacing: 0.15em; text-transform: uppercase;
  color: rgba(239,236,227,0.5); order: 2;
}
.cf-badge {
  display: flex; align-items: center; gap: 8px;
  padding: 12px 24px; border-radius: 999px;
  background: linear-gradient(145deg, rgba(239,236,227,0.03) 0%, rgba(239,236,227,0.01) 100%);
  border: 1px solid rgba(239,236,227,0.06);
  backdrop-filter: blur(16px); order: 1;
}
.cf-badge-label {
  font-size: 0.6rem; font-weight: 700;
  letter-spacing: 0.15em; text-transform: uppercase;
  color: rgba(239,236,227,0.5);
}
.cf-badge-value {
  font-size: 0.8rem; font-weight: 900;
  color: #15a374; margin-left: 4px;
}
.cf-scroll-top {
  width: 48px; height: 48px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(145deg, rgba(239,236,227,0.03) 0%, rgba(239,236,227,0.01) 100%);
  border: 1px solid rgba(239,236,227,0.08);
  backdrop-filter: blur(16px);
  color: rgba(239,236,227,0.5);
  cursor: pointer; order: 3;
  transition: all 0.3s ease;
}
.cf-scroll-top:hover { color: #efece3; border-color: rgba(239,236,227,0.2); }
.cf-scroll-top svg { transition: transform 0.3s ease; }
.cf-scroll-top:hover svg { transform: translateY(-3px); }

@media (max-width: 768px) {
  .cf-bottom { justify-content: center; text-align: center; }
  .cf-copyright { order: 3; width: 100%; }
  .cf-badge { order: 1; }
  .cf-scroll-top { order: 2; }
}
`;

const APP_URL = "https://aether-trader.vercel.app/";

function MarqueeItem() {
  return (
    <div className="cf-marquee-group">
      <span>Autonomous Copy-Trading</span> <span style={{ color: "#15a374" }}>✦</span>
      <span>On-Chain Execution</span> <span style={{ color: "#1bb27f" }}>✦</span>
      <span>Non-Custodial Vaults</span> <span style={{ color: "#15a374" }}>✦</span>
      <span>Live Leaderboard</span> <span style={{ color: "#1bb27f" }}>✦</span>
      <span>Built on BNB Chain</span> <span style={{ color: "#15a374" }}>✦</span>
    </div>
  );
}

export function CinematicFooter() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const giantTextRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !wrapperRef.current) return;

    const ctx = gsap.context(() => {
      gsap.fromTo(
        giantTextRef.current,
        { y: "10vh", scale: 0.8, opacity: 0 },
        {
          y: "0vh", scale: 1, opacity: 1,
          ease: "power1.out",
          scrollTrigger: { trigger: wrapperRef.current, start: "top bottom", end: "top 20%", scrub: 1 },
        }
      );

      gsap.fromTo(
        headingRef.current,
        { y: 60, opacity: 0 },
        {
          y: 0, opacity: 1,
          ease: "power3.out",
          scrollTrigger: { trigger: wrapperRef.current, start: "top bottom", end: "top 30%", scrub: 1 },
        }
      );

      gsap.fromTo(
        linksRef.current,
        { y: 40, opacity: 0 },
        {
          y: 0, opacity: 1,
          ease: "power3.out",
          scrollTrigger: { trigger: wrapperRef.current, start: "top 80%", end: "top 20%", scrub: 1 },
        }
      );
    }, wrapperRef);

    return () => ctx.revert();
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <div
        ref={wrapperRef}
        style={{ position: "relative", height: "100vh", width: "100%", clipPath: "polygon(0% 0, 100% 0%, 100% 100%, 0 100%)" }}
      >
        <footer
          className="cf-wrap"
          style={{
            position: "fixed", bottom: 0, left: 0,
            display: "flex", flexDirection: "column", justifyContent: "space-between",
            height: "100vh", width: "100%", overflow: "hidden",
            backgroundColor: "#0d0d0d", color: "#efece3",
          }}
        >
          <div className="cf-aurora" />
          <div className="cf-grid-bg" />
          <div className="cf-giant-text" ref={giantTextRef}>TORU</div>

          {/* Marquee */}
          <div className="cf-marquee-bar">
            <div className="cf-marquee-track">
              <MarqueeItem />
              <MarqueeItem />
            </div>
          </div>

          {/* Center content */}
          <div className="cf-center">
            <h2 className="cf-heading" ref={headingRef}>Ready to skip the climb?</h2>

            <div ref={linksRef} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "24px", width: "100%" }}>
              <div className="cf-buttons">
                <a href={APP_URL} className="cf-btn-primary">
                  <svg width="24" height="18" viewBox="0 0 520 400" fill="#15a374">
                    <path fillRule="evenodd" d="M 35 230 A 125 125 0 0 0 260 305 A 125 125 0 0 0 485 230 C 485 190 460 160 430 145 L 260 55 C 230 40 190 90 160 90 C 140 90 110 40 90 40 C 60 40 35 130 35 230 Z M 250 230 A 90 90 0 1 0 70 230 A 90 90 0 1 0 250 230 Z M 450 230 A 90 90 0 1 0 270 230 A 90 90 0 1 0 450 230 Z M 227 265 A 32 32 0 1 0 163 265 A 32 32 0 1 0 227 265 Z M 427 265 A 32 32 0 1 0 363 265 A 32 32 0 1 0 427 265 Z" />
                  </svg>
                  Try Demo
                </a>
              </div>

              <div className="cf-links">
                <a href="#" className="cf-link">Documentation</a>
                <a href="#" className="cf-link">Leaderboard</a>
                <a href="#" className="cf-link">How it Works</a>
              </div>
            </div>
          </div>

          {/* Bottom bar */}
          <div className="cf-bottom">
            <div className="cf-copyright">© 2026 TORU. Autonomous on-chain copy-trading.</div>
            <div className="cf-badge">
              <span className="cf-badge-label">Built on</span>
              <span className="cf-badge-value">BNB Chain</span>
            </div>
            <button className="cf-scroll-top" onClick={scrollToTop}>
              <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
            </button>
          </div>
        </footer>
      </div>
    </>
  );
}
