ARG PYTHON_IMAGE=python:3.12-slim-bookworm
FROM ${PYTHON_IMAGE}
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir uv==0.12.19 && useradd --uid 10001 --create-home gateway
COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --frozen --no-dev --no-editable && mkdir /app/var /data \
    && chown gateway:gateway /app/var /data
USER gateway
EXPOSE 8298
CMD ["/app/.venv/bin/uvicorn", "everplain_gateway.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8298", "--no-access-log"]
