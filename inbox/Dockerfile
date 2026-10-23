# Jedi Pack inbox: zero runtime dependencies, so no npm step. .dockerignore keeps .env, logs and data/ out.
FROM node:22-slim
WORKDIR /app
COPY . .
RUN mkdir -p logs data/memory data/runtime
ENV HOST=0.0.0.0 PORT=8000
EXPOSE 8000
CMD ["node","src/server.mjs"]
