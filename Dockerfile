FROM node:22
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN npm install -g corepack@latest && corepack enable

WORKDIR /app
COPY . .

# Install dependencies
ENV CI=true
RUN pnpm install

# Build indexers
RUN pnpm build

# Start the indexer
ENTRYPOINT ["node", ".apibara/build/start.mjs"]