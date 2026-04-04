#!/bin/bash
# Build the cli-claw agent container image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

IMAGE_NAME="cli-claw-agent"
TAG="${1:-latest}"

echo "Building cli-claw agent container image..."
echo "Image: ${IMAGE_NAME}:${TAG}"

# Build with Docker (CACHEBUST ensures claude-code is always latest)
# --progress=plain ensures clean line-based output for piped log capture (WebSocket streaming)
docker build --progress=plain --build-arg CACHEBUST="$(date +%s)" -f "$SCRIPT_DIR/Dockerfile" -t "${IMAGE_NAME}:${TAG}" "$ROOT_DIR"

echo ""
echo "Build complete!"
echo "Image: ${IMAGE_NAME}:${TAG}"

# Touch sentinel so Makefile can detect stale image
touch "$ROOT_DIR/.docker-build-sentinel"

echo ""
echo "Test with:"
echo "  printf '%s' '{\"prompt\":\"What is 2+2?\",\"groupFolder\":\"test\",\"chatJid\":\"test@g.us\",\"isMain\":false}' | docker run -i ${IMAGE_NAME}:${TAG}"
