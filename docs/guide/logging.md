---
title: 日志体系与结构化输出
description: Spring Boot 4.1.1 日志全景：slf4j 门面 + Logback 默认实现、控制台/文件输出、滚动策略、运行期动态调级、日志分组与 ECS/GELF/Logstash 结构化日志。
official: https://docs.spring.io/spring-boot/4.1.1/reference/features/logging.html
---

# 日志体系与结构化输出


**本章你会学到：**

- Spring Boot 日志体系全景：slf4j 门面 + Logback 默认实现 + Log4j2 可选切换
- 控制台输出与文件输出的完整配置，以及滚动策略属性键
- 用 application.yaml 与 Actuator `/actuator/loggers` 在运行期动态调级
- 日志分组（`logging.group.*`）与开箱即用的 `web`/`sql` 组
- 结构化日志三种 JSON 格式（ECS / GELF / Logstash）的最小配置
- MDC 与虚拟线程的关系，以及为什么生产代码禁止 `System.out.println`

> **上一章**：[配置管理与多环境](/guide/configuration) · **下一章**：[虚拟线程深度实践](/practice/virtual-threads)

## 业务场景

凌晨两点接口报错，你打开服务器却发现：

- 日志打满了控制台，没有落盘文件，重启后什么都查不到；
- 想临时把某个包调成 DEBUG，只能改配置重启服务，现场早就没了；
- 一堆微服务的日志是纯文本，ELK 采集后字段全靠正则猜。

这三个问题的答案分别对应本章三块内容：**文件输出与滚动策略**、**运行期动态调级**、**结构化日志**。日志不是"打个 print"那么简单，它是企业应用的可观测性地基。

## 极简实现

用任何 starter 创建的 Spring Boot 应用**零配置即有日志**——默认 Logback、输出到控制台、`ERROR`/`WARN`/`INFO` 级别生效。业务代码里只依赖 slf4j 门面：

```java
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class OrderService {

    // 门面固定写法：声明为 private static final，logger 名即类名
    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    public void createOrder(String orderId) {
        log.info("创建订单, orderId={}", orderId); // 占位符 {} 传参，避免字符串拼接
        try {
            // ... 业务逻辑
        } catch (Exception ex) {
            log.error("订单创建失败, orderId={}", orderId, ex); // 异常对象放最后一个参数，完整堆栈自动输出
        }
    }
}
```

控制台输出形如（默认格式，字段依次为：毫秒级时间、级别、进程 PID、分隔线、线程名、缩写的 logger 名、消息）：

```text
2026-08-17T10:51:35.255Z  INFO 11390 --- [myapp] [main] c.e.demo.OrderService    : 创建订单, orderId=O-1001
```

::: tip
如果配置了 `spring.application.name`，应用名会出现在方括号中（如 `[myapp]`）；不想打印可设 `logging.include-application-name=false`。另外 Logback 没有 `FATAL` 级别，会被映射为 `ERROR`。
:::

## 关键注解与配置

### 日志体系全景：门面 + 实现

Java 日志框架的正确打开方式是**门面（API）与实现分离**：

| 角色 | 组件 | 说明 |
| --- | --- | --- |
| 门面 | slf4j（Commons Logging 亦可） | 业务代码只 import 它，永不直接依赖具体实现 |
| 默认实现 | Logback | 使用任意官方 starter 时自动引入，无需额外依赖 |
| 可选实现 | Log4j2 | 需自行替换 starter 中的日志依赖 |
| 兼容路由 | JUL / Commons Logging / Log4j / slf4j | Spring Boot 已内置路由，依赖库里用哪种 API 的日志都会被转发到当前实现 |

Spring Boot 内部日志使用 Commons Logging，但把底层实现开放给用户；对 JUL、Log4j2、Logback 三种实现均提供了默认配置。**一般场景不需要更换日志依赖，默认就好**；当吞吐压力大（如高并发网关）想换 Log4j2 的异步 Appender 时，引入 `spring-boot-starter-log4j2` 并排除 starter 自带的 `spring-boot-starter-logging` 即可切换。

### 控制台输出

