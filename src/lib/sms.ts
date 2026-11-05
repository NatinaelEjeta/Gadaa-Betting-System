import "server-only";

/**
 * Sends an SMS. SMS_PROVIDER=afromessage uses Afro Message (needs the env vars below).
 * Otherwise (development) the message is printed in the server console.
 */
export async function sendSms(phone: string, message: string): Promise<void> {
  const provider = process.env.SMS_PROVIDER ?? "console";

  if (provider === "afromessage") {
    const token = process.env.AFROMESSAGE_TOKEN;
    if (!token) throw new Error("AFROMESSAGE_TOKEN is not set");
    const res = await fetch("https://api.afromessage.com/api/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.AFROMESSAGE_IDENTIFIER_ID || undefined,
        sender: process.env.AFROMESSAGE_SENDER || undefined,
        to: phone.replace(/^\+/, ""),
        message,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { acknowledge?: string };
    if (!res.ok || (body.acknowledge && body.acknowledge !== "success")) {
      throw new Error("SMS provider rejected the message");
    }
    return;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("No SMS provider configured");
  }
  console.log(`[sms:dev] to ${phone}: ${message}`);
}