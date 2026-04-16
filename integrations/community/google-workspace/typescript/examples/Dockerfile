FROM node:18-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY dist/ ./dist/
CMD ["node", "dist/index.js"]
EXPOSE 8080
