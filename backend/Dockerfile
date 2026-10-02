FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright
COPY package.json ./
RUN npm install --omit=dev
COPY . .
CMD ["npm", "start"]
