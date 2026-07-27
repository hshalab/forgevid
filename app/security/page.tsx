import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8">
          <Link href="/">
            <Button variant="ghost" className="mb-4">← Back to Home</Button>
          </Link>
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Security</h1>
          <p className="text-slate-600">Our approach to keeping your data safe</p>
        </div>

        <Card className="mb-8">
          <CardHeader><CardTitle>Practices</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <ul className="list-disc pl-6 space-y-2">
              <li>Encryption in transit (TLS 1.2+) and at rest</li>
              <li>Least-privilege access controls and MFA</li>
              <li>Automated dependency and vulnerability scanning</li>
              <li>Regular security reviews and logging</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardHeader><CardTitle>Responsible Disclosure</CardTitle></CardHeader>
          <CardContent>
            <p>
              If you believe you’ve found a security vulnerability, please email krystinvestments@gmail.com with details and a way to reproduce.
              We will acknowledge, investigate, and remediate as necessary.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}



