// src/utils/paymentProviders.ts
//
// Shared payment provider detection logic for todos

/**
 * Known UK school payment providers with their parent portal URLs
 */
export const PAYMENT_PROVIDERS: Record<string, { name: string; url: string }> = {
  arbor: { name: 'Arbor', url: 'https://login.arbor.sc/' },
  scopay: { name: 'Scopay', url: 'https://www.scopay.com/login' },
  classlist: { name: 'Classlist', url: 'https://app.classlist.com/' },
  parentpay: { name: 'ParentPay', url: 'https://www.parentpay.com/' },
  schoolmoney: { name: 'SchoolMoney', url: 'https://www.schoolmoney.co.uk/' },
  parentmail: { name: 'ParentMail', url: 'https://www.parentmail.co.uk/' },
  wisepay: { name: 'WisePay', url: 'https://www.wisepay.co.uk/' },
  'school gateway': { name: 'School Gateway', url: 'https://login.schoolgateway.com/' },
  tucasi: { name: 'Tucasi', url: 'https://www.tucasi.com/' },
  'sims pay': { name: 'SIMS Pay', url: 'https://www.simspay.co.uk/' },
  pay360: { name: 'Pay360', url: 'https://www.pay360educationpayments.com/' },
};

export interface PaymentProviderInfo {
  name: string;
  url: string | null;
}

/**
 * Check if an amount string is valid (not null, empty, or invalid placeholder values)
 * Filters out: null, "null", ":null", "/null", empty strings, etc.
 */
export function isValidAmount(amount: string | null | undefined): amount is string {
  if (!amount) return false;
  const trimmed = amount.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'null' || trimmed === ':null' || trimmed === '/null') {
    return false;
  }
  return true;
}

/**
 * Extract payment provider info from a todo description
 * Returns provider name and default URL if known
 */
export function extractPaymentProvider(description: string): PaymentProviderInfo | null {
  const descLower = description.toLowerCase();

  // First, check if any known provider appears in the description
  for (const [key, provider] of Object.entries(PAYMENT_PROVIDERS)) {
    if (descLower.includes(key)) {
      return { name: provider.name, url: provider.url };
    }
  }

  // Check for "via [Provider]" pattern for unknown providers
  const viaMatch = description.match(/via\s+(\w+)/i);
  if (viaMatch) {
    return { name: viaMatch[1], url: null };
  }

  return null;
}

/**
 * Get the effective payment URL for a todo
 * Returns the todo's URL if it exists, otherwise tries to detect from description
 */
export function getPaymentUrl(todo: { url?: string | null; type: string; description: string }): string | null {
  // If todo has a direct URL, use it
  if (todo.url) {
    return todo.url;
  }

  // For PAY type todos, try to detect payment provider
  if (todo.type === 'PAY') {
    const provider = extractPaymentProvider(todo.description);
    if (provider?.url) {
      return provider.url;
    }
  }

  return null;
}

/**
 * Check if a URL string is valid (not null, empty, or invalid placeholder values)
 * Filters out: null, "null", ":null", "/null", empty strings, etc.
 */
function isValidUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  const trimmed = url.trim().toLowerCase();
  if (trimmed === '' || trimmed === 'null' || trimmed === ':null' || trimmed === '/null') {
    return false;
  }
  return true;
}

/**
 * Get payment button info for a todo
 * Returns label and URL for the payment button, or null if no payment action
 * Only shows payment buttons for PAY type todos
 */
export function getPaymentButtonInfo(todo: { url?: string | null; type: string; description: string }): { label: string; url: string } | null {
  // Only show payment buttons for PAY type todos
  if (todo.type !== 'PAY') {
    return null;
  }

  // If todo has a valid direct URL, use it
  if (isValidUrl(todo.url)) {
    return { label: 'Pay Now →', url: todo.url };
  }

  // Try to detect payment provider from description
  const provider = extractPaymentProvider(todo.description);
  if (provider?.url) {
    return { label: `Pay via ${provider.name} →`, url: provider.url };
  }

  return null;
}
