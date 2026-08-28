FROM node:20-alpine

# Trusted bootstrap only. Repository source and host secrets are never copied
# into this image; the repository-pinned Yarn release runs in the hardened phase.
RUN apk add --no-cache git libc6-compat \
    && corepack enable \
    && mkdir -p /workspace \
    && chown -R 1000:1000 /workspace

ENV HOME=/home/node
WORKDIR /workspace
USER 1000:1000
