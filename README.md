# Tee Trade

Стартовый каркас магазина футболок: Angular 21, Rust (Axum), PostgreSQL 17,
Redis 7, Prometheus и Grafana. Каждый сервис запускается в отдельном контейнере.

## Запуск

Нужен Docker с Compose v2.

```sh
cp .env.example .env
docker compose up --build -d
```

- Магазин: http://localhost:4200
- API: http://localhost:8080/api/products
- Проверки: `/health` (процесс), `/ready` (PostgreSQL)
- Метрики API: http://localhost:8080/metrics
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 — пользователь `admin`, пароль из `.env`.

В Grafana автоматически создаются источник Prometheus и дашборд Tee Trade API.
Счётчик `http_requests_total` содержит метки route и status.
Миграции выполняются при старте backend и добавляют три демонстрационных товара.
Цены хранятся целым числом в копейках. Каталог кешируется в Redis на 60 секунд;
при недоступности кеша API читает PostgreSQL.

## Разработка

```sh
# Инфраструктура
docker compose up -d postgres redis prometheus grafana
# Backend (Rust 1.91+), из backend/
DATABASE_URL=postgres://user:password@localhost:5432/tee_trade REDIS_URL=redis://localhost:6379 RUST_LOG=info cargo run
# Frontend (Node.js 22.12+), из front/
npm ci
npm start
```

PostgreSQL и Redis по умолчанию доступны только в сети Compose. Для локального
backend добавьте проброс `127.0.0.1:5432:5432` и `127.0.0.1:6379:6379` в локальный
`compose.override.yaml` (он не должен содержать секретов). Подставьте параметры из `.env`.
Фронтенд перенаправляет `/api` на localhost:8080 через dev proxy.

```sh
# Проверки
cd backend
cargo fmt --check
cargo check --locked
# Из front/
npm run build
# Из корня
docker compose config -q
docker compose logs -f
docker compose down
```

Данные PostgreSQL, Prometheus и Grafana сохраняются в именованных томах.
`docker compose down -v` удаляет эти данные.
`.env` не коммитится. Пароли из примера предназначены для локального запуска.
Это стартовый каталог; корзина, заказы, платежи и авторизация пока не реализованы.
