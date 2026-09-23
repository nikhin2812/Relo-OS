import "server-only";

// Sends email through Resend when RESEND_API_KEY and EMAIL_FROM are set.
// Without them nothing is sent and the caller shows the link on screen instead.
export type EmailResult = { sent: true } | { sent: false; reason: "not_configured" | "failed" };

export async function sendEmail(to: string, subject: string, text: string): Promise<EmailResult> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { sent: false, reason: "not_configured" };
  // Demo vendors use made-up .test addresses that can never receive mail.
  if (/\.test$/i.test(to)) return { sent: false, reason: "not_configured" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text }),
    });
    if (!res.ok) {
      console.error("Email send failed", res.status);
      return { sent: false, reason: "failed" };
    }
    return { sent: true };
  } catch (error) {
    console.error("Email send failed", error);
    return { sent: false, reason: "failed" };
  }
}
