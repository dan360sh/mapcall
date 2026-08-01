FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY . .

# Copy built frontend (run `npm run build` in root before docker-compose up)
COPY ../www ./www 2>/dev/null || true

EXPOSE 3000
CMD ["node", "index.js"]
