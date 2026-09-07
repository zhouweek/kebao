# Render 部署说明

本方案使用一个 Render Web Service 同时提供管理后台和 API，并使用一个 Render
PostgreSQL 数据库。管理后台与 API 使用同一 HTTPS 域名，不需要单独配置前端 API
地址或跨域代理。

## 部署结构

- `kebao-admin`：Docker Web Service，提供 React 管理后台、Fastify API 和通知 worker。
- `kebao-postgres`：Render PostgreSQL 16，通过内部连接串与 Web Service 通信。
- `render.yaml`：Render Blueprint，定义服务、数据库、环境变量和健康检查。

## GitHub 授权

当前 Render 页面只显示 `zhouwccc/FitnessApp`，本项目仓库是
`zhouweek/kebao`。请先在 Render 的 GitHub Credentials 中管理 GitHub App
权限，授权访问 `zhouweek/kebao`。

授权后回到 Render：

1. 退出当前 `New Web Service` 页面。
2. 点击 `New`。
3. 选择 `Blueprint`。
4. 选择 `zhouweek/kebao` 仓库。
5. Render 会读取仓库根目录的 `render.yaml`。

## 首次创建

Blueprint 创建时需要填写以下 Secret：

- `SEED_ADMIN_PASSWORD`：初始管理员密码，至少 8 位，不要继续使用演示密码。
- `PLATFORM_ADMIN_PASSWORD`：首个平台超级管理员的临时密码，至少 8 位。
- `PLATFORM_ADMIN_PASSWORD_VERSION`：平台密码版本，首次保持 `1`。
- `WECHAT_APP_SECRET`：微信小程序 AppSecret。

以下值由 Render 自动生成或注入，无需手动填写：

- `DATABASE_URL`
- `AUTH_TOKEN_SECRET`
- `PLATFORM_AUTH_TOKEN_SECRET`
- `METRICS_TOKEN`

首次部署会按顺序执行：

1. 构建 API 和管理后台。
2. 执行 `prisma migrate deploy`。
3. 启动 Web Service。
4. 执行一次 `prisma db seed`，创建 `DEMO` 机构、初始机构管理员和平台超级管理员。

启动脚本在账号不存在时写入临时密码。后续同版本重新部署不会覆盖管理员已修改的密码。

## 部署后检查

默认服务名为 `kebao-admin`，预期访问地址为：

```text
https://kebao-admin.onrender.com
```

依次检查：

```text
https://kebao-admin.onrender.com/health
https://kebao-admin.onrender.com/ready
https://kebao-admin.onrender.com/
https://kebao-admin.onrender.com/platform
```

`/health` 应返回 `status: ok`，`/ready` 应返回 `status: ready`，根路径应显示
机构后台登录页，`/platform` 应显示超级管理员登录页。

初始登录信息：

- 机构编码：`DEMO`
- 手机号：`13800000001`
- 密码：创建 Blueprint 时填写的 `SEED_ADMIN_PASSWORD`

平台超级管理员登录信息：

- 地址：`https://kebao-admin.onrender.com/platform`
- 账号：`superadmin`
- 密码：创建 Blueprint 时填写的 `PLATFORM_ADMIN_PASSWORD`

平台超级管理员首次登录后必须修改临时密码。后续可在平台页面创建机构、创建机构管理员、
停用机构、重置机构管理员密码和撤销管理员登录会话。

如果忘记平台超级管理员密码，在 Render 服务的 Environment 页面同时设置新的
`PLATFORM_ADMIN_PASSWORD`，并将 `PLATFORM_ADMIN_PASSWORD_VERSION` 递增后重新部署。
只有更大的版本号会触发密码找回；更新会原子写入临时密码、重新启用强制改密，并撤销该
账号全部平台会话。同版本重启不会覆盖密码。

如果 Render 因名称冲突生成了不同的服务域名，请在服务的 Environment 页面把
`CORS_ORIGINS` 改成实际 HTTPS 地址，然后重新部署。

## 微信小程序

部署成功后，在本地 `.env` 中修改：

```dotenv
TARO_APP_API_BASE_URL="https://kebao-admin.onrender.com"
TARO_APP_DEV_IDENTITY_ENABLED=false
```

如果 Render 实际分配了其他域名，请使用实际域名。然后重新构建小程序：

```bash
pnpm --filter @kebao/miniapp build
```

在微信公众平台的小程序后台，将以下域名加入服务器域名中的 `request` 合法域名：

```text
https://kebao-admin.onrender.com
```

合法域名不能带路径。配置完成后重新上传小程序版本。使用公网 HTTPS API 后，手机
不再需要与电脑连接同一局域网。

## 订阅消息

预约、调课和提醒模板审核通过后，在 Render 服务的 Environment 页面填写：

- `WECHAT_TEMPLATE_BOOKING_CONFIRMED`
- `WECHAT_TEMPLATE_BOOKING_CANCELLED`
- `WECHAT_TEMPLATE_SESSION_RESCHEDULED`
- `WECHAT_TEMPLATE_SESSION_CANCELLED`
- `WECHAT_TEMPLATE_SESSION_REMINDER_24H`
- `WECHAT_TEMPLATE_SESSION_REMINDER_2H`

测试版小程序保持：

```dotenv
WECHAT_MINIPROGRAM_STATE=trial
```

正式发布后改为：

```dotenv
WECHAT_MINIPROGRAM_STATE=formal
```

## 现有数据迁移

Blueprint 首次部署只创建种子数据，不包含当前 Mac 本地 PostgreSQL 中新增的家长、
教师、学生、课程和课次。需要保留现有数据时，应从本地数据库导出，再使用 Render
数据库的 External Database URL 导入。

数据库导入完成后不要再次运行种子命令。部署更新只会执行 Prisma 迁移，不会重复执行
首次种子初始化。

## 自定义域名

需要使用自定义域名时：

1. 在 Render 服务 Settings 中添加域名。
2. 按 Render 提示配置 DNS。
3. 将 `CORS_ORIGINS` 修改为自定义 HTTPS 域名。
4. 将小程序的 `TARO_APP_API_BASE_URL` 修改为自定义 HTTPS 域名。
5. 在微信公众平台同步修改 `request` 合法域名。

Render 会为服务域名和自定义域名自动配置 HTTPS 证书。
