# Deploy notes (foundation)

Local services run via root `docker-compose.yml`. Do not start containers as
part of contract tests. Postgres listens on host port 5448 to avoid clashing
with a default 5432 install. Redis maps to 6381.

Production uses separate credentials, database, and buckets. Demo credentials
in `.env.example` are development-only placeholders.
