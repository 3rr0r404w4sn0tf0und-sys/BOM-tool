// Minimal wrapper around the Resend API (https://resend.com) -- free tier,
// no card required. Sends from onboarding@resend.dev (Resend's shared
// testing address) since we don't have a verified custom domain. That's
// fine for verification emails; it just means the from-address will show
// as onboarding@resend.dev instead of something@yourdomain.com until you
// verify a domain in the Resend dashboard.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_ADDRESS = process.env.RESEND_FROM || "BOM Tool <onboarding@resend.dev>";

export async function sendVerificationEmail(toEmail, verifyUrl) {
  if (!RESEND_API_KEY) {
    console.warn("RESEND_API_KEY not set -- skipping verification email send. Verify URL:", verifyUrl);
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [toEmail],
        subject: "Verify your BOM Tool account",
        html: `
          <p>Welcome to BOM Tool!</p>
          <p>Click the link below to verify your email address:</p>
          <p><a href="${verifyUrl}">${verifyUrl}</a></p>
          <p>This link expires in 24 hours. If you didn't sign up for BOM Tool, you can ignore this email.</p>
        `,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Resend send failed:", resp.status, errText);
      return { sent: false, error: `Resend API error: ${resp.status}` };
    }
    return { sent: true };
  } catch (e) {
    console.error("Resend send threw:", e);
    return { sent: false, error: e.message };
  }
}
