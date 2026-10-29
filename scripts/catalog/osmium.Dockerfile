# osmium-tool from Debian's own package archive (no third-party image). Used only on the machine that builds the place catalog:
#   docker build -t trailmate-osmium -f scripts/catalog/osmium.Dockerfile scripts/catalog
FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends osmium-tool ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /data
ENTRYPOINT ["osmium"]
