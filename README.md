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

生产环境的 HTTPS、容器、迁移、健康检查、监控及 PostgreSQL 备份恢复流程见
[DEPLOYMENT.md](./DEPLOYMENT.md)。

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
AUTH_TOKEN_SECRET="请替换为至少 32 位随机字符串"
WECHAT_APP_ID="微信小程序 AppID"
WECHAT_APP_SECRET="微信小程序 AppSecret"
WECHAT_TEMPLATE_BOOKING_CONFIRMED="预约成功模板 ID"
WECHAT_TEMPLATE_BOOKING_CANCELLED="预约取消模板 ID"
WECHAT_TEMPLATE_SESSION_RESCHEDULED="调课模板 ID"
WECHAT_TEMPLATE_SESSION_CANCELLED="停课模板 ID"
WECHAT_TEMPLATE_SESSION_REMINDER_24H="开课前 24 小时提醒模板 ID"
WECHAT_TEMPLATE_SESSION_REMINDER_2H="开课前 2 小时提醒模板 ID"
WECHAT_MINIPROGRAM_STATE="formal"
WECHAT_SUBSCRIBE_LANGUAGE="zh_CN"
NOTIFICATION_WORKER_INTERVAL_MS=60000
DEV_IDENTITY_ENABLED=false
VITE_DEV_IDENTITY_ENABLED=false
TARO_APP_DEV_IDENTITY_ENABLED=false
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
| GET    | `/health`                             | 存活检查，不访问数据库                                  |
| GET    | `/ready`                              | 就绪检查，生产环境验证 PostgreSQL                        |
| GET    | `/metrics`                            | Prometheus 指标，生产环境使用 Bearer Token 保护          |
| POST   | `/auth/admin/login`                   | 管理员按机构编码、手机号、密码登录                                  |
| POST   | `/auth/wechat/login`                  | 服务端用微信登录 code 与手机号授权 phoneCode 解析身份并登录              |
| POST   | `/auth/refresh`                       | 轮换刷新令牌并签发新的访问令牌                                  |
| POST   | `/auth/logout`                        | 撤销当前会话                                              |
| GET    | `/auth/me`                            | 获取当前用户；同时校验用户是否已停用                              |
| GET    | `/sessions`                           | 课次列表；支持 `from`、`to`、`teacherId`、`campusId`、`status` |
| POST   | `/sessions`                           | 创建课次并校验老师、教室时间冲突                                    |
| POST   | `/session-series/preflight`            | 预检按周排课系列，返回可创建日期和冲突日期                           |
| POST   | `/session-series`                      | 按周及指定次数创建系列；默认原子失败，可选择跳过冲突                   |
| GET    | `/teacher/options`                    | 老师读取本人及当前机构已启用的课程、校区、教室选项                  |
| POST   | `/sessions/:sessionId/bookings`       | 为学生预约；重复提交幂等                                        |
| DELETE | `/bookings/:bookingId`                | 取消预约                                                |
| PATCH  | `/sessions/:sessionId/reschedule`     | 调课并通知有效预约家长；系列支持仅本次/本次及以后                    |
| POST   | `/sessions/:sessionId/cancel`         | 停课并批量取消有效预约；系列支持仅本次/本次及以后                    |
| PUT    | `/sessions/:sessionId/attendance`     | 签到，支持已到、请假、缺席                                      |
| GET    | `/teacher/sessions/:sessionId/roster` | 老师查看课次学员名单                                          |
| GET    | `/notifications`                      | 站内通知列表                                              |
| PATCH  | `/notifications/:notificationId/read` | 标记通知已读                                              |
| GET    | `/notifications/subscription-config`  | 获取小程序可申请授权的微信订阅消息模板 ID                   |
| GET    | `/admin/notification-deliveries`      | 管理员查看微信通知投递状态与失败原因                         |
| POST   | `/admin/notification-deliveries/:id/resend` | 管理员将失败或跳过的通知重新加入发送队列                |
| GET    | `/audit-logs`                         | 管理员查看操作日志                                           |
| GET    | `/admin/bookings`                     | 管理员分页查询预约，支持课次、学生、状态和上课时间筛选，并返回课程、学生、老师信息 |
| POST   | `/admin/bookings`                     | 管理员为指定课次和学生代预约                                  |
| POST   | `/admin/bookings/:bookingId/cancel`   | 管理员填写原因后代取消预约                                    |
| GET    | `/admin/statistics`                   | 管理员查询经营指标与课次明细，支持时间、校区、课程、老师筛选      |
| GET    | `/admin/statistics/export`            | 按相同筛选条件导出 UTF-8 CSV 明细并写入审计日志                   |
| GET    | `/admin/:resource`                    | 管理员分页查询基础资料，支持关键词、状态和校区筛选                    |
| POST   | `/admin/:resource`                    | 管理员新增基础资料                                           |
| PATCH  | `/admin/:resource/:id`                | 管理员编辑基础资料                                           |
| DELETE | `/admin/:resource/:id`                | 管理员删除未被业务数据引用的基础资料                              |
| PATCH  | `/admin/:resource/:id/status`         | 管理员启用或停用基础资料                                      |
| PUT    | `/admin/students/:id/guardians`       | 管理员维护学生与家长的绑定关系                                  |

