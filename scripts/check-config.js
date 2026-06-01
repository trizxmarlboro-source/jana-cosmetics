import { env } from "../src/config/env.js";

const checks = [
  ["NODE_ENV", env.nodeEnv],
  ["MISTIC_PAY_CLIENT_ID", env.misticPay.clientId],
  ["MISTIC_PAY_CLIENT_SECRET", env.misticPay.clientSecret],
  ["MISTIC_PAY_WEBHOOK_URL", env.misticPay.webhookUrl || "opcional"]
];

for (const [name, value] of checks) {
  const status = value && !value.startsWith("YOUR_") ? "configurada" : "placeholder";
  console.log(`${name}: ${status}`);
}
