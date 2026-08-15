// Wrapper around the Brevo (formerly Sendinblue) transactional email API
// (https://brevo.com) -- free tier, no card required, 300 emails/day.
// Unlike Resend's sandbox sender, Brevo lets you send to any recipient on
// the free plan -- the only setup step is verifying ONE sender email
// address (a single click-through link Brevo emails you), not a domain.
//
// Setup:
// 1. Sign up at brevo.com (free, no card)
// 2. Settings -> Senders & IP -> add a sender email you control -> click
//    the confirmation link Brevo sends you
// 3. Settings -> SMTP & API -> API Keys -> generate one
// 4. Set BREVO_API_KEY and BREVO_FROM_EMAIL (must match the verified
//    sender from step 2) as GitHub/Render env vars

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const FROM_EMAIL = process.env.BREVO_FROM_EMAIL;
const FROM_NAME = process.env.BREVO_FROM_NAME || "BOM Tool";

export async function sendVerificationEmail(toEmail, verifyUrl) {
  if (!BREVO_API_KEY || !FROM_EMAIL) {
    console.warn("BREVO_API_KEY/BREVO_FROM_EMAIL not set -- skipping verification email send. Verify URL:", verifyUrl);
    return { sent: false, error: "Brevo not configured" };
  }

  try {
    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: FROM_EMAIL, name: FROM_NAME },
        to: [{ email: toEmail }],
        subject: "Verify your BOM Tool account",
        htmlContent: `
          <p>Welcome to BOM Tool!</p>
          <p>Click the link below to verify your email address:</p>
          <p><a href="${verifyUrl}">${verifyUrl}</a></p>
          <p>This link expires in 24 hours. If you didn't sign up for BOM Tool, you can ignore this email.</p>
        `,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Brevo send failed:", resp.status, errText);
      return { sent: false, error: `Brevo API error: ${resp.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error("Brevo send threw:", e);
    return { sent: false, error: e.message };
  }
}
