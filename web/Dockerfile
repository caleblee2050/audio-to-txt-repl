# Build stage: compile the frontend
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime stage: run Express server to serve API and built frontend
FROM node:18-alpine
WORKDIR /app
ENV NODE_ENV=production

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built assets and server code
COPY --from=builder /app/dist /app/dist
COPY server /app/server

# Cloud Run provides PORT; ensure the app listens on it
ENV PORT=8080
EXPOSE 8080

CMD ["node", "server/index.js"]