默认配置将日志回显到控制台，`ERROR`/`WARN`/`INFO` 级别生效。启动时加 `--debug`（或在配置中写 `debug=true`）可开启"调试模式"——注意它只让**核心 logger**（内嵌容器、Hibernate、Spring Boot）输出更多信息，并非全局 DEBUG；`--trace` 同理覆盖整个 Spring 家族。

```yaml
logging:
  console:
    enabled: true          # 关闭控制台输出设为 false（纯文件部署常用）
  pattern:
    console: "%d{yyyy-MM-dd'T'HH:mm:ss.SSSXXX} %5p ${PID:-} --- [%15.15t] %-40.40logger{39} : %m%n"  # 自定义控制台格式
  charset:
    console: UTF-8         # Windows 控制台乱码时显式指定字符集
  threshold:
    console: INFO          # 控制台级别阈值，低于它的日志不再输出
```

终端支持 ANSI 时默认彩色输出（级别映射：ERROR 红、WARN 黄、INFO/DEBUG/TRACE 绿），可用 `spring.output.ansi.enabled` 覆盖自动探测。

### 文件输出与滚动策略

Spring Boot **默认只写控制台、不写日志文件**。要落盘，设置 `logging.file.name` 或 `logging.file.path` 之一：

| `logging.file.name` | `logging.file.path` | 效果 |
| --- | --- | --- |
| 未设置 | 未设置 | 仅控制台 |
| 具体文件（如 `my.log`） | 未设置 | 写到指定文件（绝对/相对路径均可） |
| 未设置 | 具体目录（如 `/var/log`） | 向该目录写 `spring.log` |
| 具体文件 | 具体目录 | 只按 `logging.file.name` 写，`path` 被忽略 |

日志文件达到 **10 MB** 自动滚动归档。企业标准写法（含滚动策略）：

```yaml
logging:
  file:
    name: /var/log/myapp/myapp.log       # 指定文件即同时保留控制台输出
  logback:
    rollingpolicy:
      file-name-pattern: /var/log/myapp/myapp-%d{yyyy-MM-dd}.%i.gz  # 归档命名，默认即 ${LOG_FILE}.%d{yyyy-MM-dd}.%i.gz
      max-file-size: 100MB               # 单文件超过即归档（默认 10MB 偏小）
      total-size-cap: 5GB                # 归档总大小上限，超过删除最老归档
      max-history: 30                    # 最多保留 30 个归档文件（默认 7）
      clean-history-on-start: false      # 启动时是否顺带清理历史归档
```

### 日志级别动态调整

**静态调级**写在 application.yaml，键为 `logging.level.<logger-name>=<level>`，级别取 `TRACE`/`DEBUG`/`INFO`/`WARN`/`ERROR`/`FATAL`/`OFF`：

```yaml
logging:
  level:
    root: warn                                     # 兜底根级别
    org.springframework.web: debug                 # Web 层排障期临时放开
    com.example.demo.order: info                   # 业务包
```

也可用环境变量（仅支持包级）：`LOGGING_LEVEL_ORG_SPRINGFRAMEWORK_WEB=DEBUG`；要对单个类调级需走 `SPRING_APPLICATION_JSON`（环境变量会被宽松绑定转为小写，无法表达类名）。

**运行期调级**是生产刚需——引入 Actuator 后，`loggers` 端点不用重启就能改级别：

```bash
# 查询某 logger 当前生效级别
GET /actuator/loggers/com.example.demo.order

# 运行期把业务包临时调成 DEBUG（生效到重启或再次修改为止）
POST /actuator/loggers/com.example.demo.order
Content-Type: application/json

{"configuredLevel": "DEBUG"}
```

::: warning
`loggers` 端点能改变运行期行为，必须与 Actuator 的暴露控制配合：management 端口独立、不暴露公网、敏感端点加认证。可观测性整体方案（端点暴露、Tracing 关联 ID）见 [可观测性](/advanced/observability)。
:::

### 自定义日志配置文件与关闭钩子

需要在 XML 级别精细控制 Appender 时，各日志系统从 classpath 根目录按以下顺序加载配置，也可用 `logging.config` 指定任意位置：

