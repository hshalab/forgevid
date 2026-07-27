import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"
import { Shield, FileText, Globe, Users } from "lucide-react"

export default function LegalHub() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="mb-8">
          <Link href="/">
            <Button variant="ghost" className="mb-4">
              ← Back to Home
            </Button>
          </Link>
          <h1 className="text-4xl font-bold text-slate-900 mb-2">Legal & Compliance</h1>
          <p className="text-slate-600">Comprehensive legal documentation and compliance information</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center gap-3">
                <FileText className="h-6 w-6 text-emerald-600" />
                <CardTitle>Terms of Service</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600 mb-4">
                Complete terms and conditions for using ForgeVid platform, including user responsibilities and
                service limitations.
              </p>
              <Link href="/terms">
                <Button className="w-full">View Terms of Service</Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center gap-3">
                <Shield className="h-6 w-6 text-emerald-600" />
                <CardTitle>Privacy Policy</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-slate-600 mb-4">
                Detailed information about how we collect, use, and protect your personal data in compliance with GDPR
                and CCPA.
              </p>
              <Link href="/privacy">
                <Button className="w-full">View Privacy Policy</Button>
              </Link>
            </CardContent>
          </Card>
        </div>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Globe className="h-6 w-6 text-emerald-600" />
              Compliance & Certifications
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-3 gap-4 mb-6">
              <div className="text-center p-4 bg-emerald-50 rounded-lg">
                <Badge variant="secondary" className="mb-2">
                  GDPR Compliant
                </Badge>
                <p className="text-sm text-slate-600">European data protection compliance</p>
              </div>
              <div className="text-center p-4 bg-emerald-50 rounded-lg">
                <Badge variant="secondary" className="mb-2">
                  CCPA Compliant
                </Badge>
                <p className="text-sm text-slate-600">California privacy law compliance</p>
              </div>
              <div className="text-center p-4 bg-emerald-50 rounded-lg">
                <Badge variant="secondary" className="mb-2">
                  SOC 2 Type II
                </Badge>
                <p className="text-sm text-slate-600">Security and availability controls</p>
              </div>
            </div>

            <h4 className="font-semibold mb-3">Data Protection Measures</h4>
            <ul className="list-disc pl-6 space-y-2 text-slate-600">
              <li>End-to-end encryption for all data transmission</li>
              <li>Regular security audits and penetration testing</li>
              <li>ISO 27001 information security management</li>
              <li>HIPAA-ready infrastructure for healthcare clients</li>
              <li>Regular compliance monitoring and reporting</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              <Users className="h-6 w-6 text-emerald-600" />
              Enterprise Compliance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-3">Business Assurance</h4>
                <ul className="list-disc pl-6 space-y-2 text-slate-600">
                  <li>Business Associate Agreements (BAA) available</li>
                  <li>Data Processing Agreements (DPA) for GDPR</li>
                  <li>Service Level Agreements (SLA) with 99.9% uptime</li>
                  <li>Vendor security questionnaire responses</li>
                </ul>
              </div>
              <div>
                <h4 className="font-semibold mb-3">Industry Standards</h4>
                <ul className="list-disc pl-6 space-y-2 text-slate-600">
                  <li>PCI DSS compliance for payment processing</li>
                  <li>FERPA compliance for educational institutions</li>
                  <li>FedRAMP authorization in progress</li>
                  <li>Regular third-party security assessments</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Intellectual Property</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h4 className="font-semibold mb-2">Content Ownership</h4>
                <p className="text-slate-600">
                  You retain full ownership of all content created using ForgeVid. We do not claim any rights to your
                  generated videos, images, or other creative works.
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-2">AI Training Data</h4>
                <p className="text-slate-600">
                  Your content is not used to train our AI models without explicit consent. We maintain strict data
                  isolation and privacy controls.
                </p>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Copyright Protection</h4>
                <p className="text-slate-600">
                  We provide tools to help ensure your content doesn't infringe on existing copyrights and offer DMCA
                  compliance procedures.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact Legal Team</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-6">
              <div>
                <h4 className="font-semibold mb-2">General Legal Inquiries</h4>
                <p className="text-slate-600 mb-2">Email: krystinvestments@gmail.com</p>
                <p className="text-slate-600">Response time: 1-2 business days</p>
              </div>
              <div>
                <h4 className="font-semibold mb-2">Privacy & Data Protection</h4>
                <p className="text-slate-600 mb-2">Email: krystinvestments@gmail.com</p>
                <p className="text-slate-600">DPO: krystinvestments@gmail.com</p>
              </div>
            </div>
            <div className="mt-6 p-4 bg-slate-50 rounded-lg">
              <p className="text-sm text-slate-600">
                <strong>Business Address:</strong> [Your Business Address]
                <br />
                <strong>Registration:</strong> [Business Registration Number]
                <br />
                <strong>VAT ID:</strong> [VAT Number if applicable]
                <br />
                <strong>Platform Ownership:</strong> ForgeVid is owned and operated by Kryst Investments LLC.
      {/* Legal Disclaimer */}
      <div className="container mx-auto px-4 py-4">
        <div className="bg-slate-100 p-4 rounded-lg text-xs text-slate-600">
          <strong>Legal Disclaimer:</strong> ForgeVid is a product of Kryst Investments LLC. All content, trademarks, and intellectual property are protected under applicable laws. Use of this platform is subject to the terms, privacy policy, and legal notices provided. For legal inquiries, contact krystinvestments@gmail.com.
        </div>
      </div>
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
