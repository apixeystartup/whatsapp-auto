FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

RUN mkdir -p session media logs

CMD ["node", "index.js"]