| 日志系统 | 可加载的配置文件 |
| --- | --- |
| Logback | `logback-spring.xml`、`logback-spring.groovy`、`logback.xml`、`logback.groovy` |
| Log4j2 | `log4j2-spring.xml`、`log4j2.xml` |
| JDK（JUL） | `logging.properties` |

要强制指定日志系统或整体禁用，设系统属性 `org.springframework.boot.logging.LoggingSystem` 为实现类全名，值 `none` 表示禁用。注意：日志系统在 `ApplicationContext` 创建**之前**初始化，所以 `@Configuration` 里的 `@PropertySource` 影响不了日志，只能通过系统属性控制。

application.yaml 中的部分 `logging.*` 属性会自动转移为系统属性，供自定义配置文件引用：`logging.file.name` → `LOG_FILE`、`logging.file.path` → `LOG_PATH`、`logging.pattern.console` → `CONSOLE_LOG_PATTERN`、`logging.structured.format.console` → `CONSOLE_LOG_STRUCTURED_FORMAT` 等。因此 `logback-spring.xml` 里可直接写 `${LOG_FILE}`、`${CONSOLE_LOG_STRUCTURED_FORMAT}` 占位符。若要在日志属性里用占位符，必须用 Spring Boot 语法（属性名与默认值之间用 `:`），不能用 Logback 的 `:-`。

应用退出时 Spring Boot 会自动注册一个**日志关闭钩子**（war 部署除外）触发日志系统清理、释放资源；复杂上下文层级下它可能不满足需求，可设 `logging.register-shutdown-hook=false` 关闭后改用底层框架自身方案（如 Logback context selector）。

### 日志分组

把一组相关 logger 打包统一调级，避免记不清顶层包名：

```yaml
logging:
  group:
    tomcat: org.apache.catalina,org.apache.coyote,org.apache.tomcat   # 自定义组
    db: org.springframework.jdbc.core,org.hibernate.SQL               # 自定义组
  level:
    tomcat: trace        # 一行调整整组
    db: debug
```

开箱即用预定义了两组：**`web`**（Spring Web/HTTP 相关 logger）与 **`sql`**（JDBC core、Hibernate SQL、jOOQ LoggerListener）——排 SQL 问题时 `logging.level.sql=debug` 一行即可。

### 结构化日志：ECS / GELF / Logstash

结构化日志把每行日志写成**机器可读的 JSON**，采集端不再依赖正则解析。Spring Boot 开箱支持三种格式，用 `logging.structured.format.console`（控制台）或 `logging.structured.format.file`（文件）指定：

```yaml
logging:
  structured:
    format:
      console: ecs        # 可选 ecs | gelf | logstash
```

三种格式一行日志的样子与适用场景：

```text
ECS：{"@timestamp":"...","log":{"level":"INFO","logger":"org.example.Application"},"process":{"pid":39599,...},"service":{"name":"simple"},"message":"...","ecs":{"version":"8.11"}}
GELF：{"version":"1.1","short_message":"...","timestamp":1725958035.857,"level":6,"_level_name":"INFO",...}
Logstash：{"@timestamp":"...","@version":"1","message":"...","logger_name":"org.example.Application","thread_name":"main","level":"INFO","level_value":20000}
```

- **ECS**（Elastic Common Schema）：走 ELK/Elasticsearch 采集的首选，字段规范化最完整；
- **GELF**：对接 Graylog 平台时使用；
- **Logstash**：经典 Logstash 采集管道格式，SLF4J Marker 会输出为 `tags` 数组。

三者都会把 **MDC 中所有键值对**写入 JSON，也支持用 SLF4J Fluent API 的 `addKeyValue` 追加业务字段。服务标识可用 `logging.structured.ecs.service.*`（name/version/environment/node-name）定制——`name` 默认取 `spring.application.name`，`version` 默认取 `spring.application.version`。JSON 字段还能微调：`logging.structured.json.exclude/rename/add` 可过滤、重命名、追加成员；堆栈打印行为由 `logging.structured.json.stacktrace.*`（root/max-length/max-throwable-depth 等）控制。

