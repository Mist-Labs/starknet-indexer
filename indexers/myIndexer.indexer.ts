import { defineIndexer } from "apibara/indexer";
import { useLogger } from "apibara/plugins";
import { htlc_events } from "lib/schema";
import { drizzleStorage, useDrizzleStorage } from "@apibara/plugin-drizzle";
import { drizzle } from "@apibara/plugin-drizzle";
import { StarknetStream } from "@apibara/starknet";
import type { ApibaraRuntimeConfig } from "apibara/types";
import { eq } from "drizzle-orm";
import { sendEventToRelayer, validateRelayerVariables } from "utils/relayerApi";
// import {
//   DEPOSIT_EVENT_KEY,
//   HTLC_CREATED_EVENT_KEY,
//   WITHDRAWAL_EVENT_KEY,
// } from "utils/eventSelectors";

export const DEPOSIT_EVENT_KEY =
  "0x009149d2123147c5f43d258257fef0b7b969db78269369ebcf5ebb9eef8592f2";
export const HTLC_CREATED_EVENT_KEY =
  "0x001548a4d5508e503975e8ef480a1b0f2b55fe480799be7764b93828870abae16";
export const WITHDRAWAL_EVENT_KEY =
  "0x002eed7e29b3502a726faf503ac4316b7101f3da813654e8df02c13449e03da8";

const FAST_POOL_ADDRESS =
  "0x01749627bb08da4f8c3df6c55045ac429abdceada025262d4c51430d643db84e".toLowerCase();
const STANDARD_POOL_ADDRESS =
  "0x05cf3a281b3932cb4fec5648558c05fe796bd2d1b6e75554e3306c4849b82ed8".toLowerCase();

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
  timelock?: BigInt;
  timestamp?: BigInt;
  secret?: string;
  pool_type?: string;
}

