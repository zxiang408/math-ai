# math-ai

## V0.26 事件重建能力档案

V0.26 在 V0.25 的云端事件恢复基础上增加确定性的“事件 → 能力模型”重建：Worker 从 Supabase 拉取学习事件后重新计算知识点六阶段状态、微技能证据状态，并生成当前训练建议；前端恢复后会校验云端重建快照与本地事件推导结果是否一致。事件仍然是长期学习档案的事实来源，不直接持久化最终能力状态。

## V0.25 云端档案恢复

V0.25 在 V0.24 的可验证同步基础上增加完整云端事件缓存与显式“从云端恢复”入口。最近一次从 Supabase 拉取的事件会保留在浏览器本地的云端档案缓存中；页面启动时可先利用该缓存离线恢复，再与 Supabase 核对。显式恢复只执行 pull + merge，不会先清空本地学习记录。


## V0.24 云端档案可验证同步

V0.24 在 V0.23 的 LocalStorage + Supabase 学习事件架构上，增加云端事件计数、最近同步时间，以及手动同步后的 push → Supabase → pull 往返校验。页面会显示本地事件、云端事件和最近同步时间；校验通过后明确标记往返成功。


小学数学 AI 辅导系统。

## V0.23 云端学习档案

V0.23 保持 LocalStorage 为离线缓存，同时通过 Cloudflare Worker 将统一学习事件同步到 Supabase；V0.24 在此基础上加入可验证同步；V0.25 增加云端事件缓存与显式恢复。

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
- `GET /api/sync/pull`（V0.26 额外返回 `ability_snapshot`）
- `POST /api/sync/push`

### 当前同步策略（V0.25）

页面启动时：
1. 先显示本地 LocalStorage。
2. 检查云端是否已配置。
3. 已配置则拉取云端事件并与本地记录去重合并。
4. V0.25 额外保存最近一次拉回的完整云端事件缓存；需要时可通过“从云端恢复”执行 pull + merge。

发生新的错题、复测或训练记录后，页面会自动触发云端同步。

### 安全边界

Supabase Secret Key 只在 Cloudflare Worker 中使用；数据库不开放给浏览器匿名访问。

V0.23 仍是单孩子原型，云端 API 尚未加入用户登录/身份认证。V0.25 不改变这一安全边界，也不把 Supabase Secret 暴露给前端。真正长期使用前，应在 Cloudflare Access 或后续 Supabase Auth 层增加身份认证，避免公开 Worker 端点被第三方调用。

Supabase REST API 基于 PostgREST，可通过 `/rest/v1/` 访问数据库；upsert 可利用唯一约束实现重复事件的幂等合并。