### MDC 与虚拟线程、以及为什么禁用 System.out.println

**MDC 与虚拟线程**：MDC 基于 `ThreadLocal` 实现，虚拟线程（JDK 25 下默认启用，见[虚拟线程实战](/practice/virtual-threads)）每个都有独立上下文，请求处理期间 `MDC.put`/`%X{user}` 照常工作，无需改代码；若显式用平台线程池处理异步任务，跨线程传递 MDC 需框架支持（如 Micrometer Tracing 的上下文传播）。

**为什么禁止 `System.out.println`**：

1. **无级别**——不能按环境/级别过滤，生产上关不掉；
2. **无门面**——写死 IO 行为，无法统一切换实现与格式；
3. **不可调级**——无法接入 Actuator 运行期控制；
4. **同步开销**——`println` 内部同步，高并发下成为吞吐瓶颈；
5. **破坏采集**——游离于日志体系之外的行会污染结构化 JSON 流，ELK 采集直接报错。

::: tip
格式里若要加 MDC 字段，只覆写 `logging.pattern.level` 即可，例如 `logging.pattern.level=user:%X{user} %5p`，默认格式就会带上 `user` 条目，不必重写整条 pattern。
:::

## 避坑指南

1. **级别键名写错，配置静默失效**。键是 `logging.level.<logger-name>`——级别在等号（YAML 中冒号）右侧。写成 `logging.level.com.example=INFO` 没问题，但写成 `logging.log-level.com.example`、或把 `logging.level.root` 拼成 `logging.level.ROOT` 之外的随意大小写包名，都会被忽略且不报错。包名必须与 logger 名完全一致（小写），改完立刻用 `/actuator/loggers/<name>` 验证生效级别。

2. **文件输出只配了 `logging.file.name` 却没配滚动上限，磁盘被日志打满**。默认单文件 10 MB 滚动、归档保留 7 个看似安全，但只要 `max-file-size` 被调大又忘配 `total-size-cap`，长期运行的写密集服务照样撑爆磁盘。生产三件套必须齐全：`max-file-size` + `total-size-cap` + `max-history`，并对日志目录单独挂盘或配磁盘告警。

3. **生产把 SQL 打到控制台**。为"看得清"在生产设了 `logging.level.sql=debug` 或 `org.hibernate.SQL=debug`：高流量下每条 SQL 都渲染输出，控制台 I/O 拖垮吞吐且日志含敏感数据。约束为"开发环境 profile 才放开 SQL 级别"，生产保持 `sql` 组为 `warn`/`info`；用 `logging.threshold.console` 再兜一道底。

4. **自定义 Logback 配置用了 `logback.xml` 而不是 `logback-spring.xml`**。标准位置的 `logback.xml` 加载太早，Spring 无法接管初始化，`<springProfile>`/`<springProperty>` 扩展直接报错。统一使用 `logback-spring.xml`（Log4j2 用 `log4j2-spring.xml`），或在 `logging.config` 指定位置。

5. **环境变量调级想精确到类，结果不生效**。`LOGGING_LEVEL_ORG_SPRINGFRAMEWORK_WEB=DEBUG` 这类环境变量因宽松绑定强制转小写，只能配包级；要给单个类调级请用 `SPRING_APPLICATION_JSON`，或干脆走 Actuator `loggers` 端点运行期改。

6. **以为 debug 模式等于全局 DEBUG**。`--debug` 只对内嵌容器、Hibernate、Spring Boot 的核心 logger 生效，业务包并不会输出 DEBUG。要全局细粒度控制，老老实实写 `logging.level.*`。

### 延伸阅读

- 官方镜像：`spring-boot-4.1.1-docs/reference/features/logging.md`（工作区语料，含全部属性表）
- 官方原文：[Logging](https://docs.spring.io/spring-boot/4.1.1/reference/features/logging.html)
- 站内进阶：[可观测性（Actuator 与 Tracing）](/advanced/observability) ｜ [外部化配置](/guide/configuration) ｜ [虚拟线程实战](/practice/virtual-threads)
