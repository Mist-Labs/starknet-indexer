import { defineIndexer } from "apibara/indexer";
import { useLogger } from "apibara/plugins";
import { htlc_events } from "lib/schema";
import { useDrizzleStorage } from "@apibara/plugin-drizzle";
import { drizzle } from "@apibara/plugin-drizzle";
import { StarknetStream } from "@apibara/starknet";
import type { ApibaraRuntimeConfig } from "apibara/types";
import { eq, and } from "drizzle-orm";
import {
  sendEventToRelayer,
  validateRelayerVariables,
} from "utils/relayerApi";
import {
  DEPOSIT_EVENT_KEY,
  HTLC_CREATED_EVENT_KEY,
  WITHDRAWAL_EVENT_KEY,
} from "utils/eventSelectors";

// Pool addresses
const FAST_POOL_ADDRESS =
  "0x01749627bb08da4f8c3df6c55045ac429abdceada025262d4c51430d643db84e";
const STANDARD_POOL_ADDRESS =
  "0x05cf3a281b3932cb4fec5648558c05fe796bd2d1b6e75554e3306c4849b82ed8";

interface DepositEvent {
  commitment: string;
  leaf_index: number;
  timestamp: bigint;
}

interface HTLCCreatedEvent {
  nullifier: string;
  hash_lock: string;
  timelock: bigint;
  timestamp: bigint;
}

interface WithdrawalEvent {
  nullifier: string;
  timestamp: bigint;
}

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

function decodeDepositEvent(event: any): DepositEvent | null {
  try {
    const { data, keys } = event;

    // Keys[0] is the event selector, keys[1] is the commitment (marked with #[key])
    const commitment = keys[1];
    const leaf_index = Number(data[0]);
    const timestamp = BigInt(data[1]);

    return {
      commitment,
      leaf_index,
      timestamp,
    };
  } catch (error) {
    console.error("Error decoding Deposit event:", error);
    return null;
  }
}

function decodeHTLCCreatedEvent(event: any): HTLCCreatedEvent | null {
  try {
    const { data, keys } = event;

    // Keys[0] is the event selector, keys[1] is the nullifier (marked with #[key])
    const nullifier = keys[1];
    const hash_lock = data[0];
    const timelock = BigInt(data[1]);
    const timestamp = BigInt(data[2]);

    return {
      nullifier,
      hash_lock,
      timelock,
      timestamp,
    };
  } catch (error) {
    console.error("Error decoding HTLCCreated event:", error);
    return null;
  }
}

function decodeWithdrawalEvent(event: any): WithdrawalEvent | null {
  try {
    const { data, keys } = event;

    // Keys[0] is the event selector, keys[1] is the nullifier (marked with #[key])
    const nullifier = keys[1];
    const timestamp = BigInt(data[0]);

    return {
      nullifier,
      timestamp,
    };
  } catch (error) {
    console.error("Error decoding Withdrawal event:", error);
    return null;
  }
}

function getEventType(event: any): string | null {
  const keys = event.keys || [];

  if (!keys.length) return null;

  const eventKey = keys[0];

  if (eventKey === DEPOSIT_EVENT_KEY) return "deposit";
  if (eventKey === HTLC_CREATED_EVENT_KEY) return "htlc_created";
  if (eventKey === WITHDRAWAL_EVENT_KEY) {
    return "htlc_redeemed";
  }

  return null;
}

function isFromPoolContract(event: any): boolean {
  const fromAddress = event.fromAddress?.toLowerCase();
  return (
    fromAddress === FAST_POOL_ADDRESS.toLowerCase() ||
    fromAddress === STANDARD_POOL_ADDRESS.toLowerCase()
  );
}

