'use client'

import { Bell, Settings } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import ThemeToggle from '@/components/theme-toggle'
import LoginButton from '@/components/auth/login-button'
import UserMenu from '@/components/auth/user-menu'

export default function TopNavigation() {
  const pathname = usePathname()

  const navItems = [
    { label: 'Dashboard', href: '/' },
    { label: 'Token Intelligence', href: '/token-intelligence' },
    { label: 'Community Feed', href: '/community-feed' },
    { label: 'Agent Marketplace', href: '/agent-marketplace' },
    { label: 'Trade Details', href: '/trade-details' },
    { label: 'Agent Intelligence', href: '/agent-intelligence' },
    { label: 'Execution Center', href: '/execution-center' },
    { label: 'Settings', href: '/settings' },
  ]

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname.startsWith(href)
  }

  return (
    <header className="border-b border-border bg-background sticky top-0 z-50">
      <div className="flex items-center justify-between h-16 px-6 gap-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 flex-shrink-0 hover:opacity-80 transition-opacity">
          <div className="w-8 h-8 bg-primary rounded flex items-center justify-center">
            <span className="text-primary-foreground text-sm font-bold">T</span>
          </div>
          <span className="font-semibold text-sm text-foreground">Toru</span>
        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-8 flex-1 text-sm">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`pb-2 border-b-2 transition-colors whitespace-nowrap ${
                isActive(item.href)
                  ? 'border-orange-accent text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Right actions */}
        <div className="flex items-center gap-3 flex-shrink-0">
          <ThemeToggle />
          <button className="p-2 hover:bg-secondary rounded transition-colors">
            <Bell size={18} className="text-muted-foreground" />
          </button>
          <Link href="/settings" className="p-2 hover:bg-secondary rounded transition-colors">
            <Settings size={18} className="text-muted-foreground" />
          </Link>
          <LoginButton />
          <UserMenu />
        </div>
      </div>
    </header>
  )
}
