import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function DoNotSellPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8">
          <Link href="/">
            <Button variant="ghost" className="mb-4">← Back to Home</Button>
          </Link>
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Do Not Sell or Share My Personal Information</h1>
          <p className="text-slate-600">CCPA / CPRA Opt-Out</p>
        </div>

        <Card>
          <CardHeader><CardTitle>Your Choices</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p>
              We do not sell personal information. You may still opt-out of certain data sharing used for targeted advertising.
            </p>
            <p>
              To opt-out, email krystinvestments@gmail.com with subject “CCPA Opt-Out” or adjust cookie preferences via the cookie banner.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}



