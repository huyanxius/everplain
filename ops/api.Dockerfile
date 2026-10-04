ARG PYTHON_IMAGE=python:3.12-slim-bookworm
FROM ${PYTHON_IMAGE}

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PATH=/app/backend/.venv/bin:$PATH TIKTOKEN_CACHE_DIR=/opt/tiktoken-cache
WORKDIR /app/backend
RUN pip install --no-cache-dir uv==0.11.29
COPY backend/pyproject.toml backend/uv.lock backend/README.md ./
RUN uv sync --frozen --no-dev --no-install-project \
    && python -c "import tiktoken; tiktoken.get_encoding('o200k_base')" \
    && chmod -R a+rX /opt/tiktoken-cache
COPY backend/src ./src
RUN uv sync --frozen --no-dev --no-editable
COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
COPY ops /app/ops
RUN groupadd --gid 10001 everplain \
    && useradd --uid 10001 --gid everplain --no-create-home everplain \
    && mkdir -p /data /backups \
    && chown -R everplain:everplain /data /backups
USER 10001:10001
EXPOSE 8297
ENTRYPOINT ["sh", "/app/ops/start-api.sh"]
