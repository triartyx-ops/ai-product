FROM node:22-alpine

# Trusted bootstrap only. Repository source and host secrets are never copied
# into this image; runtime installation happens before the hardened phase.
RUN apk add --no-cache git libc6-compat \
    && corepack enable \
    && corepack prepare pnpm@11.21.0 --activate \
    && mkdir -p /workspace \
    && chown -R 1000:1000 /workspace

ENV HOME=/home/node
WORKDIR /workspace
USER 1000:1000
