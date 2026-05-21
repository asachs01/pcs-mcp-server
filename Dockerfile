# Multi-stage build for pcs-mcp-server
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code and build configuration
COPY src ./src
COPY tsconfig.json ./

# Clean any existing build artifacts and build
RUN npm run build

# Remove dev dependencies
RUN npm prune --omit=dev

# Runtime stage
FROM node:22-alpine

# Install wget for healthcheck
RUN apk add --no-cache wget

# Create non-root user
RUN addgroup -g 1001 -S mcp && adduser -S mcp -u 1001

WORKDIR /app

# Copy built application and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Switch to non-root user
USER mcp

# Expose port
EXPOSE 3000

# Set runtime environment variables
ENV TRANSPORT=http
ENV PORT=3000
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
ENTRYPOINT ["node", "dist/index.js"]