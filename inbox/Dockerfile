# Jedi Pack inbox: zero runtime dependencies, so no npm step. .dockerignore keeps .env, logs and data/ out.
FROM node:22-slim
WORKDIR /app
COPY . .
RUN mkdir -p logs data/memory data/runtime
# JEDI_IN_CONTAINER makes the server bind 0.0.0.0 even when an --env-file carries HOST=127.0.0.1 (the .env.example default), so -p reaches it.
ENV HOST=0.0.0.0 PORT=8000 JEDI_IN_CONTAINER=1
EXPOSE 8000
CMD ["node","src/server.mjs"]