export default function (runtimeConfig: ApibaraRuntimeConfig) {
  const { startingBlock, streamUrl } = runtimeConfig["shadowSwapIndexer"];

  const db = drizzle({
    schema: {
      htlc_events,
    },
  });

  return defineIndexer(StarknetStream)({
    streamUrl,
    finality: "accepted",
    startingBlock: BigInt(startingBlock),
    filter: {
      header: "always",
      events: [
        {
          address: FAST_POOL_ADDRESS as `0x${string}`,
          keys: [
            DEPOSIT_EVENT_KEY as `0x${string}`,
            HTLC_CREATED_EVENT_KEY as `0x${string}`,
            WITHDRAWAL_EVENT_KEY as `0x${string}`,
          ],
        },
        {
          address: STANDARD_POOL_ADDRESS as `0x${string}`,
          keys: [
            DEPOSIT_EVENT_KEY as `0x${string}`,
            HTLC_CREATED_EVENT_KEY as `0x${string}`,
            WITHDRAWAL_EVENT_KEY as `0x${string}`,
          ],
        },
      ],
    },

    async transform({ block }) {
      const logger = useLogger();

      // Validate environment variables
      const envCheck = validateRelayerVariables();
      if (!envCheck.isValid) {
        logger.error("Invalid relayer configuration", {
          missingVars: envCheck.missingVars,
        });
        throw new Error(
          `Missing required environment variables: ${envCheck.missingVars.join(
            ", "
          )}`
        );
      }

      logger.info(
        `Processing block: ${block.header.blockNumber}, events: ${block.events.length}`
      );

      for (const event of block.events) {
        try {
          // Filter events from pool contracts only
          if (!isFromPoolContract(event)) {
            logger.debug("Skipping event from non-pool contract");
            continue;
          }

          const eventType = getEventType(event);

          if (!eventType) {
            logger.debug("Skipping non-Shadow Swap event");
            continue;
          }

          logger.info(`Processing ${eventType} event`, {
            txHash: event.transactionHash,
            fromAddress: event.address,
          });

          // Check for duplicates
          const { db: storageDb } = useDrizzleStorage();
          const eventId = `${event.transactionHash}_${eventType}`;

          const existing = await storageDb
            .select()
            .from(htlc_events)
            .where(eq(htlc_events.eventId, eventId))
            .limit(1);

          if (existing.length > 0) {
            logger.info("Event already processed, skipping", {
              eventId,
              txHash: event.transactionHash,
            });
            continue;
          }

          // Decode event based on type
          let eventData: any = {};
          let swapId = "";
          let swapEventData: SwapEventData = {
            event_type: eventType as any,
            chain: "starknet",
            transaction_hash: event.transactionHash,
          };

          switch (eventType) {
            case "deposit":
              const deposit = decodeDepositEvent(event);
              if (!deposit) {
                logger.warn("Failed to decode Deposit event", {
                  txHash: event.transactionHash,
                });
                continue;
              }

              swapId = deposit.commitment;
              eventData = {
                commitment: deposit.commitment,
                leaf_index: deposit.leaf_index,
                timestamp: deposit.timestamp.toString(),
              };
              swapEventData.commitment = deposit.commitment;
              break;

            case "htlc_created":
              const htlc = decodeHTLCCreatedEvent(event);
              if (!htlc) {
                logger.warn("Failed to decode HTLCCreated event", {
                  txHash: event.transactionHash,
                });
                continue;
              }

              swapId = htlc.nullifier;
              eventData = {
                nullifier: htlc.nullifier,
                hash_lock: htlc.hash_lock,
                timelock: htlc.timelock.toString(),
                timestamp: htlc.timestamp.toString(),
              };
              swapEventData.nullifier = htlc.nullifier;
              swapEventData.hash_lock = htlc.hash_lock;
              swapEventData.timelock = htlc.timelock.toString();
              break;

            case "htlc_redeemed":
              const withdrawal = decodeWithdrawalEvent(event);
              if (!withdrawal) {
                logger.warn("Failed to decode Withdrawal event", {
                  txHash: event.transactionHash,
                });
                continue;
              }

              swapId = withdrawal.nullifier;
              eventData = {
                nullifier: withdrawal.nullifier,
                timestamp: withdrawal.timestamp.toString(),
              };
              swapEventData.nullifier = withdrawal.nullifier;
              break;

            default:
              logger.warn(`Unknown event type: ${eventType}`);
              continue;
          }

          // Store in database
          await storageDb.insert(htlc_events).values({
            eventId,
            swapId,
            eventType,
            eventData,
            chain: "starknet",
            blockNumber: Number(block.header.blockNumber),
            transactionHash: event.transactionHash,
            timestamp: new Date(),
            createdAt: new Date(),
          });

          logger.info("Event stored in database", {
            eventId,
            eventType,
            swapId,
            txHash: event.transactionHash,
          });

          // Send to relayer
          const relayerSuccess = await sendEventToRelayer(
            swapEventData,
            logger
          );

          if (!relayerSuccess) {
            logger.warn("Failed to notify relayer (event stored in DB)", {
              eventType,
              txHash: event.transactionHash,
            });
          } else {
            logger.info("Event successfully sent to relayer", {
              eventType,
              txHash: event.transactionHash,
            });
          }
        } catch (error: any) {
          logger.error("Error processing event:", {
            error: error.message,
            stack: error.stack,
            txHash: event.transactionHash,
          });
        }
      }
    },
  });
}