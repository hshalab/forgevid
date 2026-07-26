"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import BrandKitPanel from "@/components/brand-kit-panel"
import { 
  User, 
  Bell, 
  Shield, 
  Palette, 
  Globe, 
  CreditCard,
  Key,
  Download,
  Trash2,
  Save
} from "lucide-react"
import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { withCsrfHeaders } from "@/lib/csrf-client"

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  starter: "Starter",
  pro: "Pro",
  enterprise: "Enterprise",
}

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    profile: {
      name: "",
      email: "",
      bio: "",
      avatar: "/placeholder.svg?key=user"
    },
    notifications: {
      emailUpdates: true,
      pushNotifications: false,
      weeklyReports: true,
      collaborationAlerts: true
    },
    preferences: {
      theme: "system",
      language: "en",
      timezone: "UTC-8",
      autoSave: true,
      qualityPreference: "high"
    },
    privacy: {
      profileVisibility: "private",
      analyticsTracking: false,
      marketingEmails: false
    }
  })

  const { update: updateSession } = useSession()
  const [realPlan, setRealPlan] = useState<string>("free")
  const [saving, setSaving] = useState<string | null>(null)
  const [saveMsg, setSaveMsg] = useState<string>("")

  // Load the real profile (name/email/bio) and the real plan once on mount.
  useEffect(() => {
    fetch("/api/user/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setSettings((prev) => ({
            ...prev,
            profile: {
              ...prev.profile,
              name: data.user.name ?? "",
              email: data.user.email ?? "",
              bio: data.user.bio ?? "",
            },
            preferences: {
              ...prev.preferences,
              ...(data.user.preferences || {}),
            },
          }))
        }
      })
      .catch(() => {})

    fetch("/api/user/subscription")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.subscription?.planId) setRealPlan(data.subscription.planId)
      })
      .catch(() => {})
  }, [])

  const handleSaveSettings = async (section: string) => {
    if (section !== "profile" && section !== "preferences") {
      return
    }
    setSaving(section)
    setSaveMsg("")
    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: withCsrfHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          ...(section === "profile"
            ? { name: settings.profile.name, bio: settings.profile.bio }
            : { preferences: settings.preferences }),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveMsg(data?.error || "Could not save. Please try again.")
        return
      }
      // Push the new name into the session so the sidebar updates immediately.
      if (section === "profile") await updateSession({ name: settings.profile.name })
      setSaveMsg("Saved ✓")
    } catch {
      setSaveMsg("Network error. Please try again.")
    } finally {
      setSaving(null)
    }
  }

  const handleDeleteAccount = () => {
    // TODO: Implement account deletion flow
  }

  return (
    <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="font-heading text-3xl font-bold">Settings</h1>
            <p className="text-muted-foreground mt-1">Manage your account preferences and settings</p>
          </div>

          <Tabs defaultValue="profile" className="space-y-6">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="branding">Branding</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
              <TabsTrigger value="preferences">Preferences</TabsTrigger>
              <TabsTrigger value="privacy">Privacy</TabsTrigger>
              <TabsTrigger value="billing">Billing</TabsTrigger>
            </TabsList>

            {/* Brand kit: logo, caption colour/font, intro/outro (paid plans) */}
            <TabsContent value="branding">
              <BrandKitPanel />
            </TabsContent>

            {/* Profile Settings */}
            <TabsContent value="profile">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <User className="h-5 w-5" />
                    Profile Information
                  </CardTitle>
                  <CardDescription>
                    Update your profile information and public details
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center gap-6">
                    <img
                      src={settings.profile.avatar}
                      alt="Profile"
                      className="h-20 w-20 rounded-full object-cover"
                    />
                    <div>
                      <Button variant="outline" size="sm">
                        Change Avatar
                      </Button>
                      <p className="text-sm text-muted-foreground mt-1">
                        JPG, PNG or GIF. Max size 5MB.
                      </p>
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name</Label>
                      <Input
                        id="name"
                        value={settings.profile.name}
                        onChange={(e) => setSettings({
                          ...settings,
                          profile: { ...settings.profile, name: e.target.value }
                        })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address</Label>
                      <Input id="email" type="email" value={settings.profile.email} disabled />
                      <p className="text-xs text-muted-foreground">
                        Email is tied to your login and can&apos;t be changed here.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="bio">Bio</Label>
                    <Textarea
                      placeholder="Tell us about yourself..."
                      value={settings.profile.bio}
                      onChange={(e) => setSettings({
                        ...settings,
                        profile: { ...settings.profile, bio: e.target.value }
                      })}
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <Button onClick={() => handleSaveSettings('profile')} disabled={saving === 'profile'}>
                      <Save className="h-4 w-4 mr-2" />
                      {saving === 'profile' ? 'Saving…' : 'Save Changes'}
                    </Button>
                    {saveMsg && <span className="text-sm text-muted-foreground">{saveMsg}</span>}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Notification Settings */}
            <TabsContent value="notifications">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5" />
                    Notification Preferences
                  </CardTitle>
                  <CardDescription>
                    Choose how you want to be notified about updates and activities
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Email Updates</Label>
                        <p className="text-sm text-muted-foreground">
                          Receive important updates via email
                        </p>
                      </div>
                      <Switch
                        checked={settings.notifications.emailUpdates}
                        onCheckedChange={(checked) => setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, emailUpdates: checked }
                        })}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Push Notifications</Label>
                        <p className="text-sm text-muted-foreground">
                          Get notified about real-time activities
                        </p>
                      </div>
                      <Switch
                        checked={settings.notifications.pushNotifications}
                        onCheckedChange={(checked) => setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, pushNotifications: checked }
                        })}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Weekly Reports</Label>
                        <p className="text-sm text-muted-foreground">
                          Receive weekly analytics summaries
                        </p>
                      </div>
                      <Switch
                        checked={settings.notifications.weeklyReports}
                        onCheckedChange={(checked) => setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, weeklyReports: checked }
                        })}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Collaboration Alerts</Label>
                        <p className="text-sm text-muted-foreground">
                          Get notified when others collaborate on your videos
                        </p>
                      </div>
                      <Switch
                        checked={settings.notifications.collaborationAlerts}
                        onCheckedChange={(checked) => setSettings({
                          ...settings,
                          notifications: { ...settings.notifications, collaborationAlerts: checked }
                        })}
                      />
                    </div>
                  </div>

                  <Button onClick={() => handleSaveSettings('notifications')}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Preferences
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* App Preferences */}
            <TabsContent value="preferences">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Palette className="h-5 w-5" />
                    App Preferences
                  </CardTitle>
                  <CardDescription>
                    Customize your ForgeVid experience
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label>Theme</Label>
                      <Select
                        value={settings.preferences.theme}
                        onValueChange={(value) => setSettings({
                          ...settings,
                          preferences: { ...settings.preferences, theme: value }
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="light">Light</SelectItem>
                          <SelectItem value="dark">Dark</SelectItem>
                          <SelectItem value="system">System</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Language</Label>
                      <Select
                        value={settings.preferences.language}
                        onValueChange={(value) => setSettings({
                          ...settings,
                          preferences: { ...settings.preferences, language: value }
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="en">🇺🇸 English</SelectItem>
                          <SelectItem value="es">🇪🇸 Español</SelectItem>
                          <SelectItem value="hi">🇮🇳 हिन्दी (Hindi)</SelectItem>
                          <SelectItem value="zh">🇨🇳 中文 (Chinese)</SelectItem>
                          <SelectItem value="ja">🇯🇵 日本語 (Japanese)</SelectItem>
                          <SelectItem value="fr">🇫🇷 Français</SelectItem>
                          <SelectItem value="it">🇮🇹 Italiano</SelectItem>
                          <SelectItem value="ko">🇰🇷 한국어 (Korean)</SelectItem>
                          <SelectItem value="pt">🇵🇹 Português</SelectItem>
                          <SelectItem value="de">🇩🇪 Deutsch</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Timezone</Label>
                      <Select
                        value={settings.preferences.timezone}
                        onValueChange={(value) => setSettings({
                          ...settings,
                          preferences: { ...settings.preferences, timezone: value }
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="UTC-8">Pacific Time (UTC-8)</SelectItem>
                          <SelectItem value="UTC-5">Eastern Time (UTC-5)</SelectItem>
                          <SelectItem value="UTC+0">Greenwich Time (UTC+0)</SelectItem>
                          <SelectItem value="UTC+1">Central European Time (UTC+1)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Default Video Quality</Label>
                      <Select
                        value={settings.preferences.qualityPreference}
                        onValueChange={(value) => setSettings({
                          ...settings,
                          preferences: { ...settings.preferences, qualityPreference: value }
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="low">Low (720p)</SelectItem>
                          <SelectItem value="medium">Medium (1080p)</SelectItem>
                          <SelectItem value="high">High (4K)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <div>
                      <Label>Auto-save Projects</Label>
                      <p className="text-sm text-muted-foreground">
                        Automatically save your work every few minutes
                      </p>
                    </div>
                    <Switch
                      checked={settings.preferences.autoSave}
                      onCheckedChange={(checked) => setSettings({
                        ...settings,
                        preferences: { ...settings.preferences, autoSave: checked }
                      })}
                    />
                  </div>

                  <Button onClick={() => handleSaveSettings('preferences')}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Preferences
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Privacy Settings */}
            <TabsContent value="privacy">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Privacy & Security
                  </CardTitle>
                  <CardDescription>
                    Control your privacy settings and account security
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Profile Visibility</Label>
                      <Select
                        value={settings.privacy.profileVisibility}
                        onValueChange={(value) => setSettings({
                          ...settings,
                          privacy: { ...settings.privacy, profileVisibility: value }
                        })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="public">Public</SelectItem>
                          <SelectItem value="private">Private</SelectItem>
                          <SelectItem value="friends">Friends Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Analytics Tracking</Label>
                        <p className="text-sm text-muted-foreground">
                          Help us improve ForgeVid with usage analytics
                        </p>
                      </div>
                      <Switch
                        checked={settings.privacy.analyticsTracking}
                        onCheckedChange={(checked) => setSettings({
                          ...settings,
                          privacy: { ...settings.privacy, analyticsTracking: checked }
                        })}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Marketing Emails</Label>
                        <p className="text-sm text-muted-foreground">
                          Receive emails about new features and promotions
                        </p>
                      </div>
                      <Switch
                        checked={settings.privacy.marketingEmails}
                        onCheckedChange={(checked) => setSettings({
                          ...settings,
                          privacy: { ...settings.privacy, marketingEmails: checked }
                        })}
                      />
                    </div>
                  </div>

                  <div className="border-t pt-6">
                    <h3 className="font-semibold mb-4">Account Actions</h3>
                    <div className="space-y-3">
                      <Button variant="outline" className="w-full justify-start">
                        <Download className="h-4 w-4 mr-2" />
                        Export My Data
                      </Button>
                      <Button variant="outline" className="w-full justify-start">
                        <Key className="h-4 w-4 mr-2" />
                        Change Password
                      </Button>
                      <Button variant="destructive" className="w-full justify-start" onClick={handleDeleteAccount}>
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete Account
                      </Button>
                    </div>
                  </div>

                  <Button onClick={() => handleSaveSettings('privacy')}>
                    <Save className="h-4 w-4 mr-2" />
                    Save Settings
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Billing Settings */}
            <TabsContent value="billing">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <CreditCard className="h-5 w-5" />
                    Billing & Subscription
                  </CardTitle>
                  <CardDescription>
                    Manage your subscription and billing information
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="p-4 bg-muted rounded-lg">
                    <h3 className="font-semibold mb-2">Current Plan: {PLAN_LABELS[realPlan] ?? realPlan}</h3>
                    <p className="text-sm text-muted-foreground">
                      You&apos;re currently on the {PLAN_LABELS[realPlan] ?? realPlan} plan.
                    </p>
                  </div>

                  <div className="space-y-4">
                    <Button className="w-full">
                      Upgrade to Pro
                    </Button>
                    <Button variant="outline" className="w-full">
                      View Billing History
                    </Button>
                    <Button variant="outline" className="w-full">
                      Manage Payment Methods
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
    </div>
  )
}
