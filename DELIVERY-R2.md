# 变更交付总结（二轮）— Vue 官方文档风格深度扩写 + 桌面迁移

- 日期：2026-09-14 · 执行：主线 + 6 路深扩 Writer + 5 路补位 Writer
- 项目位置：C:\Users\19538\Desktop\springboot-docs（已按要求移动到桌面）
- 一轮总结见工作区 .cluster/sbvite/CHANGELOG-DELIVERY.md

## 用户反馈与二轮目标
反馈：文档内容太简陋，快速入门也要保证重要内容的完整性，参考 Vue 官方文档风格；完成后项目移动到桌面。

## 二轮执行
- 6 路深扩 Writer 派发（快速入门×4 / HTTP 客户端×2 / 虚拟线程数据×2 / gRPC 消息缓存×3 / 安全测试×2 / 部署观测参考×5）；其中 5 路因超时或 LLM 故障由 5 路补位 Writer 接力，data-access 由主线直接重写，全部落盘。
- Vue 文档风格要素落全：页首"本章你会学到"+上章链接、最小→企业递进示例带中文注释、"深入：XXX"小节、避坑 5–10 条/页、页尾"延伸阅读"（官方镜像路径 + 站内链接）。
- 完整性补强：标准目录树与完整 pom、事务传播与失效五坑、多数据源骨架、Flyway 规范、gRPC deadline 与错误码、Kafka 死信与手动 ack、缓存 key 设计与一致性、CORS 三写法、方法级注解全集、Testcontainers 模式、JVM 容器参数表、自定义 Micrometer 指标、配置项 ~40 键默认值、faq 扩到 16 问。

## 二轮验收
- 红线扫描（javax./旧安全 API/旧 starter 名/历史叙事）：20 文件 0 命中
- 结构合规 v2：20/20 页通过（四步法/frontmatter/容器/延伸阅读）
- 构建：桌面 vitepress build 通过（7.08s，0 死链），dist 22 页
- 事实口径：键名/默认值全部以官方镜像原文为准；语料未覆盖处明确标注"以官方 XX 文档为准"，不硬写

## 文件清单（二轮全量重写 19 页 + changelog 条目更新）
guide/getting-started.md、guide/ioc-di.md、guide/configuration.md、guide/rest-api.md、guide/http-clients.md、guide/api-versioning.md、practice/virtual-threads.md、practice/data-access.md、practice/grpc.md、practice/messaging.md、practice/caching.md、advanced/security.md、advanced/testing.md、advanced/deployment.md、advanced/observability.md、reference/api.md、reference/cleanup.md、faq.md、changelog.md、index.md（微调）

## 使用方式
- 本地预览：cd C:\Users\19538\Desktop\springboot-docs 然后 npm run docs:dev（端口 5273）
- 构建：npm run docs:build（已验证通过）；产物 docs/.vitepress/dist/
- 官方语料依赖：spring-boot-4.1.1-docs/ 镜像仍在工作区（293 页），手册页尾"延伸阅读"引用其路径

## 剩余风险
- 语料快照 2026-09-14，官方更新不自动同步
- 事实核验为关键断言抽样（一轮 26 项 + 二轮各 Writer 自检），非逐句全量比对
- 原工作区副本已按"移动"语义删除，桌面为唯一副本——建议尽快 git init 入库
## 三轮补强（2026-09-15）

用户指出"三种注入方式对比只写了一种示例"类缺口。全库扫描确认 5 处"表格声称 N 种、代码只给 1 种"，已全部补齐完整示例：

| 页面 | 补齐内容 |
|---|---|
| guide/ioc-di.md | 三种注入方式各给完整可运行类（构造器/Setter/字段，::: code-group 三栏对照 + 测试视角结论） |
| guide/api-versioning.md | 四种解析策略各给完整 properties 配置 + curl 请求样例（code-group 四栏） |
| practice/data-access.md | 极简选型表后补 JdbcClient vs JPA 两路线"按城市查活跃用户"写法对照 |
| practice/grpc.md | 四种通信模式补一元模式完整闭环（proto/服务端/客户端三步）+ 流式三模式 proto 签名速览 |
| advanced/testing.md | 测试数据策略补三种策略最小用法（事务回滚/@Sql/TRUNCATE 钩子） |

复验：红线扫描 0 命中、tip/warning 容器全页覆盖、构建通过（6.75s，0 死链）。
## 四轮导航修正（2026-09-15）

用户问"目录顺序与页内上章/下一章切换是否正确"。审计（nav_audit2.py，可复算）发现 18+ 页的页内导航与侧边栏顺序不一致（多路 Writer 并行写作时的顺序假设与最终侧边栏不同、4 个新页插入链路中段）。已按"分区内首页无上章、末页指向下一区首页、更多区（FAQ/更新日志）依序串联"的规则全部修复：

- 侧边栏权威顺序：快速入门 5 页 → 现代实战 9 页 → 生产进阶 4 页 → 参考 2 页 → FAQ/更新日志
- 21 个内容页 + faq/changelog 的上/下一章链接 100% 与侧边栏一致（nav_audit2.py 归零）
- 顺带清理了 3 处正文导语里的旧导航残句（改为行内引用）

