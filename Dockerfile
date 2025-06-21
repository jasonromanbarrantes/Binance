FROM node:18-alpine
WORKDIR /app
COPY package.json index.js ./
RUN npm install --production
EXPOSE 3000
CMD ["node", "index.js"]
