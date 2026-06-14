"use client"

import { useEffect, useMemo, useState } from "react"
import { Dithering } from "@paper-design/shaders-react"

// Helper: read system dark-mode preference
function getSystemPrefersDark(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
}

type ThemeMode = "light" | "dark" | "system"

interface PaperDesignBackgroundProps {
  // Tailwind theme control: "system" will sync with OS
  themeMode?: ThemeMode
  // Visual intensity 0..1
  intensity?: number
  // Enable subtle parallax mouse move
  parallax?: boolean
  // Optional className to adjust z-index or positioning
  className?: string
}

export function PaperDesignBackground({
  themeMode = "dark",
  intensity = 0.85,
  parallax = true,
  className = "",
}: PaperDesignBackgroundProps) {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (themeMode === "dark") return true
    if (themeMode === "light") return false
    return getSystemPrefersDark()
  })

  // Keep Tailwind dark class in sync
  useEffect(() => {
    const root = document.documentElement
    const applyDark = (dark: boolean) => {
      root.classList.toggle("dark", dark)
    }

    if (themeMode === "system") {
      const mq = window.matchMedia("(prefers-color-scheme: dark)")
      const handler = (e: MediaQueryListEvent) => {
        setIsDark(e.matches)
        applyDark(e.matches)
      }
      applyDark(getSystemPrefersDark())
      mq.addEventListener("change", handler)
      return () => mq.removeEventListener("change", handler)
    } else {
      setIsDark(themeMode === "dark")
      applyDark(themeMode === "dark")
    }
  }, [themeMode])

  // Derived colors and speeds for light/dark.
  // Palette is tuned to the crimson "MIDU"-style reference: a deep red bloom
  // blooming out of black, with a fine dithered grain riding on top.
  const config = useMemo(() => {
    const clamp = (v: number, min = 0, max = 1) => Math.max(min, Math.min(max, v))
    const t = clamp(intensity)

    if (isDark) {
      return {
        // Original component settings — transparent back over pure black bg,
        // just recoloured red. Surround stays pure black via the vignette.
        back: "#00000000",
        front: mix("#7A0C0C", "#F12B2B", t * 0.5), // deep crimson -> hot red ink
        bg: "#000000",
        speed: 0.28 + t * 0.35,
        px: 1, // finest grid -> smooth gradient-light bloom
        scale: 1.05 + t * 0.15,
        // Subtle steady red bloom (original component intensity, recoloured).
        glow:
          "radial-gradient(60% 40% at 50% 40%, rgba(255,70,70,0.14), transparent 70%)",
      }
    } else {
      return {
        back: "#00000000",
        front: mix("#B01414", "#FF5A5A", t * 0.5),
        bg: "#000000",
        speed: 0.22 + t * 0.28,
        px: 1,
        scale: 1.03 + t * 0.12,
        glow:
          "radial-gradient(60% 40% at 50% 40%, rgba(255,110,110,0.12), transparent 70%)",
      }
    }
  }, [isDark, intensity])

  // Optional mouse parallax
  useEffect(() => {
    if (!parallax) return
    const root = document.getElementById("paper-bg-parallax")
    if (!root) return

    const strength = 8 // px at edges
    const onMove = (e: MouseEvent) => {
      const { innerWidth: w, innerHeight: h } = window
      const x = (e.clientX / w) * 2 - 1
      const y = (e.clientY / h) * 2 - 1
      root.style.setProperty("--parallax-x", `${(-x * strength).toFixed(2)}px`)
      root.style.setProperty("--parallax-y", `${(-y * strength).toFixed(2)}px`)
    }
    window.addEventListener("mousemove", onMove)
    return () => window.removeEventListener("mousemove", onMove)
  }, [parallax])

  return (
    <div
      id="paper-bg-parallax"
      // NOTE: positioning is done with inline styles (not Tailwind utilities)
      // because this app ships hand-written CSS and does not load Tailwind —
      // utility classes like `fixed inset-0` would be no-ops and the canvas
      // would push page content down by a full viewport.
      className={["paper-bg-root", "transition-colors", className].join(" ")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        transition: "background-color 0.5s ease",
        backgroundColor: config.bg,
        transform: parallax ? "translate3d(var(--parallax-x,0), var(--parallax-y,0), 0)" : undefined,
        willChange: parallax ? "transform" : undefined,
      }}
    >
      {/* Core dithering shader */}
      <Dithering
        colorBack={config.back}
        colorFront={config.front}
        speed={config.speed}
        shape="wave"
        type="8x8"
        size={config.px}
        scale={config.scale}
        style={{
          height: "100vh",
          width: "100vw",
        }}
      />

      {/* Soft glow layer (theme-aware) */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: config.glow,
          mixBlendMode: "screen",
          opacity: 1,
        }}
      />

      {/* Film grain for texture — matches the soft photographic noise of the reference */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.25' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.11'/%3E%3C/svg%3E\")",
          backgroundSize: "cover",
          opacity: 0.22,
          mixBlendMode: "screen",
        }}
      />

      {/* Vignette — kept LAST (topmost) so it blacks out the dither dots, grain
          and shine at the edges. Ramps to solid #000 → pure-black surround. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(110% 78% at 50% 44%, rgba(0,0,0,0) 28%, rgba(0,0,0,0.6) 62%, #000000 100%)",
          pointerEvents: "none",
        }}
      />
    </div>
  )
}

/**
 * Utility: linear RGB mix between two hex colors (simple)
 */
function mix(a: string, b: string, t: number): string {
  const ah = a.replace("#", "")
  const bh = b.replace("#", "")
  const ai = parseInt(ah, 16)
  const bi = parseInt(bh, 16)
  const ar = (ai >> 16) & 0xff
  const ag = (ai >> 8) & 0xff
  const ab = ai & 0xff
  const br = (bi >> 16) & 0xff
  const bg = (bi >> 8) & 0xff
  const bb = bi & 0xff
  const rr = Math.round(ar + (br - ar) * t)
  const rg = Math.round(ag + (bg - ag) * t)
  const rb = Math.round(ab + (bb - ab) * t)
  return `#${((1 << 24) + (rr << 16) + (rg << 8) + rb).toString(16).slice(1)}`
}
