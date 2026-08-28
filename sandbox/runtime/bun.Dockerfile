FROM oven/bun:1.3.14-alpine

# Trusted bootstrap only. Repository source and host secrets are never copied
# into this image; the repository runs only in the hardened execution phase.
RUN apk add --no-cache git libc6-compat \
    && mkdir -p /workspace /home/sandbox \
    && chown -R 1000:1000 /workspace /home/sandbox

ENV HOME=/home/sandbox
WORKDIR /workspace
USER 1000:1000
