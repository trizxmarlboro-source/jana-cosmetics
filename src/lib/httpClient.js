export class PaymentApiError extends Error {
  constructor(message, { status, provider, responseBody }) {
    super(message);
    this.name = "PaymentApiError";
    this.status = status;
    this.provider = provider;
    this.responseBody = responseBody;
  }
}

export async function requestJson(url, options = {}, provider = "payment-provider") {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers ?? {})
    }
  });

  const text = await response.text();
  let responseBody = null;
  if (text) {
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = { message: text };
    }
  }

  if (!response.ok) {
    throw new PaymentApiError(`${provider} respondeu com status ${response.status}`, {
      status: response.status,
      provider,
      responseBody
    });
  }

  return responseBody;
}
