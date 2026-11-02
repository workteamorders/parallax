# One image for both backend processes. Default command runs the API; run the worker as a second
# service from the same image with:  pnpm --filter @parallax/api worker
# The web app is deployed separately (Vercel) and is not part of this image.
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    CI=true
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# Install only the API and shared workspaces. tsx lives in the root devDependencies and runs the TypeScript
# sources directly (the shared package exports .ts), so devDependencies are kept on purpose.
RUN pnpm install --frozen-lockfile --filter @parallax/api...
COPY packages/shared packages/shared
COPY apps/api apps/api
USER node
EXPOSE 4100
CMD ["pnpm", "--filter", "@parallax/api", "start"]
