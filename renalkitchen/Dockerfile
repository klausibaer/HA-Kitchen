FROM node:18-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY server.js ./
COPY www/ ./www/
CMD ["node", "server.js"]
