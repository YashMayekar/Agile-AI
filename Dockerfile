# -------------------------
# 1. Build stage
# -------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# install dependencies first (better caching)
COPY package*.json ./
RUN npm ci

# copy source
COPY . .

# build TypeScript -> dist
RUN npm run build


# -------------------------
# 2. Production stage
# -------------------------
FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# install only production deps
COPY package*.json ./
RUN npm ci --omit=dev

# copy compiled output
COPY --from=builder /app/dist ./dist

# create runtime folders (important for your logger/projects system)
RUN mkdir -p /app/projects

# expose port
EXPOSE 4000

# start server
CMD ["node", "dist/server.js"]