"use client";
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Sparkles,
  Play,
  Layout,
  ImageIcon,
  Settings,
  Users,
  Gift,
  Megaphone,
  BarChart3,
  HelpCircle,
  LogOut,
  Home,
  Zap,
  CreditCard,
  Rss,
  TrendingUp,
  ShieldCheck,
  ClipboardCheck,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useSession, signOut } from "next-auth/react"
import { useEffect, useState } from "react"

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: Home },
  { name: "My Videos", href: "/dashboard/videos", icon: Play },
  { name: "Templates", href: "/dashboard/templates", icon: Layout },
  { name: "Media Library", href: "/dashboard/media", icon: ImageIcon },
  { name: "AI Studio", href: "/dashboard/ai", icon: Sparkles, badge: "New" },
  { name: "Ad Studio", href: "/dashboard/ad-studio", icon: Megaphone, badge: "New" },
  { name: "Feed → Videos", href: "/dashboard/feed", icon: Rss, badge: "New" },
  { name: "Recommendations", href: "/dashboard/recommendations", icon: TrendingUp, badge: "New" },
  { name: "Approvals", href: "/dashboard/approvals", icon: ShieldCheck, badge: "New" },
  { name: "Share & Review", href: "/dashboard/collaborate", icon: Users },
  { name: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { name: "Referrals", href: "/dashboard/referrals", icon: Gift },
]

const bottomNavigation = [
  { name: "Billing", href: "/dashboard/billing", icon: CreditCard },
  { name: "Settings", href: "/dashboard/settings", icon: Settings },
  { name: "Help & Support", href: "/dashboard/help", icon: HelpCircle },
]

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
}

/** First letters of the name (or the email local-part) for the avatar fallback. */
function initialsFrom(name?: string | null, email?: string | null): string {
  const source = (name || email?.split("@")[0] || "").trim()
  if (!source) return "U"
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 2).toUpperCase()
}

export function DashboardSidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [planId, setPlanId] = useState<string | null>(null)

  // The real plan comes from the Subscription table via /api/user/subscription
  // (the Stripe webhook is its source of truth). New accounts read back "free".
  useEffect(() => {
    let active = true
    fetch("/api/user/subscription")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data?.subscription?.planId) setPlanId(data.subscription.planId)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  const displayName = session?.user?.name || session?.user?.email || "Your account"
  const planLabel = planId ? PLAN_LABELS[planId] ?? planId : "…"
  const initials = initialsFrom(session?.user?.name, session?.user?.email)
  const isPaid = !!planId && planId !== "free"
  const visibleNavigation = session?.user?.email?.toLowerCase() === "judge@forgevid.com"
    ? [...navigation, { name: "Judge Tour", href: "/dashboard/judge", icon: ClipboardCheck, badge: "Start" }]
    : navigation

  return (
    <div className="flex flex-col w-64 bg-sidebar border-r border-sidebar-border">
      {/* Logo */}
      <div className="flex items-center gap-2 p-6 border-b border-sidebar-border">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary">
          <Sparkles className="h-5 w-5 text-sidebar-primary-foreground" />
        </div>
        <span className="font-heading text-lg font-bold text-sidebar-foreground">ForgeVid</span>
      </div>

      {/* User Profile */}
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10">
            {session?.user?.image ? <AvatarImage src={session.user.image} /> : null}
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-sidebar-foreground truncate">{displayName}</p>
            <p className="text-xs text-sidebar-foreground/70 truncate">{planLabel} Plan</p>
          </div>
          {isPaid && (
            <Badge variant="secondary" className="text-xs">
              <Zap className="h-3 w-3 mr-1" />
              {PLAN_LABELS[planId as string] ?? planId}
            </Badge>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1">
        {visibleNavigation.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname?.startsWith(item.href))
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50",
              )}
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.name}</span>
              {item.badge && (
                <Badge variant="secondary" className="text-xs">
                  {item.badge}
                </Badge>
              )}
            </Link>
          )
        })}
      </nav>

      {/* Bottom Navigation */}
      <div className="p-4 border-t border-sidebar-border space-y-1">
        {bottomNavigation.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className="flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-lg text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
          >
            <item.icon className="h-4 w-4" />
            <span>{item.name}</span>
          </Link>
        ))}

        <Button
          variant="ghost"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="w-full justify-start gap-3 px-3 py-2 text-sm font-medium text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </Button>
      </div>
    </div>
  )
}
