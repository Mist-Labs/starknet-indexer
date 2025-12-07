import { defineConfig } from "apibara/config";

export default defineConfig({
  runtimeConfig: {
    shadowSwapIndexer: {
      startingBlock: 3496960,
      streamUrl: "https://sepolia.starknet.a5a.ch",
    },
  },
});
