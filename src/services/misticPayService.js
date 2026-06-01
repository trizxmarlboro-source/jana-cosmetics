import { randomUUID } from "node:crypto";
import { env, assertRequiredEnv } from "../config/env.js";
import { requestJson } from "../lib/httpClient.js";

function misticPayHeaders() {
  assertRequiredEnv(["MISTIC_PAY_CLIENT_ID", "MISTIC_PAY_CLIENT_SECRET"]);

  return {
    ci: env.misticPay.clientId,
    cs: env.misticPay.clientSecret
  };
}

export async function createMisticPayPixTransaction({
  amount,
  payerName,
  payerDocument,
  transactionId = randomUUID(),
  description,
  projectWebhook = env.misticPay.webhookUrl,
  splitUser,
  splitTax
}) {
  const body = {
    amount: Number(amount),
    payerName,
    payerDocument,
    transactionId,
    description,
    ...(projectWebhook ? { projectWebhook } : {}),
    ...(splitUser ? { splitUser } : {}),
    ...(splitTax ? { splitTax: Number(splitTax) } : {})
  };

  return requestJson(
    `${env.misticPay.baseUrl}/transactions/create`,
    {
      method: "POST",
      headers: misticPayHeaders(),
      body: JSON.stringify(body)
    },
    "MisticPay"
  );
}

export async function checkMisticPayTransaction(transactionId) {
  return requestJson(
    `${env.misticPay.baseUrl}/transactions/check`,
    {
      method: "POST",
      headers: misticPayHeaders(),
      body: JSON.stringify({ transactionId })
    },
    "MisticPay"
  );
}

export async function getMisticPayBalance() {
  return requestJson(
    `${env.misticPay.baseUrl}/users/balance`,
    {
      method: "GET",
      headers: misticPayHeaders()
    },
    "MisticPay"
  );
}
