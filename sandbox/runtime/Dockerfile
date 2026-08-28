FROM golang:1.26.5-alpine AS go-runtime

FROM ai-product/alpine-edge-node:20260826

COPY --from=go-runtime /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:${PATH}

# Trusted bootstrap only: this image never contains repository source or host
# secrets. The numeric identity is also enforced again by docker run.
RUN apk add --no-cache pnpm \
    && addgroup -g 1000 sandbox \
    && adduser -D -H -u 1000 -G sandbox sandbox \
    && mkdir -p /workspace /home/sandbox \
    && chown -R 1000:1000 /workspace /home/sandbox

ENV HOME=/home/sandbox
WORKDIR /workspace
USER 1000:1000
