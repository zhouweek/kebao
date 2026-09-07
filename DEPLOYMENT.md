# 课宝生产部署手册

## 1. 架构

`docker-compose.prod.yml` 启动三个服务：

- `web`：Nginx，提供管理后台静态文件、HTTPS 终止、HTTP 跳转、反向代理和边缘限流。
- `api`：Fastify API；启动前自动执行 `prisma migrate deploy`，成功后才监听端口。
- `postgres`：PostgreSQL 16，仅加入内部网络，不向宿主机暴露端口。

API 容器以非 root 用户、只读根文件系统运行。Nginx 和 API 均启用
`no-new-privileges`。生产 Compose 不包含任何真实密钥。

## 2. 部署前准备

要求 Docker Engine 24+，并启用 Compose v2。准备证书目录：

```text
/srv/kebao/tls/
├── fullchain.pem
└── privkey.pem
```

证书私钥权限应限制为部署账号可读。复制示例环境文件，不要提交生成的环境文件：

```bash
cp deploy/.env.production.example .env.production
chmod 600 .env.production
```

至少替换：

- `POSTGRES_PASSWORD`：数据库强密码。
- `DATABASE_URL`：与数据库账号密码一致；密码中的特殊字符必须 URL 编码。
- `AUTH_TOKEN_SECRET`：至少 32 位随机值。
- `PLATFORM_AUTH_TOKEN_SECRET`：平台管理员令牌使用的独立随机值，至少 32 位且不得与
  `AUTH_TOKEN_SECRET` 相同。
- `PLATFORM_ADMIN_USERNAME` / `PLATFORM_ADMIN_PASSWORD` /
  `PLATFORM_ADMIN_PASSWORD_VERSION`：可选的平台管理员初始化与安全找回配置。版本必须是
  正整数，首次设为 `1`。账号不存在时创建并要求首次登录改密；账号已存在时，只有环境
  版本大于数据库版本才会原子更新密码、要求改密并撤销全部平台会话。同版本重启不会覆盖
  密码。不需要初始化或找回账号时将密码留空。
- `METRICS_TOKEN`：至少 16 位随机值，监控采集时作为 Bearer Token。
- `CORS_ORIGINS`：逗号分隔的管理后台 HTTPS 来源。
- `TLS_CERT_DIR`：宿主机证书目录的绝对路径。
- 微信 AppSecret 和模板 ID（启用微信能力时）。

可用 `openssl rand -base64 48` 生成随机密钥。密钥应由部署平台的 Secret
能力注入；日志、镜像、代码仓库和工单中均不得保存明文。

## 3. 配置和镜像校验

先渲染 Compose，确认没有变量缺失：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml config --quiet
```

构建镜像：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build
```

API 在 `NODE_ENV=production` 时会拒绝以下配置：

- 缺少 `DATABASE_URL`。
- 弱口令或示例值 `AUTH_TOKEN_SECRET`。
- 缺少、弱口令、示例值或与普通令牌密钥相同的 `PLATFORM_AUTH_TOKEN_SECRET`。
- `DEV_IDENTITY_ENABLED=true`。
- 空 CORS 列表或非 HTTPS CORS 来源。
- 未设置 `TRUST_PROXY=true`。
- 弱口令或示例值 `METRICS_TOKEN`。
- 非法 `NODE_ENV` 和非正整数限流参数。

## 4. 首次启动和迁移

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs api
```

API entrypoint 每次启动先执行幂等的 `prisma migrate deploy`。迁移失败时 API
不会启动，`web` 也会因 API 健康检查未通过而保持等待。应用启动前还会连接数据库并执行
`SELECT 1`，避免进程在数据库不可用时误报成功。

忘记平台超级管理员密码时，先将 `PLATFORM_ADMIN_PASSWORD` 改为新的临时强密码，再将
`PLATFORM_ADMIN_PASSWORD_VERSION` 递增并重新部署。启动完成后，所有旧平台会话均已
失效；使用临时密码登录并立即完成强制改密。不要只修改密码而复用旧版本号。

发布前应先备份。涉及破坏性 schema 变更时采用“扩展 → 发布兼容代码 → 收缩”的两阶段
迁移，不要依赖自动回滚数据库结构。

## 5. 健康检查和监控

- `GET /health`：进程存活检查，不访问数据库。
- `GET /ready`：就绪检查，验证 PostgreSQL 连接；失败返回 503。
- `GET /metrics`：Prometheus 文本指标；生产环境要求
  `Authorization: Bearer <METRICS_TOKEN>`。

示例：

```bash
curl -fsS https://admin.example.com/health
curl -fsS https://admin.example.com/ready
curl -fsS -H "Authorization: Bearer ${METRICS_TOKEN}" \
  https://admin.example.com/metrics
```

每个响应包含 `X-Request-Id`。API 使用 JSON 结构化日志，错误日志包含同一请求 ID；
Nginx 会把 `$request_id` 传给上游。建议告警至少覆盖：

- `/ready` 连续失败。
- 5xx 比例、429 比例和请求延迟持续升高。
- API 或数据库容器频繁重启。
- 磁盘使用量与最近一次成功备份时间。

## 6. PostgreSQL 备份

脚本使用 PostgreSQL custom format，默认写入 `./backups`，权限受 `umask 077`
保护，默认保留 14 天：

```bash
chmod +x scripts/backup-postgres.sh scripts/restore-postgres.sh
COMPOSE_FILE=docker-compose.prod.yml \
BACKUP_DIR=/srv/kebao/backups \
RETENTION_DAYS=14 \
./scripts/backup-postgres.sh
```

应将备份复制到异机或对象存储，并配置加密、保留策略和恢复演练。仅有同机备份不能抵御
磁盘故障。建议每天执行，部署迁移前额外执行一次。

## 7. PostgreSQL 恢复

恢复会使用 `--clean --if-exists` 覆盖现有对象。先停止外部流量和 API 写入，确认备份文件：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop web api
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres
CONFIRM_RESTORE=kebao \
COMPOSE_FILE=docker-compose.prod.yml \
./scripts/restore-postgres.sh /srv/kebao/backups/kebao-YYYYMMDDTHHMMSSZ.dump
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api web
```

脚本在恢复后执行 `prisma migrate deploy`，确保数据库达到当前镜像所需版本。随后检查
`/ready`、登录、课次查询和关键数据量。恢复演练必须在隔离环境定期执行。

## 8. 更新与回退

更新：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

代码回退应部署上一版镜像。数据库迁移默认只向前执行；若迁移不兼容，使用发布前备份恢复，
不要手工删除迁移记录。完成后再次检查 `/ready` 和日志中的迁移结果。
