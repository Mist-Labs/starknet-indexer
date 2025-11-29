import { hash } from "starknet";

// Calculate event selectors using starknet_keccak
export const DEPOSIT_EVENT_KEY = hash.getSelectorFromName("Deposit");
export const HTLC_CREATED_EVENT_KEY = hash.getSelectorFromName("HTLCCreated");
export const WITHDRAWAL_EVENT_KEY = hash.getSelectorFromName("Withdrawal");

console.log("Event Selectors:");
console.log("Deposit:", DEPOSIT_EVENT_KEY);
console.log("HTLCCreated:", HTLC_CREATED_EVENT_KEY);
console.log("Withdrawal:", WITHDRAWAL_EVENT_KEY);