---
title: "注解、[Starter](/glossary#starter) 与配置项速查"
description: "Spring Boot 4.1.1 常用注解、现行 Starter 名称与高频配置项速查表（约 40 键，含官方默认值），按场景分组即查即用。"
official: "https://docs.spring.io/spring-boot/4.1.1/appendix/application-properties/index.html"
---

# 注解、Starter 与配置项速查

## 本章你会学到

- 按场景快速定位功能对应的 starter：Web、数据、消息、安全、观测一张表看完；
- 按分层速查常用注解：Web、配置装配、数据事务、校验、缓存 [AOP](/glossary#aop-与切面)、消息异步、安全测试；
- 拿到一份带官方默认值的高频配置项表（约 40 键），改配置前先查这里。

> **下一章**：[废弃项清理与变更对照清单](/reference/cleanup)

## 业务场景

本页是全站速查页：不展开原理，只给"查得到、抄得走"的三张表。选型与用法见各正文章节。

本页是 4.1.1 基准下的速查表，即查即用不作展开；完整清单见官方镜像 `spring-boot-4.1.1-docs/appendix/`。

## 极简实现

### Starter 速查（4.x 现行名）

4.x 拆分了 starter 家族并重命名了部分条目，下表为常用部分（坐标均为 `org.springframework.boot`，版本由 BOM 管理）：

| Starter | 用途 |
| --- | --- |
| `spring-boot-starter-webmvc` | Spring MVC REST/页面服务（旧名对照见 [废弃项清理清单](/reference/cleanup)） |
| `spring-boot-starter-webflux` | 响应式 Web（Reactor Netty） |
| `spring-boot-starter-validation` | [Bean](/glossary#bean) Validation（Jakarta Validation） |
| `spring-boot-starter-data-jpa` | JPA 数据访问（[HikariCP](/glossary#连接池hikaricp) + Hibernate） |
| `spring-boot-starter-jdbc` | JDBC 数据访问 |
| `spring-boot-starter-data-redis` | Redis 访问（Lettuce） |
| `spring-boot-starter-security` | 安全与鉴权 |
| `spring-boot-starter-oauth2-resource-server` | OAuth2 资源服务器（[JWT](/glossary#jwt--csrf--cors-速记) 校验） |
| `spring-boot-starter-actuator` | 生产监控与管理端点 |
| `spring-boot-starter-micrometer-metrics` | Micrometer 指标门面（可独立于 actuator 使用） |
| `spring-boot-starter-aspectj` | AOP 切面（旧名对照见 [废弃项清理清单](/reference/cleanup)） |
| `spring-boot-starter-cache` | 缓存抽象（Caffeine/Redis 等任选实现） |
| `spring-boot-starter-mail` | 邮件发送（Jakarta Mail） |
| `spring-boot-starter-kafka` | Apache Kafka 消息 |
| `spring-boot-starter-amqp` | RabbitMQ 消息 |
| `spring-boot-starter-restclient` | 声明式 HTTP 客户端（RestClient / `@HttpExchange`） |
| `spring-boot-starter-opentelemetry` | OpenTelemetry + OTLP 链路追踪 |
| `spring-boot-starter-zipkin` | Brave + Zipkin 链路追踪 |
| `spring-boot-starter-test` | 测试：JUnit 5、[Mockito](/glossary#mock)、MockMvc、AssertJ |

::: tip 命名规律与测试配套
4.x 给每个 starter 提供成对的 `-test` 变体（如 `starter-webmvc-test`）；日常全栈测试从 `starter-test` 起步即可，全套清单见官方镜像 `appendix/dependency-versions/coordinates.md`。
:::

### 常用命令

```bash
./mvnw spring-boot:run    # 开发运行（Gradle：./gradlew bootRun）
java -jar target/app.jar  # 运行产物
```

## 关键注解与配置

### 常用注解速查

#### Web 层

| 注解 | 作用 | 常见位置 |
| --- | --- | --- |
| `@RestController` | REST 控制器（含 `@ResponseBody`） | Controller 类 |
| `@RequestMapping` | 路径前缀与方法映射 | 类 / 方法 |
| `@GetMapping` / `@PostMapping` / `@PutMapping` / `@DeleteMapping` / `@PatchMapping` | HTTP 方法路由 | 方法 |
| `@PathVariable` / `@RequestParam` / `@RequestHeader` / `@RequestBody` | 从路径、查询串、请求头、请求体取参 | 方法参数 |
| `@RestControllerAdvice` + `@ExceptionHandler` | 全局异常处理组合：Advice 类捕获所有控制器的异常，按异常类型分发到处理方法 | Advice 类 |
| `@CrossOrigin` | 控制器级 CORS 配置 | 类 / 方法 |
| `@HttpExchange`（及 `@GetExchange` 等）+ `@ImportHttpServices` | 声明式 HTTP 客户端接口方法与批量导入 | HTTP Service 接口 / 主类 |

#### 配置与装配

| 注解 | 作用 | 常见位置 |
| --- | --- | --- |
| `@SpringBootApplication` | 启动类：[自动配置](/glossary#自动配置auto-configuration) + 组件扫描 + 配置类 | 主类 |
| `@Configuration` + `@Bean` | 自定义装配 | 配置类 / 方法 |
| `@Component` / `@Service` / `@Repository` / `@Controller` | [Bean](/glossary#bean) 注册（语义分层） | 类 |
| `@ConfigurationProperties` | 类型安全配置绑定（配合 record） | 配置类 |
| `@Value("${key:default}")` | 单项配置读取（自带默认值更稳） | 字段 / 参数 |
| `@Profile("prod")` | 按 profile 条件装配 | 类 / 方法 |
| `@RequestScope` / `@SessionScope` | Bean 生命周期绑定到单个 HTTP 请求 / 会话（如请求上下文、用户会话状态） | 类 |

#### 数据与事务

| 注解 | 作用 | 常见位置 |
| --- | --- | --- |
| `@Transactional` | 事务边界（默认只回滚 RuntimeException） | Service 方法 |
| `@Entity` / `@Table` / `@Id` / `@GeneratedValue` | JPA 实体、表名、主键与生成策略 | 实体类 |
| `@Query` | 自定义查询（JPQL/SQL） | Repository 方法 |

#### 校验

| 注解 | 作用 | 常见位置 |
| --- | --- | --- |
| `@Valid` / `@Validated` | 触发级联校验 / 触发分组校验 | 参数 / 类 |
| `@NotNull` / `@NotBlank` / `@NotEmpty` | 非空约束（细分 null/空白/集合空） | [DTO](/glossary#dto) 字段 |
| `@Size` / `@Min` / `@Max` / `@Pattern` / `@Email` / `@Past` | 长度、数值范围、正则与语义约束 | DTO 字段 |

#### JSON 与缓存 AOP

| 注解 | 作用 | 常见位置 |
| --- | --- | --- |
| `@JacksonComponent` | 把 `ValueSerializer`/`ValueDeserializer` 注册为 Spring Bean，纳入自动配置的 JSON 序列化（Jackson 3，取代旧注解方式） | 序列化器类 / 内部类 |
| `@EnableCaching` | 开启缓存（Boot 引 starter 后多数场景免写） | 配置类 |
| `@Cacheable` / `@CachePut` / `@CacheEvict` | 读缓存 / 更新 / 失效缓存 | Service 方法 |
| `@Aspect` 与 `@Around` 等通知注解 | 切面声明与通知（配 `spring-boot-starter-aspectj`） | 切面类 / 方法 |

#### 消息与异步

| 注解 | 作用 | 常见位置 |
| --- | --- | --- |
| `@KafkaListener` / `@RabbitListener` / `@JmsListener` | 消息监听（对应各消息 starter） | Listener 方法 |
| `@Scheduled` / `@Async` | 定时任务（需 `@EnableScheduling`）/ 异步执行（需 `@EnableAsync`） | 方法 |

#### 安全与测试

| 注解 | 作用 | 常见位置 |
| --- | --- | --- |
| `@PreAuthorize` | 方法级鉴权（SpEL） | Service / Controller 方法 |
| `@SpringBootTest` | 集成测试：加载完整上下文 | 测试类 |
| `@WebMvcTest` / `@DataJpaTest` 等 `@*Test` 切片 | 只装配目标层的测试切片 | 测试类 |
| `@AutoConfigureMockMvc` | 配套注入 MockMvc | 测试类 |
| `@MockitoBean` / `@MockitoSpyBean` | 向上下文注入 mock/spy（Spring Framework 7 提供） | 测试字段 |
| `@TestConfiguration` | 测试专用附加配置（嵌套类追加，不替换主配置） | 嵌套类 |

#### 观测与端点

| 注解 | 作用 | 常见位置 |
| --- | --- | --- |
| `@Observed` | 方法级一次 Observation，同时产出指标与 span（需开启注解扫描） | Service 方法 |
| `@Timed` / `@Counted` | 微基准计时 / 调用计数（Micrometer 注解，同样需扫描开启） | 方法 |
| `@MeterTag` | 把方法参数绑定为指标 tag | 方法参数 |
| `@NewSpan` | 手工命名一个子 span（Micrometer Tracing 注解） | 方法 |
| `@ReadOperation` / `@WriteOperation` / `@DeleteOperation` | 自定义 Actuator 端点的读 / 写 / 删操作（对应 GET/POST/DELETE） | 端点方法 |

### 高频配置项速查

以下默认值摘自官方镜像 `appendix/application-properties/index.md`，标"—"表示官方未给默认值（随环境自动判定），标"※"表示附录未列默认值、以官方附录页面为准：

#### 服务器与停机

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `server.port` | `8080` | HTTP 端口 |
| `server.shutdown` | `graceful` | 优雅停机为默认；`immediate` 立即停止 |
| `spring.lifecycle.timeout-per-shutdown-phase` | `30s` | 停机宽限期 |
| `server.forward-headers-strategy` | —（受支持云平台 `native`，其余 `none`） | 反代后取真实 IP/协议 |
| `server.max-http-request-header-size` | `8KB` | 请求头大小上限 |
| `server.compression.enabled` | `false` | 响应压缩 |
| `server.tomcat.threads.max` | `200` | Tomcat 最大工作线程（开[虚拟线程](/glossary#虚拟线程-vs-平台线程)后不生效） |
| `server.tomcat.basedir` | —（临时目录） | Tomcat 工作目录 |

#### 数据源与 JPA

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `spring.datasource.url` | — | JDBC 连接串（驱动按 URL 自动探测） |
| `spring.datasource.username` / `spring.datasource.password` | — | 数据库凭据（密码走环境变量） |
| `spring.datasource.hikari.maximum-pool-size` | —（※，Hikari 默认 10） | [HikariCP](/glossary#连接池hikaricp) 连接池上限 |
| `spring.datasource.hikari.leak-detection-threshold` | —（※，0 即关闭） | 连接泄漏检测阈值 |
| `spring.jpa.hibernate.ddl-auto` | 内嵌库 `create-drop`，否则 `none` | 生产固定 `validate` 或 `none`，结构交给迁移工具 |
| `spring.jpa.show-sql` | `false` | 打印 SQL（仅开发环境） |
| `spring.jpa.open-in-view` | `true` | OSIV；生产建议显式关闭 |
| `spring.flyway.enabled` | `true` | [Flyway](/glossary#flyway-与数据库迁移) 迁移（类路径有 Flyway 时生效） |
| `spring.liquibase.enabled` | `true` | Liquibase 迁移 |

#### Actuator 与可观测性

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `management.endpoints.web.exposure.include` | `[health]` | Web 暴露端点清单 |
| `management.endpoints.web.exposure.exclude` | — | 排除端点，优先级高于 include |
| `management.endpoints.access.default` | — | 端点访问级别默认值 |
| `management.server.port` | 应用同端口 | 独立管理端口 |
| `management.endpoint.health.show-details` | `never` | 健康详情展示 |
| `management.endpoint.health.probes.enabled` | `true` | K8s 探针健康组 |
| `management.endpoint.env.show-values` / `management.endpoint.configprops.show-values` | `never` | env/configprops 端点是否显示真实值 |
| `management.endpoint.shutdown.access` / `management.endpoint.heapdump.access` | `none` | 高危端点默认禁止访问 |
| `management.prometheus.metrics.export.enabled` | `true` | Prometheus 导出（有注册表依赖时） |
| `management.observations.annotations.enabled` | `false` | `@Observed` 等注解扫描开关 |
| `management.tracing.sampling.probability` | `0.1` | 追踪采样率 |

#### 应用与运行时

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `spring.application.name` | — | 应用名（日志、监控、注册中心通用） |
| `spring.threads.virtual.enabled` | `false` | 虚拟线程开关（JDK 25 下推荐开启，详见虚拟线程章节） |
| `spring.main.allow-circular-references` | `false` | 是否允许循环依赖（4.x 默认拒绝） |
| `spring.main.lazy-initialization` | `false` | 全局[懒加载](/glossary#懒加载lazy-loading) |
| `spring.profiles.active` | — | 激活的 profile |
| `spring.task.execution.pool.core-size` | `8` | 普通线程池核心数（开虚拟线程后不生效） |
| `spring.autoconfigure.exclude` | — | 排除指定自动配置类 |
| `spring.data.redis.host` / `spring.data.redis.port` | `localhost` / `6379` | Redis 连接 |
| `spring.jackson.time-zone` | — | Jackson 格式化日期用的时区 |
| `spring.servlet.multipart.max-file-size` | `1MB` | 单文件上传上限 |
| `spring.servlet.multipart.max-request-size` | `10MB` | 单请求上传总上限 |
| `logging.file.name` | — | 日志文件位置 |

#### Web MVC 与客户端

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `spring.mvc.apiversion.supported` / `spring.mvc.apiversion.required` | —（※） | 内置 API 版本控制：支持版本清单 / 是否强制带版本 |
| `spring.mvc.apiversion.use.header` / `spring.mvc.apiversion.use.query-parameter` | —（※） | 从指定请求头 / 查询参数读取版本 |
| `spring.http.serviceclient.*` | —（※） | 声明式 HTTP Service Client 定义组 |
| `spring.cache.type` | —（按环境自动探测） | 缓存实现类型 |
| `spring.cache.redis.time-to-live` | —（默认不过期） | Redis 缓存条目过期时间 |
| `spring.kafka.bootstrap-servers` | — | Kafka 集群地址 |
| `spring.kafka.consumer.group-id` | — | 消费者组 |
| `spring.kafka.listener.ack-mode` | —（※） | 偏移提交模式 |

#### 日志

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `logging.file.name` | —（只写控制台） | 配置后开启文件输出；与 path 同时设置时以 name 为准 |
| `logging.file.path` | — | 日志目录（name 设置时被忽略） |
| `logging.level.<logger>` | —（根级别 INFO） | 按 logger 调级，如 `logging.level.com.example: debug` |
| `logging.logback.rollingpolicy.file-name-pattern` | `${LOG_FILE}.%d{yyyy-MM-dd}.%i.gz` | 滚动归档文件名模式 |
| `logging.logback.rollingpolicy.max-file-size` | `10MB` | 单文件达到即滚动 |
| `logging.logback.rollingpolicy.max-history` | `7` | 归档保留个数 |
| `logging.logback.rollingpolicy.total-size-cap` | `0B`（不限制） | 归档总大小上限 |
| `logging.pattern.correlation` | —（默认 `[traceId-spanId]`） | 日志中的链路关联 ID 格式 |

#### 开发体验与容器化

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `management.endpoints.web.base-path` | `/actuator` | 端点根路径（可改到 `/management` 等） |
| `spring.docker.compose.enabled` | `true` | 类路径有 compose 文件时随应用启停容器 |
| `spring.docker.compose.skip.in-tests` | `true` | 测试中默认跳过 Docker Compose |
| `spring.docker.compose.lifecycle-management` | `start-and-stop` | compose 生命周期托管方式 |

::: tip "※" 是什么意思
带 ※ 的键在官方附录的表格里没有默认值列（多为集成库自身决定或按环境探测）。本手册不替官方编造数值，使用时以 [官方附录页面](https://docs.spring.io/spring-boot/4.1.1/appendix/application-properties.html) 或集成库文档为准。
:::

## 避坑指南

::: warning 已废弃配置项不收录
本页只收 4.1.1 现行键。迁移老项目遇到"配置不生效"时，先查官方镜像 `appendix/deprecated-application-properties/index.md`——键被改名或删除时启动日志会给出提示，迁移期可临时加 `spring-boot-properties-migrator` 依赖辅助诊断。
:::

- **旧名 starter 不要抄网上教程**：3.x 及更早教程里的旧名在 4.x 已由现行名取代（对照见[废弃项清理清单](/reference/cleanup)）；表内注解本体属 Spring Framework 7 / Jakarta Validation 等上游项目，逐注解用法查上游 Javadoc。
- **默认值随依赖变化**：如 `spring.jpa.hibernate.ddl-auto` 内嵌库与外部库默认不同——按项目实际依赖理解"默认值"。遇到冷门键直接搜官方镜像 `appendix/application-properties/index.md`，别凭印象猜键名。

### 延伸阅读

- 官方镜像：`spring-boot-4.1.1-docs/appendix/application-properties/index.md`（属性默认值唯一权威来源）
- 官方镜像：`spring-boot-4.1.1-docs/appendix/dependency-versions/coordinates.md`（starter 全集坐标）
- 官方镜像：`spring-boot-4.1.1-docs/appendix/auto-configuration-classes/index.md`（自动配置模块清单）
- 官方镜像：`spring-boot-4.1.1-docs/appendix/deprecated-application-properties/index.md`（废弃键对照）
- 官方镜像：`spring-boot-4.1.1-docs/appendix/test-auto-configuration/slices.md`（测试切片注解）
- 官方镜像：`spring-boot-4.1.1-docs/reference/features/json.md`（@JacksonComponent 与 Jackson 3）
- 官网：<https://docs.spring.io/spring-boot/4.1.1/appendix/application-properties.html>
- 站内：[废弃项清理与变更对照清单](/reference/cleanup) · [常见问题](/faq) · [可观测性](/advanced/observability)
