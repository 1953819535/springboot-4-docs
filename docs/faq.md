---
title: "常见问题（FAQ）"
description: "Spring Boot 4.1.1 高频问题速答：启动失败与启动慢排查、依赖冲突、属性不生效、循环依赖、连接池、时区序列化、跨域、上传限制、虚拟线程、事务失效与测试上下文缓存。"
---

# 常见问题（FAQ）

按"症状 → 原因 → 解法"组织：每问先给最小答案，再给关键键/注解与官方镜像出处。

## 启动失败

### 启动就挂，如何快速定位？

```bash
java -jar app.jar --debug
```

`--debug`（或 `-Ddebug`）会输出**条件评估报告**：哪些[自动配置](/glossary#自动配置auto-configuration)命中、哪些没命中、原因是什么，是排查启动失败的第一入口；Actuator 应用可直接看 `/actuator/conditions`。
出处：`spring-boot-4.1.1-docs/reference/using/auto-configuration.md`

### 应用启动慢，怎么排查？

三步：① `--debug` 看条件评估报告，确认没加载用不到的自动配置；② 启动追踪——`application.setApplicationStartup(new BufferingApplicationStartup(2048))` 后看 `startup` 端点逐步列出 [Bean](/glossary#bean) 初始化耗时；③ 缓解：`spring.main.lazy-initialization=true` 全局[懒加载](/glossary#懒加载lazy-loading)，或只给重 Bean 加 `@Lazy`。
出处：`spring-boot-4.1.1-docs/reference/features/spring-application.md`（Application Startup tracking）、`spring-boot-4.1.1-docs/reference/actuator/endpoints.md`（startup 端点）

### 端口被占用：Port 8080 was already in use

改 `server.port`，或定位并结束占用进程（Windows：`netstat -ano | findstr 8080`）。
出处：`spring-boot-4.1.1-docs/reference/web/servlet.md`

### 启动报循环依赖（4.x 起默认拒绝），三种解法怎么选？

`The dependencies of some of the beans form a cycle`。按优先级：① **重构**——把两边都用到的逻辑抽成第三方 Bean 打破环（正解）；② 注入点加 `@Lazy`，先注入代理、首次使用才解析；③ `spring.main.allow-circular-references=true`（默认 `false`，这是回退旧行为的开关不是修复，只留给改不动的遗留代码）。
出处：`spring-boot-4.1.1-docs/appendix/application-properties/index.md`（allow-circular-references 默认值）

### 依赖冲突：NoSuchMethodError / ClassNotFoundException

以 BOM 对齐版本：继承 `spring-boot-starter-parent` 或导入 `spring-boot-dependencies`，业务代码**不要自己写版本号**；冲突时用 `mvn dependency:tree`（Gradle：`dependencies` 任务）找出旧版本来源并 exclusion。
出处：`spring-boot-4.1.1-docs/reference/using/build-systems.md`

## 配置问题

### 配置改了不生效 / 拼错了为何不报错？

不生效：按覆盖顺序排查（命令行参数 > 环境变量 > jar 外 `config/` 文件 > jar 内文件），relaxed binding 下环境变量是全大写+下划线形式（`SERVER_PORT`），用 Actuator `env` 端点看最终取值与来源。拼错不报错：普通 `@Value`/Environment 对未知键静默，改用 `@ConfigurationProperties` + `@Validated` 让错误在启动期暴露。
出处：`spring-boot-4.1.1-docs/reference/features/external-config.md`

## Web 与请求处理

### 跨域（CORS）配了还被拦？

先分清拦在哪一层：**业务层**——全局配 `WebMvcConfigurer#addCorsMappings`、单控制器配 `@CrossOrigin`，含凭据时禁止 `*` 通配来源；**安全层**——引入 Spring Security 后请求还要过过滤链，CSRF 默认开启会让 POST/PUT/DELETE 预检与写入 403，需在 `SecurityFilterChain` 中放行/集成 CORS（见[安全与鉴权](/advanced/security)）；**代理层**——网关/Nginx 也可能吃掉或重复写 CORS 头，用浏览器 DevTools 看预检响应定位。
出处：`spring-boot-4.1.1-docs/reference/web/servlet.md`（CORS）、`spring-boot-4.1.1-docs/reference/actuator/endpoints.md`（CSRF 默认开启）

### 接口返回的时间多了 8 小时 / 日期序列化不对

容器默认 UTC：JVM 参数加 `-Duser.timezone=Asia/Shanghai` 或环境变量 `TZ`；Jackson 序列化侧配 `spring.jackson.time-zone`（格式化时区）与 `spring.jackson.date-format`（日期格式）；消息资源编码 `spring.messages.encoding` 默认已是 UTF-8。
出处：`spring-boot-4.1.1-docs/appendix/application-properties/index.md`（spring.jackson.* 键）

### 上传文件报 MaxUploadSizeExceededException

上传上限默认很小：`spring.servlet.multipart.max-file-size` 默认 `1MB`、`spring.servlet.multipart.max-request-size` 默认 `10MB`，按业务调大这两个键即可；走了反向代理时代理侧的请求体限制（如 Nginx 的 `client_max_body_size`）也要同步调大。
出处：`spring-boot-4.1.1-docs/appendix/application-properties/index.md`（spring.servlet.multipart.* 默认值）

## 日志

### 日志怎么落盘与轮转？

默认只写控制台；配 `logging.file.name`（或 `logging.file.path`）即开启文件输出，到达 10MB 自动滚动。轮转策略用 `logging.logback.rollingpolicy.*` 调整：`max-file-size`（默认 `10MB`）、`max-history`（归档保留个数，默认 `7`）、`total-size-cap`（归档总上限，默认 `0B` 不限制）。
出处：`spring-boot-4.1.1-docs/reference/features/logging.md`、`spring-boot-4.1.1-docs/appendix/application-properties/index.md`（rollingpolicy 默认值）

## 数据与事务

### `@Transactional` 不生效？

三大高频原因：**同类自调用**（`this.method()` 不走代理）、方法非 public、抛出的是受检异常（默认只回滚 RuntimeException/Error，受检异常需 `rollbackFor` 显式声明）。
出处：`spring-boot-4.1.1-docs/reference/data/sql.md`

### 连接池打满：获取连接超时 / 请求堆积？

先看指标再动手：`/actuator/metrics/hikaricp.connections.active`（活跃数）、`hikaricp.connections.pending`（排队数）反映池水位。处理顺序：① 查慢 SQL 与过大的事务范围（连接被长事务占着，调大池子只是推迟爆炸）；② 查连接泄漏——`spring.datasource.hikari.leak-detection-threshold=30s` 让 [HikariCP](/glossary#连接池hikaricp) 标记疑似泄漏；③ 确属容量不足再调 `spring.datasource.hikari.maximum-pool-size`。
出处：`spring-boot-4.1.1-docs/reference/actuator/metrics.md`（DataSource/Hikari 指标）、`spring-boot-4.1.1-docs/appendix/application-properties/index.md`（hikari 键）

## 

### 什么时候不该开虚拟线程？

`spring.threads.virtual.enabled=true` 的收益在阻塞型 IO（JDBC、HTTP 调用）；重 CPU 任务无收益，且 synchronized 长临界区、ThreadLocal 滥用的旧代码可能先暴露问题——这类代码先改造再开。
出处：`spring-boot-4.1.1-docs/reference/features/task-execution-and-scheduling.md`

## 测试

### 测试切片导致上下文反复构建、跑得慢？

Spring 测试框架按配置缓存上下文：配置不同就重建。尽量让同类测试共用相同配置（勿在测试类上叠加互不相同的 `@TestPropertySource`/properties），必要时才用 `@DirtiesContext`。
出处：`spring-boot-4.1.1-docs/reference/testing/spring-boot-applications.md`

### 测试要 Docker：CI 环境没有 Docker 怎么办？

[Testcontainers](/glossary#testcontainers) 的集成测试需要可用的 Docker 环境，CI 没有 Docker 时要么安装 Docker/替代运行时，要么把该类测试降级为内嵌数据库版本。Docker Compose 生命周期支持默认不进测试（`spring.docker.compose.skip.in-tests` 默认 `true`）。出处：`spring-boot-4.1.1-docs/reference/testing/testcontainers.md`、`spring-boot-4.1.1-docs/appendix/application-properties/index.md`（spring.docker.compose.* 默认值）

### Lombok 与 record 怎么选？

数据载体（[DTO](/glossary#dto)、配置、实体字段投影）优先 record：不可变、免 Lombok；需要可变对象或 JPA 实体仍用 class + Lombok。
出处：`spring-boot-4.1.1-docs/reference/features/external-config.md`（Lombok 生成 getter/setter 的注意事项）、`guide/ioc-di`（本手册）

::: tip 按同样格式补充新问题
可观察的报错原文放最前，便于搜索命中；答案控制在八行内，出处给到官方镜像路径。
:::

> **上一章**：[核心概念速查（零基础术语表）](/glossary) · **下一章**：[更新日志](/changelog)