除健康检查和三个登录/刷新接口外，业务接口均要求：

```http
Authorization: Bearer <accessToken>
```

访问令牌默认有效期 15 分钟，刷新令牌默认有效期 30 天。刷新令牌每次使用后都会轮换，旧令牌不可复用；登出会立即撤销对应会话。开发身份头仅在 API 的
`DEV_IDENTITY_ENABLED=true` 且对应客户端的 `VITE_DEV_IDENTITY_ENABLED=true` 或
`TARO_APP_DEV_IDENTITY_ENABLED=true` 时使用，默认关闭。

基础资料接口的 `resource` 可取 `campuses`、`classrooms`、`courses`、`teachers`、
`guardians`、`students`。列表参数包括 `page`、`pageSize`（最大 100）、
`keyword`、`activeOnly`，教室和学生还可按 `campusId` 筛选。所有查询和写入都从
访问令牌中的 `organizationId` 确定租户，不接受客户端提交租户 ID；写操作仅限管理员。
已被课次等业务数据引用的资料不能直接删除，应改为停用。

管理后台的校区、教室、课程、老师、家长和学生页面提供新增、编辑、删除、启停、分页与
筛选功能；学生页面可维护家长绑定。创建课次及调课表单中的课程、校区、老师和教室选项
来自当前机构的已启用基础资料，教室会按所选校区过滤。

管理后台的预约管理页面支持按课次、学生、预约状态和上课时间范围筛选并分页浏览预约单。
管理员代预约不受家长预约开放时间窗限制，但仍复用课次容量、同课次重复预约幂等和学生
时间冲突校验；管理员代取消可越过家长自助取消截止时间，但必须填写原因。代预约和代取消
都会写入审计日志，操作分别记录为 `ADMIN_BOOKING_CREATED` 和
`ADMIN_BOOKING_CANCELLED`。

## 经营统计与导出

管理后台“经营统计”页面提供时间、校区、课程、老师筛选，展示课次数、预约人次、
上座率、取消率和到课率，并可下钻到每个有效课次。统计接口参数为 `from`、`to`、
`campusId`、`courseId`、`teacherId`；时间范围采用左闭右开区间，页面的结束日期
按自然日包含当天。

统一统计口径如下：

- 课次数：仅统计 `PUBLISHED`、`CLOSED`、`FINISHED`，排除草稿 `DRAFT` 和
  已取消/停课 `CANCELLED`。
- 预约人次：有效课次下除 `COURSE_CANCELLED` 外的预约单，包含用户主动取消。
- 上座率：`CONFIRMED`、`ATTENDED`、`LEAVE`、`ABSENT` 数量之和除以有效课次总容量。
- 取消率：`CANCELLED` 数量除以预约人次。
- 到课率：`ATTENDED` 数量除以已记录考勤数，即
  `ATTENDED + LEAVE + ABSENT`；分母为零时返回 `0`。
- 聚合比率均先汇总分子和分母后计算，不对各课次百分比做算术平均。

CSV 导出使用与页面相同的筛选和口径，编码为带 BOM 的 UTF-8，文件头包含筛选条件、
生成时间和完整口径说明。每次成功导出写入 `STATISTICS_CSV_EXPORTED` 审计日志，
记录操作者、筛选条件、生成时间、口径及导出行数。统计查询、明细、学生名称和审计写入
均使用访问令牌中的 `organizationId`，接口不接受客户端传入租户 ID。

## 通知与微信订阅消息

- 预约成功会通知学生家长和授课老师；预约取消会通知授课老师，同时保留家长站内通知。
- 已发布或停招课次会在开课前 24 小时和 2 小时为有效预约家长及授课老师生成提醒。
- 调课、停课继续沿用原有通知，并统一写入通知 Outbox。
- 业务事务只创建站内通知和待投递记录，不直接调用微信。微信发送由 API 进程内 worker
  异步执行，所以外部发送失败不会回滚预约、取消、调课或停课。
