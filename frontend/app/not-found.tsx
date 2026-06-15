"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/* ─── Particle canvas ───────────────────────────────────────────────────────── */
function ParticleCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let W = (canvas.width = window.innerWidth);
    let H = (canvas.height = window.innerHeight);

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);

    type Particle = {
      x: number; y: number;
      vx: number; vy: number;
      r: number; alpha: number;
      decay: number;
    };

    const particles: Particle[] = Array.from({ length: 60 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.4 + 0.1,
      decay: Math.random() * 0.002 + 0.001,
    }));

    const tick = () => {
      ctx.clearRect(0, 0, W, H);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= p.decay;
        if (p.alpha <= 0) {
          Object.assign(p, {
            x: Math.random() * W,
            y: Math.random() * H,
            alpha: Math.random() * 0.4 + 0.1,
          });
        }
        if (p.x < 0) p.x = W;
        if (p.x > W) p.x = 0;
        if (p.y < 0) p.y = H;
        if (p.y > H) p.y = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(232,184,72,${p.alpha})`;
        ctx.fill();
      }
      animId = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}

/* ─── Glitch text ───────────────────────────────────────────────────────────── */
function GlitchNumber() {
  return (
    <div className="nf-glitch-wrapper" aria-label="404">
      <span className="nf-glitch" data-text="404">404</span>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────────────────── */
export default function NotFound() {
  return (
    <>
      <style>{`
        /* ── layout ── */
        .nf-root {
          position: relative;
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0;
          overflow: hidden;
          background: var(--background);
          color: var(--foreground);
          font-family: var(--font-jakarta, 'Plus Jakarta Sans', Arial, sans-serif);
          padding: 2rem;
          text-align: center;
          z-index: 1;
        }

        /* ── ambient orb ── */
        .nf-orb {
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: min(700px, 90vw);
          height: min(700px, 90vw);
          background: radial-gradient(
            ellipse at center,
            rgba(232,184,72,0.13) 0%,
            rgba(232,184,72,0.04) 40%,
            transparent 70%
          );
          border-radius: 50%;
          pointer-events: none;
          z-index: 0;
          animation: nf-pulse 4s ease-in-out infinite;
        }

        @keyframes nf-pulse {
          0%, 100% { transform: translate(-50%, -50%) scale(1);   opacity: 1; }
          50%       { transform: translate(-50%, -50%) scale(1.08); opacity: 0.7; }
        }

        /* ── glitch 404 ── */
        .nf-glitch-wrapper {
          position: relative;
          z-index: 2;
          animation: nf-fadein 0.6s var(--fluid-easing, ease) both;
        }

        .nf-glitch {
          display: block;
          font-size: clamp(120px, 20vw, 220px);
          font-weight: 800;
          letter-spacing: -0.04em;
          line-height: 1;
          background: linear-gradient(135deg, #e8b848 0%, #f5d07a 50%, #c9952e 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          position: relative;
          user-select: none;
        }

        .nf-glitch::before,
        .nf-glitch::after {
          content: attr(data-text);
          position: absolute;
          inset: 0;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .nf-glitch::before {
          background: linear-gradient(135deg, #ff6b6b, #ff4444);
          animation: nf-glitch-a 3.5s infinite;
          clip-path: polygon(0 0, 100% 0, 100% 40%, 0 40%);
        }

        .nf-glitch::after {
          background: linear-gradient(135deg, #4ecdc4, #44b3a8);
          animation: nf-glitch-b 3.5s infinite;
          clip-path: polygon(0 60%, 100% 60%, 100% 100%, 0 100%);
        }

        @keyframes nf-glitch-a {
          0%,  87%, 100% { transform: translate(0);       opacity: 0; }
          88%            { transform: translate(-3px, 1px); opacity: 1; }
          90%            { transform: translate(3px, -1px); opacity: 1; }
          92%            { transform: translate(-1px, 2px); opacity: 1; }
          94%            { transform: translate(0);         opacity: 0; }
        }

        @keyframes nf-glitch-b {
          0%,  90%, 100% { transform: translate(0);        opacity: 0; }
          91%            { transform: translate(3px, -2px); opacity: 1; }
          93%            { transform: translate(-3px, 1px); opacity: 1; }
          95%            { transform: translate(1px, -1px); opacity: 1; }
          97%            { transform: translate(0);         opacity: 0; }
        }

        /* ── copy ── */
        .nf-eyebrow {
          z-index: 2;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: var(--accent, #e8b848);
          margin-top: 28px;
          opacity: 0;
          animation: nf-fadein 0.5s var(--fluid-easing, ease) 0.2s both;
        }

        .nf-headline {
          z-index: 2;
          font-size: clamp(22px, 3.5vw, 36px);
          font-weight: 700;
          color: var(--foreground);
          margin-top: 12px;
          letter-spacing: -0.02em;
          opacity: 0;
          animation: nf-fadein 0.5s var(--fluid-easing, ease) 0.35s both;
        }

        .nf-body {
          z-index: 2;
          font-size: 15px;
          color: var(--muted, #a1a1aa);
          max-width: 380px;
          line-height: 1.65;
          margin-top: 12px;
          opacity: 0;
          animation: nf-fadein 0.5s var(--fluid-easing, ease) 0.5s both;
        }

        /* ── CTA ── */
        .nf-actions {
          display: flex;
          gap: 12px;
          margin-top: 36px;
          flex-wrap: wrap;
          justify-content: center;
          z-index: 2;
          opacity: 0;
          animation: nf-fadein 0.5s var(--fluid-easing, ease) 0.65s both;
        }

        .nf-btn-primary {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 13px 28px;
          border-radius: 10px;
          background: var(--accent, #e8b848);
          color: #18181b;
          font-size: 14px;
          font-weight: 700;
          letter-spacing: -0.01em;
          text-decoration: none;
          border: none;
          cursor: pointer;
          transition: background 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
          box-shadow: 0 0 0 0 rgba(232,184,72,0);
        }

        .nf-btn-primary:hover {
          background: #edc564;
          transform: translateY(-2px);
          box-shadow: 0 8px 24px -4px rgba(232,184,72,0.35);
        }

        .nf-btn-primary:active {
          transform: translateY(0);
        }

        .nf-btn-ghost {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 13px 24px;
          border-radius: 10px;
          background: transparent;
          color: var(--muted, #a1a1aa);
          font-size: 14px;
          font-weight: 600;
          text-decoration: none;
          border: 1px solid var(--border, #27272a);
          cursor: pointer;
          transition: border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
        }

        .nf-btn-ghost:hover {
          border-color: var(--accent, #e8b848);
          color: var(--foreground);
          transform: translateY(-2px);
        }

        /* ── divider ── */
        .nf-divider {
          z-index: 2;
          width: 48px;
          height: 1px;
          background: linear-gradient(90deg, transparent, var(--accent, #e8b848), transparent);
          margin: 36px auto 0;
          opacity: 0;
          animation: nf-fadein 0.5s ease 0.8s both;
        }

        /* ── breadcrumb hint ── */
        .nf-hint {
          z-index: 2;
          font-size: 12px;
          color: var(--subtle, #71717a);
          margin-top: 20px;
          font-family: var(--font-geist-mono, monospace);
          letter-spacing: 0.04em;
          opacity: 0;
          animation: nf-fadein 0.5s ease 0.95s both;
        }

        .nf-hint span {
          color: var(--accent, #e8b848);
        }

        /* ── fade-in keyframe ── */
        @keyframes nf-fadein {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <ParticleCanvas />
      <div className="nf-orb" />

      <main className="nf-root">
        <GlitchNumber />

        <p className="nf-eyebrow">Page not found</p>

        <h1 className="nf-headline">You&rsquo;ve drifted off the chart</h1>

        <p className="nf-body">
          The page you&rsquo;re looking for doesn&rsquo;t exist or may have moved.
          Head back to the dashboard to keep trading.
        </p>

        <div className="nf-actions">
          <Link href="/" className="nf-btn-primary">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2L2 8l6 6M2 8h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back to Dashboard
          </Link>
          <Link href="/traders" className="nf-btn-ghost">
            Browse Traders
          </Link>
        </div>

        <div className="nf-divider" />

        <p className="nf-hint">
          error&nbsp;<span>404</span>&nbsp;·&nbsp;aether&nbsp;·&nbsp;mantle
        </p>
      </main>
    </>
  );
}
