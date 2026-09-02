# 课宝排课与预约系统

课宝是面向教培机构的排课与课程预约系统，包含 Fastify API、React 管理后台和 Taro 微信小程序。API 未设置 `DATABASE_URL` 时使用内存仓储；设置 `DATABASE_URL` 后使用 Prisma/PostgreSQL。

## 环境要求

- Node.js 20+
- pnpm 10+
- Docker Desktop 或 OrbStack，用于本地启动 PostgreSQL

## 快速启动

```bash
pnpm install
pnpm dev:api
pnpm dev:admin
pnpm dev:miniapp
```

API 默认监听 `http://localhost:3000`。小程序构建产物位于 `apps/miniapp/dist`，使用微信开发者工具导入 `apps/miniapp`。

## 使用 PostgreSQL

当前项目根目录已有 `docker-compose.yml`，用于启动 PostgreSQL 16。

```bash
pnpm db:up
```

本机网络访问 Docker Hub 时出现过 EOF，项目默认使用公共 ECR 上的 PostgreSQL 官方镜像副本：

```bash
POSTGRES_IMAGE="public.ecr.aws/docker/library/postgres:16-alpine"
```

如果你的网络能稳定访问 Docker Hub，也可以把 `.env` 中的 `POSTGRES_IMAGE` 改成：

```bash
POSTGRES_IMAGE="postgres:16-alpine"
```

本地联调数据库时，`.env` 使用：

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kebao?schema=public"
POSTGRES_IMAGE="public.ecr.aws/docker/library/postgres:16-alpine"
DEV_IDENTITY_ENABLED=true
PORT=3000
HOST=0.0.0.0
```

执行迁移和开发种子：

```bash
pnpm db:migrate
pnpm db:seed
```

启动 API：

```bash
pnpm dev:api
```

停止数据库：

```bash
pnpm db:down
```

## 校验

```bash
pnpm typecheck
pnpm test
pnpm build
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kebao" pnpm db:validate
```

## API

| 方法     | 路径                                    | 说明                                                  |
| ------ | ------------------------------------- | --------------------------------------------------- |
| GET    | `/health`                             | 健康检查                                                |
| GET    | `/sessions`                           | 课次列表；支持 `from`、`to`、`teacherId`、`campusId`、`status` |
| POST   | `/sessions`                           | 创建课次并校验老师、教室时间冲突                                    |
| POST   | `/sessions/:sessionId/bookings`       | 为学生预约；重复提交幂等                                        |
| DELETE | `/bookings/:bookingId`                | 取消预约                                                |
| PATCH  | `/sessions/:sessionId/reschedule`     | 调课并通知有效预约家长                                         |
| POST   | `/sessions/:sessionId/cancel`         | 停课并批量取消有效预约                                         |
| PUT    | `/sessions/:sessionId/attendance`     | 签到，支持已到、请假、缺席                                      |
| GET    | `/teacher/sessions/:sessionId/roster` | 老师查看课次学员名单                                          |
| GET    | `/notifications`                      | 站内通知列表                                              |
| PATCH  | `/notifications/:notificationId/read` | 标记通知已读                                              |
| GET    | `/audit-logs`                         | 管理员查看操作日志                                           |

创建课次示例：

```bash
curl -X POST http://localhost:3000/sessions \
  -H 'content-type: application/json' \
  -d '{
    "courseId":"course-art",
    "courseName":"创意美术",
    "campusId":"campus-a",
    "campusName":"A 校区",
    "classroomId":"room-201",
    "classroomName":"201 教室",
    "teacherId":"teacher-2",
    "teacherName":"李老师",
    "startsAt":"2026-09-03T02:00:00.000Z",
    "endsAt":"2026-09-03T03:00:00.000Z",
    "capacity":12
  }'
```

预约与取消示例：

```bash
curl -X POST http://localhost:3000/sessions/session-1/bookings \
  -H 'content-type: application/json' \
  -d '{"studentId":"student-2"}'

curl -X DELETE http://localhost:3000/bookings/booking-1
curl http://localhost:3000/teacher/sessions/session-1/roster
```

## 已实现规则

- 结束时间晚于开始时间，单课次最长 8 小时。

- 已发布、停招课次占用老师与教室；草稿不占用。

- 区间按“新开始 `<` 已有结束且新结束 `>` 已有开始”判断冲突。

- 预约窗口、取消截止时间默认分别为开课前 7 天、2 小时和 4 小时。

- 同一学生同课次重复预约幂等，时间重叠则拒绝。

- 内存仓储按课次加锁，保证并发抢最后一个名额时只有一个请求成功。

- 取消后立即释放容量；老师名单只包含有效预约。

错误统一返回：

```json
{
  "error": {
    "code": "SESSION_CONFLICT",
    "message": "老师或教室在该时段已被占用",
    "details": {}
  }
}
```