- Outbox 以机构和业务事件幂等键去重；失败后按指数退避自动重试，最多 5 次。进程异常
  留下的 `SENDING` 记录超过 5 分钟会重新领取。
- 管理后台“通知投递”页面展示状态、尝试次数和失败原因，可将 `FAILED` 或 `SKIPPED`
  记录补发。补发会重置尝试次数并重新排队。
- 小程序“通知”页提供“开启微信提醒”入口。微信单次最多申请 3 个模板，模板较多时会
  分批弹出授权确认。

微信订阅模板需配置 `thing1`（标题）和 `thing2`（内容）字段。生产部署如果使用多 API
副本，可共享同一 PostgreSQL；领取操作使用条件更新避免同一投递被并发 worker 重复处理。

老师端“我的课表”支持日/周视图、前后日期导航、回到今天和课次状态筛选。老师查询
`GET /sessions` 时，服务端会忽略客户端传入的 `teacherId` 并强制限定为当前登录老师。
老师可从课表页进入“创建课次”，表单只读取 `/teacher/options` 返回的启用资料；提交时
服务端再次校验课程、校区、教室和老师均属于当前机构且已启用，并校验教室属于所选校区。
基础资料名称以服务端记录为准，客户端提交的同名展示字段不会覆盖服务端资料。

## 排课系列

管理后台和老师端创建页均可选择“仅本次”或“按周重复”，按周重复支持 1–104 次。
服务端会先计算全部日期并检查老师、教室冲突：

- 默认 `skipConflicts=false`，任一日期冲突则整批原子失败，不写入系列、课次或审计记录。
- 显式设置 `skipConflicts=true` 时，只创建无冲突课次，响应同时返回 `successDates` 和
  `conflicts`（包含冲突日期、课次及老师/教室冲突类型）。
- `/session-series/preflight` 只做预检，不写入数据。
- 调课和停课请求可传 `scope: "THIS"`（默认）或
  `scope: "THIS_AND_FUTURE"`；后者从所选课次起处理同系列后续课次，并在事务中整体提交。
- 所有系列查询、冲突检查和写入均以访问令牌中的 `organizationId` 隔离。

系列创建示例：

```bash
curl -X POST http://localhost:3000/session-series \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <accessToken>' \
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
    "capacity":12,
    "recurrence":"WEEKLY",
    "intervalWeeks":1,
    "repeatCount":8,
    "skipConflicts":false
  }'
```

开发种子管理员为 `13800000001`，默认密码为 `Admin123!`，可通过
`SEED_ADMIN_PASSWORD` 修改，机构编码为 `DEMO`。真实环境必须修改默认密码并妥善保管微信密钥。

机构编码全局唯一；手机号和微信 OpenID 仅要求在同一机构内唯一，因此同一手机号可存在于不同机构。
后台登录请求必须同时提交 `organizationCode`、`phone` 和 `password`。小程序登录必须由
`wx.login` 获取 `loginCode`，由 `getPhoneNumber` 获取一次性 `phoneCode`，再提交
`organizationCode`、`loginCode` 和 `phoneCode`；接口不接受客户端手输的手机号。

```json
{
  "organizationCode": "DEMO",
  "loginCode": "<wx.login code>",
  "phoneCode": "<getPhoneNumber code>"
}
```

创建课次示例：

```bash
curl -X POST http://localhost:3000/sessions \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer <accessToken>' \
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
  -H 'authorization: Bearer <accessToken>' \
  -d '{"studentId":"student-2"}'

curl -X DELETE http://localhost:3000/bookings/booking-1 \
  -H 'authorization: Bearer <accessToken>'
curl http://localhost:3000/teacher/sessions/session-1/roster \
  -H 'authorization: Bearer <accessToken>'
```

## 已实现规则

- 结束时间晚于开始时间，单课次最长 8 小时。

- 已发布、停招课次占用老师与教室；草稿不占用。

- 区间按“新开始 `<` 已有结束且新结束 `>` 已有开始”判断冲突。

- 预约窗口、取消截止时间默认分别为开课前 7 天、2 小时和 4 小时。

- 同一学生同课次重复预约幂等，时间重叠则拒绝。

- 内存仓储按课次加锁，保证并发抢最后一个名额时只有一个请求成功。

- 取消后立即释放容量；老师名单只包含有效预约。

- 管理员代预约仍受容量、重复预约和学生时间冲突约束；代取消必须填写原因并记录操作人、
  预约、课次、学生和原因。

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
