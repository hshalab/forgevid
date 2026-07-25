/**
 * Email Notification Service
 *
 * Sends transactional emails via SMTP (nodemailer).
 * Templates: welcome, export-complete, subscription-receipt, password-reset
 */

import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587', 10),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const FROM_ADDRESS = process.env.SMTP_FROM || 'ForgeVid <noreply@forgevid.com>';
const APP_URL = process.env.NEXTAUTH_URL || 'https://forgevid.com';

// ─── Template Helpers ──────────────────────────────────────────────

function baseLayout(title: string, body: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0f172a; color: #e2e8f0; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .header { text-align: center; margin-bottom: 32px; }
    .logo { font-size: 28px; font-weight: 700; color: #22d3ee; }
    .card { background: #1e293b; border-radius: 12px; padding: 32px; margin-bottom: 24px; border: 1px solid #334155; }
    .btn { display: inline-block; padding: 12px 32px; background: #0891b2; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; }
    .btn:hover { background: #06b6d4; }
    .footer { text-align: center; font-size: 12px; color: #64748b; margin-top: 32px; }
    h1 { color: #f1f5f9; margin: 0 0 16px; font-size: 24px; }
    p { line-height: 1.6; margin: 0 0 16px; color: #cbd5e1; }
    .highlight { color: #22d3ee; font-weight: 600; }
    .divider { border: none; border-top: 1px solid #334155; margin: 24px 0; }
    .meta { font-size: 13px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">ForgeVid</div>
    </div>
    ${body}
    <div class="footer">
      <p>&copy; ${new Date().getFullYear()} ForgeVid by Kryst Investments LLC. All rights reserved.</p>
      <p><a href="${APP_URL}" style="color: #22d3ee;">forgevid.com</a></p>
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Email Sender ──────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log(`[Email] SMTP not configured. Would send "${subject}" to ${to}`);
    return false;
  }

  try {
    await transporter.sendMail({
      from: FROM_ADDRESS,
      to,
      subject,
      html,
    });
    console.log(`[Email] Sent "${subject}" to ${to}`);
    return true;
  } catch (error) {
    console.error(`[Email] Failed to send "${subject}" to ${to}:`, error);
    return false;
  }
}

// ─── Email Templates ───────────────────────────────────────────────

export async function sendWelcomeEmail(to: string, name: string): Promise<boolean> {
  const html = baseLayout(
    'Welcome to ForgeVid',
    `
    <div class="card">
      <h1>Welcome to ForgeVid, ${escapeHtml(name || 'Creator')}!</h1>
      <p>You're all set to start creating amazing videos with the power of AI.</p>
      <p>Here's what you can do:</p>
      <ul style="color: #cbd5e1; padding-left: 20px;">
        <li>Chat with our AI to describe and refine your video ideas</li>
        <li>Generate professional videos from text prompts</li>
        <li>Use emotion-aware AI for perfect tone and pacing</li>
        <li>Collaborate with your team in real-time</li>
      </ul>
      <p style="text-align: center; margin-top: 24px;">
        <a href="${APP_URL}/dashboard" class="btn">Start Creating</a>
      </p>
    </div>
    `
  );

  return sendEmail(to, 'Welcome to ForgeVid — Let\'s Create!', html);
}

export async function sendExportCompleteEmail(
  to: string,
  name: string,
  videoTitle: string,
  downloadUrl: string,
  details: { duration: string; resolution: string; fileSize: string }
): Promise<boolean> {
  const html = baseLayout(
    'Your Video is Ready',
    `
    <div class="card">
      <h1>Your Video is Ready!</h1>
      <p>Hi ${escapeHtml(name || 'there')}, your video export has completed successfully.</p>
      <hr class="divider" />
      <p class="meta">
        <strong>Title:</strong> ${escapeHtml(videoTitle)}<br />
        <strong>Duration:</strong> ${escapeHtml(details.duration)}<br />
        <strong>Resolution:</strong> ${escapeHtml(details.resolution)}<br />
        <strong>File Size:</strong> ${escapeHtml(details.fileSize)}
      </p>
      <hr class="divider" />
      <p style="text-align: center;">
        <a href="${escapeHtml(downloadUrl)}" class="btn">Download Video</a>
      </p>
      <p class="meta" style="text-align: center; margin-top: 12px;">
        This download link expires in 7 days.
      </p>
    </div>
    `
  );

  return sendEmail(to, `Your video "${videoTitle}" is ready to download`, html);
}

export async function sendSubscriptionReceiptEmail(
  to: string,
  name: string,
  receipt: {
    plan: string;
    amount: string;
    currency: string;
    billingPeriod: string;
    invoiceId: string;
    date: string;
  }
): Promise<boolean> {
  const html = baseLayout(
    'Subscription Receipt',
    `
    <div class="card">
      <h1>Payment Received</h1>
      <p>Hi ${escapeHtml(name || 'there')}, thank you for your subscription!</p>
      <hr class="divider" />
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td class="meta" style="padding: 8px 0;">Plan</td>
          <td style="padding: 8px 0; text-align: right; color: #f1f5f9;">${escapeHtml(receipt.plan)}</td>
        </tr>
        <tr>
          <td class="meta" style="padding: 8px 0;">Amount</td>
          <td style="padding: 8px 0; text-align: right; color: #22d3ee; font-weight: 600;">${escapeHtml(receipt.amount)} ${escapeHtml(receipt.currency.toUpperCase())}</td>
        </tr>
        <tr>
          <td class="meta" style="padding: 8px 0;">Billing Period</td>
          <td style="padding: 8px 0; text-align: right; color: #f1f5f9;">${escapeHtml(receipt.billingPeriod)}</td>
        </tr>
        <tr>
          <td class="meta" style="padding: 8px 0;">Date</td>
          <td style="padding: 8px 0; text-align: right; color: #f1f5f9;">${escapeHtml(receipt.date)}</td>
        </tr>
        <tr>
          <td class="meta" style="padding: 8px 0;">Invoice</td>
          <td style="padding: 8px 0; text-align: right; color: #f1f5f9;">${escapeHtml(receipt.invoiceId)}</td>
        </tr>
      </table>
      <hr class="divider" />
      <p style="text-align: center;">
        <a href="${APP_URL}/dashboard/billing" class="btn">Manage Subscription</a>
      </p>
    </div>
    `
  );

  return sendEmail(to, `ForgeVid ${receipt.plan} — Payment Receipt`, html);
}

export async function sendPasswordResetEmail(to: string, name: string, resetUrl: string): Promise<boolean> {
  const html = baseLayout(
    'Reset Your Password',
    `
    <div class="card">
      <h1>Reset Your Password</h1>
      <p>Hi ${escapeHtml(name || 'there')}, we received a request to reset your password.</p>
      <p style="text-align: center; margin-top: 24px;">
        <a href="${escapeHtml(resetUrl)}" class="btn">Reset Password</a>
      </p>
      <p class="meta" style="text-align: center; margin-top: 12px;">
        This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
      </p>
    </div>
    `
  );

  return sendEmail(to, 'Reset Your ForgeVid Password', html);
}

export async function sendSubscriptionCancelledEmail(to: string, name: string, planName: string): Promise<boolean> {
  const html = baseLayout(
    'Subscription Cancelled',
    `
    <div class="card">
      <h1>Subscription Cancelled</h1>
      <p>Hi ${escapeHtml(name || 'there')}, your <span class="highlight">${escapeHtml(planName)}</span> subscription has been cancelled.</p>
      <p>You'll continue to have access until the end of your current billing period.</p>
      <p>We'd love to have you back. If you change your mind:</p>
      <p style="text-align: center; margin-top: 24px;">
        <a href="${APP_URL}/pricing" class="btn">Resubscribe</a>
      </p>
    </div>
    `
  );

  return sendEmail(to, 'Your ForgeVid Subscription Has Been Cancelled', html);
}

export async function sendGrowthOperatorEmail(to: string, name: string, count: number): Promise<boolean> {
  const html = baseLayout(
    'Growth Operator recommendations are ready',
    `<div class="card">
      <h1>Your Growth Operator review is ready</h1>
      <p>Hi ${escapeHtml(name)}, ForgeVid found ${count} evidence-grounded campaign recommendation${count === 1 ? '' : 's'}.</p>
      <p>No campaign was generated, published, or sent to a prospect. Review and approve every next action yourself.</p>
      <p style="text-align:center;margin-top:24px"><a href="${APP_URL}/dashboard/recommendations" class="btn">Review recommendations</a></p>
    </div>`,
  )
  return sendEmail(to, `${count} ForgeVid Growth Operator recommendation${count === 1 ? '' : 's'} ready`, html)
}
