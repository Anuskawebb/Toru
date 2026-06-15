'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import ConnectButton from './ConnectButton';
import ThemeToggle from './ThemeToggle';
import ProfileMenu from './ProfileMenu';
import NotificationBell from './NotificationBell';

// ── SVG Icons ────────────────────────────────────────────────────────────────

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

// (Rest of the SVGs remain unchanged)
function CompassIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}

function ChartIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}

function BotIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <path d="M15 13v2" />
      <path d="M9 13v2" />
    </svg>
  );
}

function BankIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="21" x2="21" y2="21" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M5 21V10M9 21V10M13 21V10M17 21V10" />
      <path d="m2 10 10-7 10 7" />
    </svg>
  );
}

function DropIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22a7 7 0 0 0 7-7c0-4.3-7-11-7-11S5 10.7 5 15a7 7 0 0 0 7 7z" />
    </svg>
  );
}

// ── Navigation Configuration ─────────────────────────────────────────────────

const PILL_1_ITEMS = [
  { label: 'Dashboard', href: '/', icon: HomeIcon },
  { label: 'Discover', href: '/discover', icon: CompassIcon },
];

const PILL_2_ITEMS = [
  { label: 'Trades', href: '/trades', icon: ChartIcon },
  { label: 'Agents', href: '/agents', icon: BotIcon },
  { label: 'Portfolio', href: '/portfolio', icon: BankIcon },
  { label: 'aUSD', href: '/faucet', icon: DropIcon },
];

export default function AppNavbar() {
  const pathname = usePathname();
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);
  const [watcherOnline, setWatcherOnline] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/watcher/status')
      .then((r) => r.json())
      .then((d) => setWatcherOnline(!!d.online))
      .catch(() => setWatcherOnline(false));
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      
      // Hide on scroll down past threshold, show on scroll up
      if (currentScrollY > lastScrollY && currentScrollY > 80) {
        setIsVisible(false);
      } else {
        setIsVisible(true);
      }
      setLastScrollY(currentScrollY);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [lastScrollY]);

  return (
    <header 
      className="sticky top-0 z-50 flex-shrink-0 pt-4 md:pt-6 bg-transparent will-change-transform"
      style={{
        transform: isVisible ? 'translate3d(0, 0, 0)' : 'translate3d(0, -130%, 0)',
        transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div className="h-[72px] w-full bg-transparent flex items-center justify-between px-[7.5%] transition-all duration-300">
        {/* Left Area: Logo & Navigation Pills */}
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center flex-shrink-0 mr-4 transition-spring hover:scale-105 active:scale-95">
            <Image
              src="/logo.svg"
              alt="Aether Logo"
              width={44}
              height={44}
              className="flex-shrink-0 dark:invert-0 invert transition-transform duration-300 hover:rotate-6"
              priority
            />
          </Link>

          {/* Navigation Pill 1 */}
          <div className="flex items-center gap-3 bg-surface/60 backdrop-blur-md border border-border/40 rounded-full p-1 shadow-lg shadow-black/5 hover:border-border/80 transition-all duration-300">
            {PILL_1_ITEMS.map(({ label, href, icon: Icon }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={label}
                  href={href}
                  title={label}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-spring cursor-pointer hover:scale-110 active:scale-90 ${
                    active
                      ? 'bg-accent text-accent-foreground shadow-md shadow-accent/20'
                      : 'text-muted hover:text-foreground hover:bg-surface/85'
                  }`}
                >
                  <Icon />
                </Link>
              );
            })}
          </div>

          {/* Navigation Pill 2 */}
          <div className="flex items-center gap-3 bg-surface/60 backdrop-blur-md border border-border/40 rounded-full p-1 shadow-lg shadow-black/5 hover:border-border/80 transition-all duration-300">
            {PILL_2_ITEMS.map(({ label, href, icon: Icon }) => {
              const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
              return (
                <Link
                  key={label}
                  href={href}
                  title={label}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-spring cursor-pointer hover:scale-110 active:scale-90 ${
                    active
                      ? 'bg-accent text-accent-foreground shadow-md shadow-accent/20'
                      : 'text-muted hover:text-foreground hover:bg-surface/85'
                  }`}
                >
                  <Icon />
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right Area: Control Panel (Notifications, Theme, Profile) */}
        <div className="flex items-center gap-6">
          {watcherOnline !== null && (
            <Link
              href="/watcher"
              title="View watcher activity"
              className={`flex items-center gap-1.5 text-[11px] transition-colors hover:opacity-80 ${
                watcherOnline ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${watcherOnline ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              <span className="hidden sm:inline">{watcherOnline ? 'Agent Network: Live' : 'Agent Network: Offline'}</span>
            </Link>
          )}

          <NotificationBell />

          <ThemeToggle />
          <ConnectButton />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