function decodeDepositEvent(event: any): DepositEvent | null {
  try {
    const { data, keys } = event;
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
  if (eventKey === WITHDRAWAL_EVENT_KEY) return "htlc_redeemed";

  return null;
}

function isFromPoolContract(event: any): boolean {
  const fromAddress = event.address?.toLowerCase();
  return (
    fromAddress === FAST_POOL_ADDRESS || fromAddress === STANDARD_POOL_ADDRESS
  );
}

function determinePoolType(event: any): string {
  const addr = event.address?.toLowerCase();
  if (addr === FAST_POOL_ADDRESS) return "fast";
  if (addr === STANDARD_POOL_ADDRESS) return "standard";
  return "fast";
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
      header: "on_data",
      events: [
        // FAST POOL EVENTS
        {
          address: FAST_POOL_ADDRESS as `0x${string}`,
          keys: [DEPOSIT_EVENT_KEY as `0x${string}`],
        },
        {
          address: FAST_POOL_ADDRESS as `0x${string}`,
          keys: [HTLC_CREATED_EVENT_KEY as `0x${string}`],
        },
        {
          address: FAST_POOL_ADDRESS as `0x${string}`,
          keys: [WITHDRAWAL_EVENT_KEY as `0x${string}`],
        },
        // STANDARD POOL EVENTS
        {
          address: STANDARD_POOL_ADDRESS as `0x${string}`,
          keys: [DEPOSIT_EVENT_KEY as `0x${string}`],
        },
        {
          address: STANDARD_POOL_ADDRESS as `0x${string}`,
          keys: [HTLC_CREATED_EVENT_KEY as `0x${string}`],
        },
        {
          address: STANDARD_POOL_ADDRESS as `0x${string}`,
          keys: [WITHDRAWAL_EVENT_KEY as `0x${string}`],
        },
      ],
    },
    // plugins: [drizzleStorage({ db })],

    async transform({ block }) {
      const logger = useLogger();

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
        `📦 Processing block ${block.header.blockNumber} with ${block.events.length} events`
      );

      if (block.events.length > 0) {
        logger.info("Block events summary:", {
          events: block.events.map((e) => ({
            from: e.address?.toLowerCase(),
            key: e.keys?.[0],
            txHash: e.transactionHash,
          })),
        });
      }

      for (const event of block.events) {
        const fromAddress = event.address?.toLowerCase();

        logger.info("🔍 Processing event", {
          fromAddress,
          firstKey: event.keys?.[0],
          txHash: event.transactionHash,
          eventIndex: event.eventIndex,
        });

        if (!isFromPoolContract(event)) {
          logger.debug("⏭️ Skipping non-pool contract event", {
            fromAddress,
          });
          continue;
        }

        const eventType = getEventType(event);

        if (!eventType) {
          logger.warn("⚠️ Could not determine event type", {
            keys: event.keys,
            fromAddress,
            txHash: event.transactionHash,
            knownKeys: {
              deposit: DEPOSIT_EVENT_KEY,
              htlcCreated: HTLC_CREATED_EVENT_KEY,
              withdrawal: WITHDRAWAL_EVENT_KEY,
            },
          });
          continue;
        }

        logger.info(`✨ Processing ${eventType} event`, {
          txHash: event.transactionHash,
          fromAddress,
          blockNumber: block.header.blockNumber,
        });

        const poolType = determinePoolType(event);
        let eventData: any = {};
        let swapId = "";

        try {
          switch (eventType) {
            case "deposit":
              const deposit = decodeDepositEvent(event);
              if (!deposit) {
                logger.error("❌ Failed to decode Deposit event", {
                  txHash: event.transactionHash,
                  keys: event.keys,
                  data: event.data,
                });
                continue;
              }
              swapId = deposit.commitment;
              eventData = {
                commitment: deposit.commitment,
                leaf_index: Number(deposit.leaf_index),
                timestamp: Number(deposit.timestamp),
              };
              break;

            case "htlc_created":
              const htlc = decodeHTLCCreatedEvent(event);
              if (!htlc) {
                logger.error("❌ Failed to decode HTLCCreated event", {
                  txHash: event.transactionHash,
                  keys: event.keys,
                  data: event.data,
                });
                continue;
              }
              swapId = htlc.nullifier;
              eventData = {
                nullifier: htlc.nullifier,
                hash_lock: htlc.hash_lock,
                timelock: Number(htlc.timelock),
                timestamp: Number(htlc.timestamp),
              };
              break;

            case "htlc_redeemed":
              const withdrawal = decodeWithdrawalEvent(event);
              if (!withdrawal) {
                logger.error("❌ Failed to decode Withdrawal event", {
                  txHash: event.transactionHash,
                  keys: event.keys,
                  data: event.data,
                });
                continue;
              }
              swapId = withdrawal.nullifier;
              eventData = {
                nullifier: withdrawal.nullifier,
                timestamp: Number(withdrawal.timestamp),
              };
              break;

            default:
              logger.warn(`⚠️ Unknown event type: ${eventType}`);
              continue;
          }
        } catch (error: any) {
          logger.error("❌ Error decoding event:", {
            error: error.message,
            txHash: event.transactionHash,
          });
          continue;
        }

        const swapEventData: SwapEventData = {
          event_type: eventType as any,
          chain: "starknet",
          transaction_hash: event.transactionHash,
          pool_type: poolType,
          ...eventData,
        };

        try {
          const relayerSuccess = await sendEventToRelayer(
            swapEventData,
            logger
          );

          if (!relayerSuccess) {
            logger.warn("⚠️ Failed to notify relayer", {
              eventType,
              txHash: event.transactionHash,
            });
          } else {
            logger.info("✅ Event successfully sent to relayer", {
              eventType,
              txHash: event.transactionHash,
            });
          }
        } catch (relayerError: any) {
          logger.error("❌ Relayer call failed:", {
            error: relayerError.message,
            txHash: event.transactionHash,
          });
        }

        try {
          const { db: storageDb } = useDrizzleStorage();
          const eventId = `${event.transactionHash}_${
            event.eventIndex || 0
          }_${eventType}`;

          const existing = await storageDb
            .select()
            .from(htlc_events)
            .where(eq(htlc_events.eventId, eventId))
            .limit(1);

          if (existing.length > 0) {
            logger.info("⏭️ Event already in database, skipping save", {
              eventId,
              txHash: event.transactionHash,
            });
            continue;
          }

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
            inMerkleTree: false,
            poolType: poolType,
          });

          logger.info("✅ Event stored in database", {
            eventId,
            eventType,
            poolType,
            blockNumber: block.header.blockNumber,
          });
        } catch (dbError: any) {
          logger.warn("⚠️ Failed to save to database (non-critical)", {
            error: dbError.message,
            txHash: event.transactionHash,
            eventType,
          });
        }
      }
    },
  });
}