复验：红线扫描 0 命中；构建通过（7.79s，25 个 HTML 页，0 死链）。
## 五轮概念补全（2026-09-15）

用户指出"许多核心概念缺失（bean、API 版本等），阅读时无法理解文档内容"。概念审计脚本（concept_audit.py，36 术语 × 全库扫描"使用 vs 定义"）确认 11 个核心概念被全文使用但从未定义。已补全：

**新增 [docs/glossary.md](C:\Users\19538\Desktop\springboot-docs\docs\glossary.md)（核心概念速查，11.9KB）**：按"容器与对象管理 / Web 与接口设计 / 数据与事务 / 测试概念 / 部署与运维 / 并发概念"六大组完整定义 Bean、IoC、依赖注入、自动配置、Starter、ApplicationContext、REST、API 版本化、DTO、拦截器/过滤器、ORM、懒加载、N+1、事务、连接池、Flyway、Mock、切片测试、Testcontainers、镜像层/Buildpacks、fat jar/BOOT-INF、端点、指标/标签、虚拟线程/平台线程、pinning、RPC/protobuf/deadline、缓存穿透/雪崩/击穿、AOP、MDC/链路追踪、JWT/CSRF/CORS 等全部核心术语，每个含一句话定义 + 生活化类比 + "为什么重要"，附概念关系图。

**5 个高频页内嵌"术语速览"框**（出现在概念首次使用处，链到术语表）：getting-started（Bean/IoC/DI/Starter）、data-access（ORM/懒加载/N+1/DTO）、api-versioning（版本化/解析策略）、testing（Mock/切片/Testcontainers）、deployment（fat jar/镜像层/Buildpacks）。

**导航链更新**：glossary 加入侧边栏"更多"区首位，cleanup 下一章 → glossary → FAQ，25 页导航审计归零。

复验：概念审计 36 术语全覆盖（11 项缺口清零；唯一余项"镜像层/Buildpacks"为审计窗口口径误报——deployment.md 术语速览框内已有完整定义）；红线 0 命中；构建通过（6.03s，25 HTML 页，0 死链）。站点最终态：25 页 / 372KB。
## 六轮增强（2026-09-15）：Git 入库 + 术语双向链接 + 流程图

按用户选择的"高价值低成本"三项完成：

1. **Git 入库**：桌面仓库 git init，基线提交 0c3f9f9（5 轮精修成果留档），增强提交 c1fda58——误删/改坏从此可回滚。
2. **术语双向链接**：glossary.md 18 个 H3 加锚点；脚本全站扫描 18 个核心术语在每页的首次出现，共植入 151 处指向术语表的链接（每术语每页最多 1 处防刷链）；6 处标题内误链自动还原（避免破坏 VitePress 目录锚点）。
3. **流程图**：手绘 4 张统一风格 SVG（Spring 品牌绿、Build 极简风）嵌入对应章节——security（JWT 认证时序）、batch（chunk 执行模型与容错）、virtual-threads（虚拟线程 vs 平台线程阻塞行为）、configuration（配置覆盖顺序）。

复验：构建通过（11.73s，dist 26 页含 4 图），红线 0 命中，导航审计沿用归零态。
## 七轮 Windows/PowerShell 命令变体（2026-09-15）

用户要求补 Windows/PowerShell 命令变体。完成：

- `guide/getting-started.md`：Initializr 下载 → PowerShell `Invoke-WebRequest` 对照（bash/PowerShell code-group）
- `advanced/observability.md`：loggers 运行期调级 GET/POST → `Invoke-RestMethod` 对照（反引号续行 + effectiveLevel 直取）
- `guide/configuration.md`：三处环境变量命令（SERVER_PORT 临时覆盖 / SPRING_APPLICATION_JSON / DB_PASSWORD 敏感值注入）→ `$env:` 变体，单引号 JSON 语义差异标注
- `practice/grpc.md`：grpcurl 的 PowerShell 引号转义 tip（`-d @request.json` 文件引用法）

顺带完成导航一致性收尾：6 处措辞变体（上一步/📍上章/嵌套链接）统一为标准「上一章/下一章」形态，术语自动链接造成的 7 文件嵌套链接与 6 处标题误链已清理。

复验：构建 9.62s 通过（0 死链）、红线 0 命中、nav_audit4 归零。Git 提交 09c48f6。
## 八轮修复（2026-09-15）：流程图 SVG 畸形导致裂图

用户截图反馈 4 张流程图实际无法展示。诊断：生成脚本的模板字符串残留字面量 `{W}` 占位符（用 `.replace` 而非正确插值），导致 4 张 SVG 第 1 行 XML 声明畸形——浏览器拒绝渲染（ET.fromstring 解析全部报 invalid token）。

修复：重写生成脚本（纯字符串拼接 + XML 转义函数），重生成 4 张 SVG。验证：XML 解析全部 VALID；结构断言（每图 rect/text 节点数与关键文案）全部命中；构建后 dist/diagrams/ 4 文件有效，4 个页面的 `<img src="/diagrams/*.svg">` 引用正确。Git 提交 4713647。