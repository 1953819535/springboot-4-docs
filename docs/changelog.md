---
title: 更新日志
description: 《现代 Spring Boot 4.1.1 企业开发快速入门》章节演进记录，Keep a Changelog 风格。
---

# 更新日志

记录手册的章节演进，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [2026-09-14]（第二轮）

### Added

- 全站 19 页完成二轮深度扩写，统一 Vue 官方文档风格要素：页首"本章你会学到"+ 上章链接、示例递进带中文注释、`### 深入：XXX` 小节、正文页避坑 ≥5 条、页尾"延伸阅读"（官方镜像路径 + 站内链接）
- `advanced/deployment.md` 补全：JVM 容器参数完整表（MaxRAMPercentage/MaxMetaspaceSize/ExitOnOutOfMemoryError/UseZGC）、K8s 探针完整 yaml、发布与回滚流程清单、优雅停机四步链路（preStop → SIGTERM → 宽限期 → terminationGracePeriodSeconds）、构建产物对照表（fat jar/解包/容器/native）
- `advanced/observability.md` 补全：自定义指标两种方式完整例（编程式 Counter/Gauge/Timer 与 `@Observed` 注解）、Prometheus 抓取配置段、自定义 HealthIndicator 完整例、loggers 运行期调级完整 curl 例（GET/POST/清除）、指标命名规范与低基数纪律、tracing 展开（OTLP 与 Zipkin 两条 starter 路线）
- `reference/api.md` 配置项速查表扩至约 40 键（新增日志组、观测注解组、开发体验与容器化组），每键默认值逐条从官方附录摘录，附录未列默认值的键以"※"标注并指向官方附录，不编造
- `faq.md` 扩至 16 问：新增启动慢排查（startup 端点 + BufferingApplicationStartup）、连接池打满（hikaricp 指标 + 泄漏检测）、时区序列化、CORS 三层拦截、测试无 Docker、循环依赖三种解法、日志落盘轮转、上传大小限制

### Changed

- 部署/观测/安全/测试四页生产进阶示例统一改为可递进跟做的完整链路，前后页交叉引用对齐
- 速查页注解表新增 `@JacksonComponent`（Jackson 3）、`@RequestScope`/`@SessionScope`、`@RestControllerAdvice` 组合语义与观测注解组（`@Observed`/`@Timed`/`@Counted`/`@MeterTag`/`@NewSpan`、端点操作注解）

### Fixed

- 构建复验通过：全站 VitePress 构建无死链、无告警；零容忍项复核通过（审计记录见工作区 .cluster/sbvite/audit.md，站外文件不随站点发布）
- 项目迁移：站点源码自工作区移至桌面 `springboot-docs/` 便于交付

### 基线复核

- JDK 25 LTS · Spring Framework 7 · Jakarta EE 11 · Spring Boot 4.1.1（第二轮全量页逐条对照本地官方镜像复核）

## [2026-09-14]（第一轮）

### Added

- 新增 `advanced/observability.md`：Actuator 生产参数表、K8s liveness/readiness 探针、Prometheus 接入、loggers 在线调级、端点安全
- 新增 `advanced/deployment.md`：fat jar 打包、Buildpacks 与分层 Dockerfile（jarmode=tools 提取）、生产启动参数、systemd 服务、优雅停机

### Changed

- 重构 `reference/api.md`：注解按场景分组，Starter 全量改 4.x 现行名，配置项补默认值
- 重构 `faq.md`：H2 分类问答，扩至 12 问，补官方镜像出处
- 重构 `changelog.md`：改为 Keep a Changelog 条目
- 基线修订：JDK 17+ → **JDK 25 LTS**，启动参数默认容器感知（MaxRAMPercentage）

### Removed

- `reference/api.md` 删除已废弃的旧名 starter 条目与无默认值配置项
- `faq.md` 删除无出处路径的旧问答

### Fixed

- 修复语料 email-protection 缺陷：本地官方镜像未受影响，本手册引用的镜像路径与默认值均逐条核验

### 二轮深度扩写（Vue 官方文档风格）

- 19 个内容页全部深扩至内容完整级（约 290KB 总量，均值 14KB/页）：示例从最小可运行递进到企业形态、新增「深入：XXX」小节、避坑指南扩至 5–10 条/页、页尾新增「延伸阅读」（官方镜像路径 + 站内链接）
- 数据访问页主线重写：事务传播表 + 事务失效五坑反例 + 多数据源骨架 + Flyway 规范
- 测试页重写：测试金字塔、切片全谱最小例、@ServiceConnection 容器清单、测试数据策略表
- 修正 API Versioning 媒体类型策略示例（media-type-parameter 为「媒体类型=参数名」Map 语义）
- 站点迁移至桌面并由桌面构建验证（0 死链）

### 基线变更

- JDK 25 LTS · Spring Framework 7 · Jakarta EE 11 · Spring Boot 4.1.1
- Starter 更名至 4.x 现行名（`starter-webmvc`、`starter-aspectj`），`starter-test` 新增 `-classic` 变体
- 安全配置统一 `SecurityFilterChain` lambda DSL（Spring Security 7）

### [2026-09-15] PowerShell 命令变体

#### Added

- `guide/getting-started.md`：Spring Initializr 下载命令增加 Windows PowerShell 对照（Invoke-WebRequest 原生命令，避开 curl 别名陷阱）
- `advanced/observability.md`：Actuator loggers 运行期调级 GET/POST 增加 PowerShell 版本（Invoke-RestMethod + 反引号续行）
- `guide/configuration.md`：三处环境变量命令（SERVER_PORT 临时覆盖 / SPRING_APPLICATION_JSON / DB_PASSWORD 敏感值注入）全部增加 `$env:` 变体，JSON 单引号语义差异已标注
- `practice/grpc.md`：grpcurl 调用增加 PowerShell 引号转义提示（`-d @request.json` 文件引用法，跨平台一致）

#### Changed

- 全站导航行措辞统一为「上一章 / 下一章」标准形态（覆盖 上一步/📍上章/混排链接 等 6 处变体）
- 术语自动链接 151 处落位后清理 7 个文件的嵌套链接与 6 处标题内误链（避免破坏 VitePress 目录锚点）
## [Unreleased]

### 计划

- 补充统一响应与全局异常的完整可运行示例代码仓库
- 增加 OpenAPI（springdoc）接口文档章节
- 可观测性篇补充 OTLP 自定义指标推送示例

::: tip 语料说明
本手册所有页面的事实性内容（默认值、命令、模板）以本地官方镜像 `spring-boot-4.1.1-docs/` 为唯一权威来源，镜像版本锁定 4.1.1。
:::

> **上一章**：[常见问题](/faq)
