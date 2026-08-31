FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
# Run as the image's built-in non-root user instead of root.
USER node
EXPOSE 4000
CMD ["node", "index.js"]
