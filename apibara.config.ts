import { defineConfig } from "apibara/config";

export default defineConfig({
  runtimeConfig: {
    shadowSwapIndexer: {
      startingBlock: 3200350,
      streamUrl: "https://sepolia.starknet.a5a.ch",
    },
  },
});
