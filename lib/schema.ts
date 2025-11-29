import {
  serial,
  pgTable,
  text,
  bigint,
  timestamp,
  jsonb,
  varchar,
} from "drizzle-orm/pg-core";

export const htlc_events = pgTable("htlc_events", {
  id: serial("id").primaryKey(),
  eventId: varchar("event_id", { length: 66 }).notNull().unique(),
  swapId: varchar("swap_id", { length: 66 }).notNull(),
  eventType: varchar("event_type", { length: 20 }).notNull(),
  eventData: jsonb("event_data").notNull(),
  chain: varchar("chain", { length: 20 }).notNull(),
  blockNumber: bigint("block_number", { mode: "number" }).notNull(),
  transactionHash: varchar("transaction_hash", { length: 66 }).notNull(),
  timestamp: timestamp("timestamp").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});