import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ENV_PATH = resolve(process.cwd(), ".env");

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const result = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    result[key] = rawValue.replace(/^["']|["']$/g, "");
  }

  return result;
}

const fileEnv = parseEnvFile(ENV_PATH);

function readEnv(name, fallback = "") {
  return process.env[name] ?? fileEnv[name] ?? fallback;
}

export const env = {
  nodeEnv: readEnv("NODE_ENV", "development"),
  admin: {
    user: readEnv("ADMIN_USER"),
    password: readEnv("ADMIN_PASSWORD"),
    sessionSecret: readEnv("ADMIN_SESSION_SECRET"),
    sessionTtlSeconds: Number(readEnv("ADMIN_SESSION_TTL_SECONDS", "1800"))
  },
  customer: {
    sessionSecret: readEnv("CUSTOMER_SESSION_SECRET"),
    sessionTtlSeconds: Number(readEnv("CUSTOMER_SESSION_TTL_SECONDS", "2592000"))
  },
  google: {
    clientId: readEnv("GOOGLE_CLIENT_ID")
  },
  misticPay: {
    clientId: readEnv("MISTIC_PAY_CLIENT_ID"),
    clientSecret: readEnv("MISTIC_PAY_CLIENT_SECRET"),
    webhookUrl: readEnv("MISTIC_PAY_WEBHOOK_URL"),
    defaultDocument: readEnv("MISTIC_PAY_DEFAULT_DOCUMENT", "00000000000"),
    baseUrl: "https://api.misticpay.com/api"
  },
  checkout: {
    pixDiscountRate: Number(readEnv("PIX_DISCOUNT_RATE", "0.05"))
  }
};

export function assertRequiredEnv(requiredNames) {
  const missing = requiredNames.filter((name) => !readEnv(name) || readEnv(name).startsWith("YOUR_"));

  if (missing.length > 0) {
    throw new Error(`Variaveis de ambiente ausentes ou ainda com placeholder: ${missing.join(", ")}`);
  }
}
