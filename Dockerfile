FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production DATABASE_PATH=/data/follow.db PORT=3000
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY public ./public
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.js"]
