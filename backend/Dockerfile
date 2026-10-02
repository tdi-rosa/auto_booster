FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
COPY package.json ./
RUN apt-get update && apt-get install -y --no-install-recommends xvfb xauth && npm install --omit=dev && rm -rf /var/lib/apt/lists/*
COPY . .
CMD ["npm", "start"]
