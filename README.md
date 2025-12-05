# ⚡ ShadowSwap Starknet Indexer
### _Real-time Starknet HTLC & Deposit Event Indexer + Secure Relayer Transport_

This service listens to **Starknet pool contracts**, decodes **HTLC + Deposit events**, stores them, and securely sends them to the **Rust Relayer** using **HMAC-signed webhook delivery**.

It is a core component of **ShadowSwap**, powering private STRK ↔ ZEC cross-chain swaps.

---

## 🚀 Features

### ✅ Starknet Event Indexing
- Monitors **FAST** & **STANDARD** pool contracts  
- Detects:
  - `Deposit`
  - `HTLC Created`
  - `HTLC Redeemed`

### 🔐 Secure Relayer Delivery
- HMAC-SHA256 signature
- Timestamp replay protection
- Retry logic (3x)
- Timeout-safe (60s)

### 🧰 Robust Decoding
- commitments  
- nullifiers  
- hashlocks  
- timelock  
- block metadata  

### 🗄 Database Persistence
- Uses **Drizzle ORM**
- Stores event history & swap metadata

### 🔥 Powered by Apibara
- Starknet streaming  
- Automatic state finality  
- Per-event logging  

---

## 🧩 Architecture Overview

```md
┌───────────────────────┐
│   Starknet Pools       │
│  (FAST / STANDARD)     │
└───────────┬────────────┘
            │  Events
            ▼
┌─────────────────────────────┐
│ ShadowSwap Indexer          │
│ - Apibara Stream            │
│ - Decoders                  │
│ - Pool Routing              │
└───────────┬─────────────────┘
            │  swapEventData
            ▼
┌─────────────────────────────┐
│ Secure Relayer API          │
│ - HMAC Signatures           │
│ - Retry Logic               │
│ - Timestamp Validation      │
└───────────┬─────────────────┘
            │ Validated Event
            ▼
┌─────────────────────────────┐
│ Rust Relayer Engine         │
│ - Cross-Chain Execution     │
│ - Zcash + Starknet HTLCs    │
└─────────────────────────────┘

 📡 Events Detected

| Event Type     | Meaning                              |
|----------------|--------------------------------------|
| `deposit`      | Shielded pool commitment inserted    |
| `htlc_created` | HTLC initialized                     |
| `htlc_redeemed`| HTLC unlocked with secret            |

---

 🧾 Payload Sent to Relayer

```json
{
  "event_type": "htlc_created",
  "chain": "starknet",
  "transaction_hash": "0xabc...",
  "nullifier": "0x123...",
  "hash_lock": "0x456...",
  "timelock": 123456789,
  "timestamp": 123456789,
  "pool_type": "fast"
}
```

## ⚙️ Processing Steps

1. **Decodes Starknet events**  
2. **Classifies event types:**
   - `deposit` → Shielded pool commitment inserted  
   - `htlc_created` → HTLC initialized  
   - `htlc_redeemed` → HTLC unlocked with secret  
3. **Stores event in Drizzle ORM**  
4. **Signs & sends event to Rust Relayer**  

---

## 🔧 Tech Stack

### **Languages / Frameworks**
- TypeScript  
- Node.js  
- Apibara Starknet Stream  
- Drizzle ORM  
- Crypto Primitives  
- Blockchain Concepts

## 🧠 How It Works

- **Filters only FAST & STANDARD pool addresses**  
- **Decodes Starknet events**  
- **Classifies event types**: `deposit`, `htlc_created`, `htlc_redeemed`  
- **Stores event in Drizzle ORM**  
- **Signs & sends event to Rust relayer**  
- **Retries up to 3 times on failure**  
- **Logs all decoding errors**  
- **Ignores unsupported events safely**  
- **Timeout after 60s**  

---

## 🛑 Error Handling

- **Retries failed relayer pushes** (up to 3x)  
- **Logs all decoding errors**  
- **Ignores unsupported events safely**  
- **Timeout after 60s**  

---

## 👥 Contributors

- **Okoli Evans**  
  GitHub: [@OkoliEvans](https://github.com/OkoliEvans)  
