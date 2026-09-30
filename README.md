# math-ai

小学数学 AI 辅导系统。

## V0.23 云端学习档案

V0.23 保持 LocalStorage 为离线缓存，同时通过 Cloudflare Worker 将统一学习事件同步到 Supabase。

### Supabase 数据库

在 Supabase SQL Editor 执行：

`supabase/migrations/20260930_v023_learning_archive.sql`

数据结构：
- `math_ai_learners`：单个孩子的云端档案元数据。
- `math_ai_learning_events`：不可依赖客户端状态的学习证据；以 `learner_id + event_id` 去重，支持幂等 upsert。
- 每条事件同时保存 `raw_payload` 与 `normalized_event`，便于后续升级统一学习模型时恢复旧数据。

### Cloudflare Worker 环境变量

配置：
- `SUPABASE_URL`：Supabase Project URL。
- `SUPABASE_SECRET_KEY`：Supabase Secret Key。不要放进前端代码。
- `MATH_AI_LEARNER_ID`：孩子档案 ID；当前默认 `local-default`。

Worker 路由：
- `GET /api/sync/status`
- `GET /api/sync/pull`
- `POST /api/sync/push`

### 当前同步策略

页面启动时：
1. 先显示本地 LocalStorage。
2. 检查云端是否已配置。
3. 已配置则拉取云端事件并与本地记录去重合并。
4. 合并后的完整学习档案再同步回云端。

发生新的错题、复测或训练记录后，页面会自动触发云端同步。

### 安全边界

Supabase Secret Key 只在 Cloudflare Worker 中使用；数据库不开放给浏览器匿名访问。

V0.23 仍是单孩子原型，云端 API 尚未加入用户登录/身份认证。真正长期使用前，应在 Cloudflare Access 或后续 Supabase Auth 层增加身份认证，避免公开 Worker 端点被第三方调用。

Supabase REST API 基于 PostgREST，可通过 `/rest/v1/` 访问数据库；upsert 可利用唯一约束实现重复事件的幂等合并。