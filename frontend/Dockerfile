# This image runs the Vite *development* server, and is only meant for
# local development via docker-compose (see docker-compose.yml). It is
# NOT used in production -- production frontend hosting is Vercel
# (see frontend/vercel.json), which builds and serves the static
# `vite build` output directly, not this container.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
USER node
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]
