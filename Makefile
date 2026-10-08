UV_CACHE_DIR ?= .cache/uv

.PHONY: bootstrap bootstrap-backend bootstrap-frontend contract check check-backend check-contract check-frontend dev-api dev-web

bootstrap: bootstrap-backend bootstrap-frontend bootstrap-clipper

bootstrap-backend:
	cd backend && uv --cache-dir $(UV_CACHE_DIR) sync --locked

bootstrap-frontend:
	cd frontend && npm ci --ignore-scripts

contract:
	cd backend && uv --cache-dir $(UV_CACHE_DIR) run --locked python scripts/export_openapi.py
	cd frontend && npm run generate:api

check: check-contract check-backend check-frontend

check-backend:
	cd backend && uv --cache-dir $(UV_CACHE_DIR) run --locked ruff check .
	cd backend && uv --cache-dir $(UV_CACHE_DIR) run --locked pytest $$(sed '/^[[:space:]]*#/d; /^[[:space:]]*$$/d' tests/product-suite.txt)

check-contract: contract
	git diff --exit-code -- backend/openapi.json frontend/src/api/generated

check-frontend:
	cd frontend && npm run check:boundaries
	cd frontend && npm run check:styles
	cd frontend && npm run lint
	cd frontend && npm run test
	cd frontend && npm run build
	cd extensions/clipper && npm test
	python3 extensions/clipper/test/setup.test.py

dev-api:
	cd backend && uv --cache-dir $(UV_CACHE_DIR) run --locked alembic upgrade head
	cd backend && uv --cache-dir $(UV_CACHE_DIR) run --locked uvicorn qunxue_api.main:app --host 127.0.0.1 --port 8297 --reload

dev-web:
	cd frontend && npm run dev

.PHONY: bootstrap-clipper build-clipper
bootstrap-clipper:
	cd extensions/clipper && npm ci --ignore-scripts
build-clipper:
	cd extensions/clipper && npm run build
