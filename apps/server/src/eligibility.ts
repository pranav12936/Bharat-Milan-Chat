import { config } from './config.js';

export type Eligibility = 'pending' | 'rejected' | 'accepted';

const demoStates = new Map<string, Eligibility>();
const pair = (a: string, b: string) => [a, b].sort().join(':');

export async function eligible(a: string, b: string): Promise<boolean> {
  if (a === b) {
    console.error('[chat eligibility] Denied: sender and recipient IDs are identical.');
    return false;
  }

  if (config.DEMO_ELIGIBILITY_MODE === 'true') {
    return demoStates.get(pair(a, b)) === 'accepted';
  }

  if (!config.BHARAT_MILAN_ELIGIBILITY_URL || !config.BHARAT_MILAN_SERVICE_TOKEN) {
    console.error('[chat eligibility] Missing eligibility URL or service token.');
    return false;
  }

  try {
    const response = await fetch(config.BHARAT_MILAN_ELIGIBILITY_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.BHARAT_MILAN_SERVICE_TOKEN}`,
      },
      body: JSON.stringify({
        senderUserId: a,
        recipientUserId: b,
      }),
      signal: AbortSignal.timeout(10000),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(
        `[chat eligibility] API returned HTTP ${response.status}:`,
        responseText.slice(0, 500),
      );
      return false;
    }

    let value: unknown;

    try {
      value = JSON.parse(responseText);
    } catch {
      console.error('[chat eligibility] API returned invalid JSON.');
      return false;
    }

    if (!value || typeof value !== 'object') {
      console.error('[chat eligibility] API returned an unexpected response.');
      return false;
    }

    const isEligible = (value as { eligible?: unknown }).eligible === true;

    if (!isEligible) {
      console.error(
        '[chat eligibility] API responded eligible=false. Check accepted-interest status and member IDs in Bharat Milan.',
      );
    }

    return isEligible;
  } catch (error) {
    console.error('[chat eligibility] Request failed:', error);
    return false;
  }
}

export function setDemoEligibility(
  a: string,
  b: string,
  status: Eligibility,
) {
  if (config.DEMO_ELIGIBILITY_MODE !== 'true') {
    throw new Error('Demo eligibility disabled');
  }

  demoStates.set(pair(a, b), status);
}
