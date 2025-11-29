import crypto from "crypto";

interface SwapEventData {
  event_type: "htlc_created" | "htlc_redeemed" | "htlc_refunded" | "deposit";
  chain: "starknet";
  transaction_hash: string;
  nullifier?: string;
  hash_lock?: string;
  commitment?: string;
  timelock?: string;
  secret?: string;
}

interface RelayerResponse {
  success: boolean;
  message: string;
  error?: string;
}

export function createHMACSignature(
  payload: string,
  secret: string,
  timestamp: string
): string {
  const message = timestamp + payload;
  return crypto.createHmac("sha256", secret).update(message).digest("hex");
}

async function waitForRetry(
  delayMs: number,
  transactionHash: string,
  nextAttempt: number,
  logger: any
): Promise<void> {
  logger.info(`Retrying in ${delayMs}ms...`, {
    transactionHash,
    nextAttempt,
  });
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function sendEventToRelayer(
  eventData: SwapEventData,
  logger: any
): Promise<boolean> {
  const maxRetries = 3;
  const timeoutMs = 60000;
  const retryDelayMs = 5000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const relayerUrl = process.env.RELAYER_URL;
      const hmacSecret = process.env.HMAC_SECRET;

      if (!relayerUrl || !hmacSecret) {
        logger.error("Missing required environment variables", {
          hasUrl: !!relayerUrl,
          hasSecret: !!hmacSecret,
        });
        return false;
      }

      const timestamp = Math.floor(Date.now() / 1000).toString();
      const payload = JSON.stringify(eventData);
      const signature = createHMACSignature(payload, hmacSecret, timestamp);

      logger.info(`Relayer API call attempt ${attempt}/${maxRetries}`, {
        eventType: eventData.event_type,
        endpoint: relayerUrl,
        transactionHash: eventData.transaction_hash,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(`${relayerUrl}/indexer/event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-timestamp": timestamp,
          "x-signature": signature,
        },
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        logger.error(`Relayer API failed with status ${response.status}`, {
          status: response.status,
          statusText: response.statusText,
          response: errorText,
          transactionHash: eventData.transaction_hash,
          attempt,
        });

        if (attempt === maxRetries) {
          logger.error("All HTTP retry attempts failed", {
            transactionHash: eventData.transaction_hash,
            eventType: eventData.event_type,
            finalStatus: response.status,
          });
          return false;
        }

        await waitForRetry(
          retryDelayMs,
          eventData.transaction_hash,
          attempt + 1,
          logger
        );
        continue;
      }

      const result: RelayerResponse = await response.json();
      if (result.success) {
        logger.info("Event sent to relayer successfully", {
          transactionHash: eventData.transaction_hash,
          attempt,
          eventType: eventData.event_type,
        });
        return true;
      } else {
        logger.warn("Relayer API returned success=false", {
          transactionHash: eventData.transaction_hash,
          attempt,
          message: result.message,
          error: result.error,
        });

        if (attempt === maxRetries) {
          logger.error("All attempts failed - Relayer success=false", {
            transactionHash: eventData.transaction_hash,
            eventType: eventData.event_type,
            finalMessage: result.message,
          });
          return false;
        }

        await waitForRetry(
          retryDelayMs,
          eventData.transaction_hash,
          attempt + 1,
          logger
        );
        continue;
      }
    } catch (error: any) {
      logger.warn(`Attempt ${attempt} failed with exception`, {
        error: error.message,
        transactionHash: eventData.transaction_hash,
        eventType: eventData.event_type,
        errorType: error.constructor.name,
      });

      if (attempt === maxRetries) {
        logger.error("All retry attempts failed with exceptions", {
          error: error.message,
          stack: error.stack,
          transactionHash: eventData.transaction_hash,
          eventType: eventData.event_type,
        });
        return false;
      }

      await waitForRetry(
        retryDelayMs,
        eventData.transaction_hash,
        attempt + 1,
        logger
      );
    }
  }

  return false;
}

export function validateRelayerVariables(): {
  isValid: boolean;
  missingVars: string[];
} {
  const requiredVars = ["RELAYER_URL", "HMAC_SECRET"];
  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  return {
    isValid: missingVars.length === 0,
    missingVars,
  };
}