# Mac Docker 安装说明

## 当前电脑检测结果

检测时间：2026-09-02

| 项目                | 结果                                 |
| ----------------- | ---------------------------------- |
| 芯片架构              | Apple Silicon，`arm64`              |
| macOS 版本          | `15.7.3`                           |
| Homebrew          | 已安装，路径为 `/opt/homebrew/bin/brew`   |
| Docker 命令         | 未安装，`command -v docker` 无输出        |
| Docker Desktop 应用 | 未安装，`/Applications/Docker.app` 不存在 |
| Homebrew Cask     | `docker-desktop` 未安装               |

本机满足 Docker Desktop 的系统版本要求。Docker 官方文档说明，Docker Desktop for Mac 支持当前及前两个主要 macOS 版本，Apple Silicon 版本需要下载对应的 ARM64 安装包。

## 本次自动安装结果

已尝试通过 Homebrew 安装 Docker Desktop：

```bash
HOMEBREW_NO_AUTO_UPDATE=1 brew install --cask docker-desktop
```

Homebrew 能识别 `docker-desktop`，并确认将安装 Docker Desktop `4.88.1,237512`。安装失败发生在下载官方 DMG 文件阶段：

```text
Download failed: https://desktop.docker.com/mac/main/arm64/237512/Docker.dmg
curl: (35) Recv failure: Connection reset by peer
```

结论：当前失败原因是网络连接到 Docker 官方下载地址时被重置，不是项目代码问题，也不是当前 Mac 系统版本不兼容。

## Docker 在本项目中的作用

本项目已经补充了 `docker-compose.yml`，用于本地启动 PostgreSQL：

```bash
pnpm db:up
```

Docker 在本项目里的主要作用是提供稳定的基础服务环境：

- 启动 PostgreSQL 16，不需要手动在 Mac 系统里安装数据库。

- 使用固定数据库名称、账号、密码和端口。

- 保存本地开发数据到 Docker volume。

- 验证 Prisma 迁移文件。

- 验证 PostgreSQL 的老师/教室时间排斥约束。

- 验证预约事务、行级锁和并发抢名额。

不安装 Docker 时，仍然可以继续开发前端、后端普通逻辑和运行内存仓储模式；安装 Docker 后，才能在本机完整验证数据库相关能力。

## 推荐安装方式

### 方式一：使用 Homebrew

网络恢复后，在项目根目录或任意目录执行：

```bash
brew install --cask docker-desktop
```

安装完成后启动 Docker Desktop：

```bash
open -a Docker
```

首次打开时，需要在图形界面接受 Docker Desktop 订阅协议，并按提示完成初始化配置。

### 方式二：手动下载安装包

如果 Homebrew 下载持续失败，使用浏览器打开 Docker 官方 Mac 安装页面：

```text
https://docs.docker.com/desktop/setup/install/mac-install/
```

选择 Apple Silicon 版本下载。下载完成后：

1. 双击 `Docker.dmg`。
2. 将 Docker 图标拖入 `Applications`。
3. 打开 `/Applications/Docker.app`。
4. 接受 Docker Desktop 订阅协议。
5. 选择推荐设置，按提示输入 Mac 登录密码。
6. 等待菜单栏 Docker 图标显示为运行状态。

### 方式三：命令行安装 DMG

如果已经手动下载好 `Docker.dmg`，可在下载目录执行：

```bash
sudo hdiutil attach Docker.dmg
sudo /Volumes/Docker/Docker.app/Contents/MacOS/install
sudo hdiutil detach /Volumes/Docker
```

该方式会把 Docker Desktop 安装到 `/Applications/Docker.app`。命令行安装需要管理员密码。

## 安装后的验证

Docker Desktop 启动完成后，打开一个新的终端执行：

```bash
docker version
docker compose version
```

能看到 Client 和 Server 信息，说明 Docker Desktop 已正常运行。如果只看到 Client、看不到 Server，说明 Docker Desktop 应用没有启动完成。

## 本项目数据库启动步骤

安装 Docker Desktop 并启动后，回到项目根目录执行：

```bash
pnpm db:up
```

复制环境变量文件：

```bash
cp .env.example .env
```

本地联调数据库时，`.env` 建议使用：

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kebao?schema=public"
DEV_IDENTITY_ENABLED=true
PORT=3000
HOST=0.0.0.0
```

执行数据库迁移和种子数据：

```bash
pnpm db:migrate
pnpm db:seed
```

启动 API：

```bash
pnpm dev:api
```

验证 API：

```bash
curl http://localhost:3000/health
```

预期返回：

```json
{"status":"ok"}
```

## 常用命令

| 命令                  | 作用                |
| ------------------- | ----------------- |
| `pnpm db:up`        | 启动 PostgreSQL 容器  |
| `pnpm db:down`      | 停止并移除容器           |
| `pnpm db:logs`      | 查看 PostgreSQL 日志  |
| `pnpm db:migrate`   | 执行 Prisma 数据库迁移   |
| `pnpm db:seed`      | 写入开发种子数据          |
| `pnpm db:validate`  | 校验 Prisma Schema  |
| `docker ps`         | 查看正在运行的容器         |
| `docker compose ps` | 查看当前 Compose 服务状态 |

## 常见问题

### docker 命令存在，但连接不上服务

现象：

```text
Cannot connect to the Docker daemon
```

处理方式：打开 Docker Desktop，等待状态变为运行中，然后重新执行命令。

### 5432 端口被占用

现象：PostgreSQL 容器启动失败，日志提示端口占用。

处理方式：检查本机是否已有 PostgreSQL 占用端口：

```bash
lsof -i :5432
```

如果需要改端口，修改 `docker-compose.yml`：

```yaml
ports:
  - "15432:5432"
```

同时把 `.env` 中的连接串改成：

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:15432/kebao?schema=public"
```

### Homebrew 下载 Docker Desktop 失败

本次自动安装失败就是这个问题。处理方式：

- 换一个更稳定的网络后重试 `brew install --cask docker-desktop`。

- 使用浏览器从 Docker 官方页面下载 Apple Silicon 版本。

- 如果公司网络拦截 Docker 官方 CDN，切换到可访问 `desktop.docker.com` 的网络。

### Docker Desktop 订阅协议

Docker Desktop 对个人使用、教育、非商业开源、小型企业免费；大型企业商业使用需要付费订阅。安装或首次启动时需要接受协议。是否符合免费使用条件，需要按所在组织情况确认。

## 参考链接

- Docker Desktop for Mac 官方安装文档：`https://docs.docker.com/desktop/setup/install/mac-install/`

- Docker Desktop 订阅说明：`https://www.docker.com/pricing/`

