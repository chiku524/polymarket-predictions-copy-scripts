type AlertSeverity = "info" | "warning" | "critical";

const ALERT_WEBHOOK_URL = process.env.ALERT_WEBHOOK_URL?.trim();
const ALERT_WEBHOOK_TOKEN = process.env.ALERT_WEBHOOK_TOKEN?.trim();

export async function sendAlert(params: {
  title: string;
  severity?: AlertSeverity;
  details?: Record<string, unknown>;
}): Promise<void> {
  if (!ALERT_WEBHOOK_URL) return;

  const severity = params.severity ?? "warning";
  const body = {
    source: "polymarket-paired-trader",
    severity,
    title: params.title,
    timestamp: new Date().toISOString(),
    details: params.details ?? {},
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (ALERT_WEBHOOK_TOKEN) {
    headers.authorization = `Bearer ${ALERT_WEBHOOK_TOKEN}`;
  }

  try {
    const res = await fetch(ALERT_WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("Alert webhook error:", res.status, res.statusText);
    }
  } catch (e) {
    console.error("Alert webhook request failed:", e);
  }
}
