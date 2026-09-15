---
title: "废弃项清理与变更对照清单"
description: "本手册已剔除的过时知识点、老旧配置项与对应的新版现代化替代方案 — Spring Boot 4.1.1 / Spring Framework 7 / JDK 25 基线"
official: "https://docs.spring.io/spring-boot/4.1.1/appendix/deprecated-application-properties/index.html"
---

# 废弃项清理与变更对照清单

> 本页是全站唯一出现"旧名"的页面——仅作迁移对照用。正文各章一律只写 4.1.1 现行写法。

> **上一章**：[注解、Starter 与配置项速查](/reference/api) · **下一章**：[核心概念速查（术语表）](/glossary)

## 业务场景

升级到 Spring Boot 4.1.1（Spring Framework 7 / Jakarta EE 11 / JDK 25）时，旧项目里大量 2.x/3.x 时代的写法已经失效或不被推荐。本页给出本手册内容取舍的完整对照：哪些写法被剔除、替代方案是什么、去哪里查官方依据。

::: warning 迁移建议
跨大版本（3.x → 4.x）迁移时，先加 `spring-boot-properties-migrator` 运行期依赖：启动时会打印所有失效属性的迁移诊断。迁移完成后移除该依赖。逐版本变更清单见官方 GitHub wiki 的 Release Notes 与 4.0 Migration Guide（外链，不在本镜像语料内）。
:::

## 剔除对照表

### 命名空间与运行环境

| 旧写法（已剔除） | 现行写法（本手册基线） | 说明 |
| --- | --- | --- |
| `javax.*` 全系导包 | `jakarta.*`（Jakarta EE 11） | Servlet 6.1 / JPA 3.2 / Validation 3.1 / Annotation API 全部走 jakarta 命名空间 |
| JDK 8/11/17 作为推荐运行时 | **JDK 25 LTS**（最低 17，兼容至 26） | [虚拟线程](/glossary#虚拟线程-vs-平台线程)、Record 模式匹配、未命名变量等现代语法全面启用 |
| `javax.annotation.PostConstruct` | `jakarta.annotation.PostConstruct` | 生命周期注解换空间，语义不变 |

### Web 与 REST

| 旧写法（已剔除） | 现行写法（本手册基线） | 说明 |
| --- | --- | --- |
| `spring-boot-starter-web`（旧主名） | `spring-boot-starter-webmvc` | 4.x 模块化改名，语义不变（自带校验） |
| `RestTemplate`（新代码） | `RestClient` / `@HttpExchange` 接口客户端 | 同步调用用 RestClient；类型安全用声明式接口客户端；WebClient 仅限响应式栈 |
| 手写 URL 版本前缀（`/api/v1/users` 双份 Controller） | Spring Framework 7 内置 API Versioning | `apiVersion` 配置 + 请求头/媒体类型等解析策略 |
| `ResponseEntity<String>` 手拼错误 JSON | `ProblemDetail`（RFC 9457） | Spring 6+ 原生错误模型，@ControllerAdvice 统一返回 |

### 安全

| 旧写法（已剔除） | 现行写法（本手册基线） | 说明 |
| --- | --- | --- |
| `WebSecurityConfigurerAdapter` | `SecurityFilterChain` [Bean](/glossary#bean) + lambda DSL | 旧适配器在 Security 7 已不存在 |
| `authorizeRequests()` / `antMatchers()` / `mvcMatchers()` | `authorizeHttpRequests()` + `requestMatchers()` | 新授权 API，模式匹配统一 |
| 手写 `OncePerRequestFilter` 解析 [JWT](/glossary#jwt--csrf--cors-速记)（新项目默认） | `spring-boot-starter-oauth2-resource-server` + JWT decoder | 框架级 JWT 校验，少写过滤器少踩坑 |

### 数据访问

| 旧写法（已剔除） | 现行写法（本手册基线） | 说明 |
| --- | --- | --- |
| `JdbcTemplate` 手写列映射（新代码） | `JdbcClient` 流式 API | 4.x 推荐的查询/更新统一入口，record 映射顺滑 |
| `javax.persistence.*` JPA 注解 | `jakarta.persistence.*` | 同命名空间迁移 |
| 手写 SQL 脚本管理表结构 | [Flyway](/glossary#flyway-与数据库迁移)（`spring-boot-starter-flyway`，坐标以官方语料为准） | 版本化迁移，启动即校验 |

### 配置项（旧键 → 新键）

以下属性键为官方已废弃清单中的代表项（完整 67 键见官方文档 [appendix/deprecated-application-properties/index](https://docs.spring.io/spring-boot/4.1.1/appendix/deprecated-application-properties.html)）：

| 旧配置键（已剔除） | 替代配置键 | 说明 |
| --- | --- | --- |
| `spring.main.show-banner` | `spring.main.banner-mode` | 横幅开关语义化 |
| `management.endpoints.enabled-by-default` | `management.endpoints.access.default` | 4.x 端点访问控制模型（access 取代 enable） |
| `management.dynatrace.metrics.export.v1.*` | `management.dynatrace.metrics.export.v2.*` | Dynatrace V1 API 停用 |
| `spring.jackson.*` 二级序列化配置主体 | Jackson 3 命名空间（以官方 JSON 章为准） | Jackson 2 已弃用，将在未来 4.x 移除 |

::: tip 查全量废弃键
官方文档 [appendix/deprecated-application-properties/index](https://docs.spring.io/spring-boot/4.1.1/appendix/deprecated-application-properties.html) 按 9 个分类列出全部 67 个废弃键及替代键；IDE 配置补全（基于配置元数据规范）会在输入旧键时直接标灰。
:::

### 运维与工具

| 旧写法（已剔除） | 现行写法（本手册基线） | 说明 |
| --- | --- | --- |
| Spring Boot CLI 跑 Groovy 脚本 | CLI 仅剩 `init` / `encodepassword` / `shell` | 4.x CLI 定位为脚手架工具 |
| DevTools LiveReload | 已弃用（4.1.0 起，无替代） | 静态资源热加载改用构建工具链 |
| Zipkin Brave [自动配置](/glossary#自动配置auto-configuration) | Micrometer Tracing + OTel | 官方预告 4.2 移除 Brave 自动配置 |

## 避坑指南

- **不要凭旧教程写配置键**：属性默认值与键名以本站 [注解、Starter 与配置项速查](/reference/api) 和官方镜像 appendix 为准；IDE 补全是最快的防错层。
- **starter 旧名仍在兼容别名里的，也不要用于新项目**：别名随时可能移除，新项目一律 4.x 新名。
- **迁移顺序**：先升 4.x（属性迁移工具 + 废弃键清单）→ 再换 jakarta 全量导包 → 最后启用 JDK 25 语法与虚拟线程。一次跨两步会让编译错误与运行错误混在一起难排查。
- **验证手段**：全库 `grep "javax\."` 应为 0 命中；构建期开启 `-Werror` 让废弃 API 警告变错误。

::: info 官方出处
- 废弃属性全清单：[appendix/deprecated-application-properties/index](https://docs.spring.io/spring-boot/4.1.1/appendix/deprecated-application-properties.html)（67 键 / 9 分类）
- 升级机制与迁移工具：`upgrading.md`
- Jackson 2 弃用原文：[reference/features/json](https://docs.spring.io/spring-boot/4.1.1/reference/features/json.html)
- Zipkin 预告与 LiveReload 弃用：[reference/actuator/tracing](https://docs.spring.io/spring-boot/4.1.1/reference/actuator/tracing.html)、[reference/features/devtools](https://docs.spring.io/spring-boot/4.1.1/reference/features/devtools.html)
:::
