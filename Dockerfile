# Build stage for frontend
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install dependencies (including dev dependencies needed for build)
RUN npm install

# Copy frontend source
COPY frontend/ ./

# Build frontend
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install dumb-init for proper signal handling and tzdata for timezone support
RUN apk add --no-cache dumb-init tzdata

# Copy root package files
COPY package*.json ./

# Copy backend package files
COPY backend/package*.json ./backend/

# Install production dependencies
RUN npm install --workspace=backend --omit=dev

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend from builder stage
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Create data directory
RUN mkdir -p /app/data && \
    chown -R node:node /app

# Set NODE_ENV to production by default
ENV NODE_ENV=production

# Add PUID/PGID support for Unraid compatibility
# Default to node user (1000:1000) if not specified
ENV PUID=1000 \
    PGID=1000

# Create entrypoint script to handle PUID/PGID
RUN echo '#!/bin/sh' > /entrypoint.sh && \
    echo 'if [ ! -z "$PUID" ] && [ "$PUID" != "1000" ]; then' >> /entrypoint.sh && \
    echo '  echo "Changing node user to PUID=$PUID, PGID=$PGID"' >> /entrypoint.sh && \
    echo '  deluser node 2>/dev/null || true' >> /entrypoint.sh && \
    echo '  addgroup -g $PGID node 2>/dev/null || true' >> /entrypoint.sh && \
    echo '  adduser -D -u $PUID -G node node 2>/dev/null || true' >> /entrypoint.sh && \
    echo '  chown -R node:node /app/data' >> /entrypoint.sh && \
    echo 'fi' >> /entrypoint.sh && \
    echo 'exec su-exec node dumb-init -- "$@"' >> /entrypoint.sh && \
    chmod +x /entrypoint.sh

# Install su-exec for user switching
RUN apk add --no-cache su-exec

# Use custom entrypoint that handles PUID/PGID
ENTRYPOINT ["/entrypoint.sh"]

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "backend/src/index.js"]
