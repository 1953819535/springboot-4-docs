---
title: "可观测性与 Actuator 生产参数"
description: "用 Actuator 暴露健康探针、运行期日志调级与 Micrometer 指标，自定义 Counter/Gauge/Timer 与 HealthIndicator，接 Prometheus 抓取，配置 K8s liveness/readiness，守住端点安全底线。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/actuator/endpoints.html"
---

# 可观测性与 Actuator 生产参数

## 本章你会学到

- 接入 Actuator，按"最小暴露"原则开放端点，并理解 access 与 exposure 两层控制；
- 把 liveness/readiness 探针配进 Kubernetes，并给启动慢的应用加 startupProbe；
- 用 Micrometer 记录业务指标：编程式 Counter/Gauge/Timer 与 `@Observed` 注解两种方式；
- 编写自定义 `HealthIndicator`，把关键依赖纳入健康检查；
- 通过 `loggers` 端点运行期调级（不重启），并用 Prometheus 抓取 `/actuator/prometheus`；
- 理解指标命名与低基数标签纪律，守住时序库不被打爆。

端点访问控制会用到 `SecurityFilterChain`（见[安全与鉴权](/advanced/security)）；探针接入 K8s 的做法见[打包、镜像与部署](/advanced/deployment)。

> **上一章**：[测试策略与 Testcontainers](/advanced/testing) · **下一章**：[打包、镜像与部署](/advanced/deployment)

## 业务场景

应用上线后，运维要能回答四个问题：**它活着吗**（健康检查与 K8s 探针）、**它慢在哪**（QPS、耗时、连接池）、**它在打什么日志**（运行期调级，不用重启）、**出事后能保留现场吗**（heapdump/threaddump）。Spring Boot 的答案是 Actuator + Micrometer。

## 极简实现

### 第一步：接入 Actuator 并暴露端点

::: code-group
```xml [Maven pom.xml]
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-actuator</artifactId>
</dependency>
```
```kotlin [Gradle build.gradle.kts]
dependencies {
    implementation("org.springframework.boot:spring-boot-starter-actuator")
}
```
:::

```yaml
# application.yaml -- 生产推荐暴露清单：按需最小暴露
management:
  endpoints:
    web:
      exposure:
        include: "health,info,metrics,prometheus,loggers"
  endpoint:
    health:
      show-details: never   # 对外只给状态，不给细节
```

启动后访问 `GET /actuator/health` 得到 `{"status":"UP"}` 即接入完成。这里有两层独立的控制：

- **exposure（暴露）**：`management.endpoints.web.exposure.include` 决定端点能否经 HTTP 访问，默认只暴露 `health`；
- **access（访问级别）**：`management.endpoint.<id>.access`（`none`/`read-only`/`unrestricted`）决定端点是否存在于上下文中，`shutdown` 与 `heapdump` 默认就是 `none`。

排障场景推荐"默认全关、逐个放行"：`management.endpoints.access.default=none` 后再逐端点放行（如 `management.endpoint.loggers.access=read-only`）。

### 第二步：K8s 存活与就绪探针

4.x 已自动启用 liveness 与 readiness 健康组，无需额外配置，直接配进 Pod：

```yaml
livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 3
  failureThreshold: 8
readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 2
  failureThreshold: 3
```

启动慢的应用推荐再加 `startupProbe`（可复用 liveness 路径）。端点端口要写 Actuator 实际暴露的端口：配了 `management.server.port` 独立管理端口则指向该端口。探针选型详见部署章节的 [K8s 探针一节](/advanced/deployment#k8s探针发布与优雅停机)。

### 第三步：指标接入 Prometheus

引入 Prometheus 注册表依赖，再暴露 `prometheus` 端点：

::: code-group
```xml [Maven pom.xml]
<dependency>
  <groupId>io.micrometer</groupId>
  <artifactId>micrometer-registry-prometheus</artifactId>
</dependency>
```
```kotlin [Gradle build.gradle.kts]
dependencies {
    runtimeOnly("io.micrometer:micrometer-registry-prometheus")
}
```
:::

`management.endpoints.web.exposure.include` 加入 `prometheus` 后，在 `prometheus.yml` 里添加一段抓取配置（官方示例）：

```yaml
# prometheus.yml
scrape_configs:
- job_name: "spring"
  metrics_path: "/actuator/prometheus"   # 抓取端点不是 /actuator/metrics
  static_configs:
  - targets: ["HOST:PORT"]
```

::: tip 抓取端口与暴露清单要对齐
配了 `management.server.port` 时 targets 写管理端口；`prometheus` 端点必须出现在 exposure.include 里，否则 404。
:::

HTTP、JVM、连接池（`hikaricp.*`）、缓存等内置指标由 Micrometer 自动带上；业务代码的写法见下一节。

### 第四步：运行期调整日志级别

暴露 `loggers` 端点后可在线调级，排障完毕再调回，全程不重启：

```bash [macOS / Linux]
# 查看单个 logger（GET）：configuredLevel 是显式配置，effectiveLevel 是最终生效值
curl http://localhost:8080/actuator/loggers/com.example.order

# 临时调到 DEBUG（POST + JSON 体），排障完毕同样方式 POST 回 INFO
curl -X POST http://localhost:8080/actuator/loggers/com.example.order \
     -H 'Content-Type: application/json' -d '{"configuredLevel":"DEBUG"}'
# POST 空对象 {} 可清除显式级别，回落到继承值
```
```powershell [Windows PowerShell]
# GET：Invoke-RestMethod 直接反序列化 JSON，看 effectiveLevel 最方便
(Invoke-RestMethod http://localhost:8080/actuator/loggers/com.example.order).effectiveLevel

# POST 调级：JSON 体用单引号包裹，内层属性用转义引号
Invoke-RestMethod -Uri "http://localhost:8080/actuator/loggers/com.example.order" `
  -Method Post -ContentType "application/json; charset=utf-8" `
  -Body '{"configuredLevel":"DEBUG"}'

# 清除显式级别：Body 换成空对象 {}
```

响应里的 `groups` 很实用：内置 `web`、`sql` 组覆盖一类相关 logger，`POST /actuator/loggers/sql` 一次调一整组。

### 深入：自定义指标——编程方式

注入 `MeterRegistry` 即可注册业务指标。以订单服务为例，计数、耗时、瞬时值三类常用仪表各来一个：

```java
@Service
public class OrderService {

    private final Counter createdCounter;   // 只增不减的计数器：下单总量
    private final Timer createTimer;        // 耗时分布：下单耗时（含 QPS）
    private final AtomicLong pending = new AtomicLong(); // 瞬时值载体：待处理订单数

    public OrderService(MeterRegistry registry) {
        // 指标名用点分（Prometheus 侧自动转为下划线）
        this.createdCounter = Counter.builder("orders.created")
                .description("Total orders created")
                // tag 值必须是有限集合（低基数），见下方命名规范
                .tag("channel", "web")
                .register(registry);
        this.createTimer = Timer.builder("orders.create.time")
                .description("Order creation latency")
                .tag("channel", "web")
                .register(registry);
        // Gauge 挂一个可变的数值载体，读取发生在抓取时
        Gauge.builder("orders.pending", pending, AtomicLong::get)
                .register(registry);
    }

    public void create(Order order) {
        pending.incrementAndGet();
        createTimer.record(() -> {
            // ……业务逻辑……
        });
        pending.decrementAndGet();
        createdCounter.increment();          // 业务成功后再 +1，失败不计
    }
}
```

Gauge 依赖的对象要长期存活（如上面的 `AtomicLong` 字段）；指标依赖其他 Bean 时，官方建议改用 `MeterBinder` Bean 封装注册，保证依赖关系正确、便于复用（出处见页尾 `metrics.md`）。

### 深入：自定义指标——@Observed 注解方式

一行注解同时产出**指标 + 链路追踪**（ Observation 语义）。先开启注解扫描（`management.observations.annotations.enabled=true`，默认 `false`）并引入 `spring-boot-starter-aspectj`——注解走 AOP，需要其中的 aspectjweaver。

```java
@Service
public class InventoryService {

    // 方法每次调用产出一次 Observation：名为 inventory.check 的指标 + 对应 span
    @Observed(name = "inventory.check",
              contextualName = "checking-inventory",
              lowCardinalityKeyValues = {"region", "cn-east"})
    public void check(String sku) {
        // ……业务逻辑……
    }
}
```

两种方式怎么选：`@Observed` 零侵入、指标与 trace 一把抓，适合方法级粗粒度埋点；编程式 `Counter/Timer` 粒度最细，能在方法内部按业务分支精确计数。注意官方提示：对**已被自动埋点的方法**（如 Spring MVC 控制器、Data Repository）再加注解会产生重复观测——要么去掉注解，要么用 `ObservationPredicate` 关掉对应的自动埋点。

### 深入：自定义 HealthIndicator

把关键依赖纳入 `/actuator/health`。实现 `HealthIndicator` 接口，Bean 名去掉 `HealthIndicator` 后缀即为健康项 key（下例为 `payment`）：

```java
@Component
public class PaymentHealthIndicator implements HealthIndicator {

    @Override
    public Health health() {
        int errorCode = check();
        if (errorCode != 0) {
            // DOWN 会聚合为整体 DOWN，HTTP 状态映射 503
            return Health.down().withDetail("Error Code", errorCode).build();
        }
        return Health.up().build();
    }

    private int check() {
        // 例如：支付网关连通性探测
        return 0;
    }
}
```

细节：单个指示器超过 `management.endpoint.health.logging.slow-indicator-threshold`（默认 `10s`）会打慢告警；`management.health.<key>.enabled` 可关闭单个自动配置的指示器。liveness/readiness 探针默认**不含**自定义指示器——需要时用健康组显式加入（`management.endpoint.health.group.readiness.include=readinessState,customCheck`）。

## 关键注解与配置

### 生产关键参数表

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `management.endpoints.web.exposure.include` | `[health]` | Web 暴露的端点清单；生产按需加 `metrics,prometheus,loggers` 等 |
| `management.endpoints.web.exposure.exclude` | — | 排除项，**优先级高于 include**；`include=*` 时务必用它排除敏感端点 |
| `management.endpoints.access.default` | — | 访问级别默认值；设为 `none` 后再逐端点 opt-in，可整体收紧 |
| `management.endpoint.<id>.access` | 端点各异（`shutdown`/`heapdump` 默认 `none`） | 单端点访问级别（`none`/`read-only`/`unrestricted`） |
| `management.endpoint.health.show-details` | `never` | 健康详情展示策略：`never`/`when-authorized`/`always` |
| `management.endpoint.health.probes.enabled` | `true` | liveness/readiness 探针健康组自动启用 |
| `management.endpoint.env.show-values` / `management.endpoint.configprops.show-values` | `never` | env/configprops 是否显示真实值（`******` 脱敏策略） |
| `management.prometheus.metrics.export.enabled` | `true` | 类路径有 prometheus 注册表时即开启导出 |
| `management.observations.annotations.enabled` | `false` | `@Observed`/`@Timed`/`@Counted` 注解扫描开关 |
| `management.tracing.sampling.probability` | `0.1` | 链路追踪采样率（Tracing 引入后生效） |

### 应用 info 贡献：build-info

开启后 `/actuator/info` 展示构建坐标与版本，线上可核对部署的是哪个包。Maven 给 `spring-boot-maven-plugin` 加 `build-info` goal、Gradle 用 `springBoot { buildInfo() }`，生成的 `META-INF/build-info.properties` 由 Actuator 自动读取（`management.info.build.enabled` 默认已开启），配置示例见官方镜像 `maven-plugin/build-info.md`。

### 指标命名规范与低基数纪律

- **命名用点分小写**：`orders.created`；Micrometer 自动转后端格式（Prometheus 变 `orders_created`），`/actuator/metrics` 下钻仍用原始点分名。
- **tag 是维度，不是内容**：`channel=web` 这类**低基数** tag 进指标与 trace；`userId`、`sku` 这类**高基数**值只进 trace（`highCardinalityKeyValue`）——高基数值一旦进指标，时序库序列数量随用户量爆炸，Micrometer 的低/高基数区分正是为此设计。
- **公共维度交给 common tags**：region、stack 等全局维度用 `management.observations.key-values.*` 配置一次，全部观测自动携带（低基数）。
- **临时指标用 per-meter 过滤关**：`management.metrics.enable.<前缀>=false` 可按前缀停用指标。

### 深入：链路追踪一句展开

Micrometer Tracing 是 tracer 门面，Spring Boot 自动配置两个实现组合：**OpenTelemetry + OTLP**（`spring-boot-starter-opentelemetry`，导出到 Jaeger/Tempo 等）与 **Brave + Zipkin**（`spring-boot-starter-zipkin`）。HTTP 请求自动产生 span，日志默认附带 `[traceId-spanId]` 关联 ID；采样率默认 10%。语料锚点：`reference/actuator/tracing.md`、`reference/actuator/observability.md`（Context Propagation）。

### 端点安全与最小暴露

- **Spring Security 自动兜底**：未自定义 `SecurityFilterChain` 时，除 `/health` 外的端点已自动受保护；自定义后须用 `EndpointRequest.toAnyEndpoint()` 自行收紧（如要求 `ENDPOINT_ADMIN` 角色）。注意带默认安全配置时 POST 类端点（loggers 调级）会被 CSRF 拦下，见[安全与鉴权章节](/advanced/security)。
- **独立端口 + 内网隔离**：`management.server.port` 与防火墙/NetworkPolicy 双保险。
- **自定义端点**：只读操作标 `@ReadOperation`，配合默认 `read-only` 收紧；整体授权方案见[安全与鉴权章节](/advanced/security)。

## 避坑指南

::: warning 三个端点永远不要公开暴露
`heapdump` 会返回完整堆内存转储（含密钥、用户数据），`threaddump` 泄露内部结构与路径，`shutdown` 能直接关停应用（后两者默认 access 已是 `none`，勿手工放开）。用 `management.endpoints.web.exposure.exclude=heapdump,threaddump` 显式排除，并让 `include` 避免使用裸 `*`。排查问题需要现场时，走跳板机内网临时放行，用完收回。
:::

- **不要把 `/actuator/metrics` 当生产抓取后端**：该端点官方明确不推荐作为生产监控数据源——它是给人看的"指标目录"，高频抓取会有性能开销；生产抓取走 `/actuator/prometheus` 或 OTLP 推送。
- **YAML 里的星号要加引号**：`include: "*"` 不加引号会被 YAML 解析器吞掉。
- **`exclude` 优先于 `include`**：两者同时出现时以 exclude 为准，"排除 + 通配"组合时先核对这条。
- **探针误报就绪**：若 Actuator 部署在独立管理端口，管理侧健康检查成功不代表业务主端口可用；K8s 探针端口务必指向正确目标，或用 `add-additional-paths` 把探针组挂到主端口。
- **健康信息脱敏**：`show-details: always` 会把 db、redis 等组件细节（含主机名）暴露给未授权访问者；对外保持 `never`，需要细节时配 `when-authorized` + 角色。
- **健康组校验**：group 引用不存在的健康指示器会启动失败；宽松处理设 `management.endpoint.health.validate-group-membership=false`。
- **低基数标签**：`userId` 这类高基数值不要打进 metrics 标签（打爆时序库），只放 trace；给已被自动埋点的方法（MVC 控制器、Repository）再加 `@Observed` 也会产生双份指标，二选一。

### 延伸阅读

- 官方镜像：`spring-boot-4.1.1-docs/reference/actuator/endpoints.md`（端点清单、暴露与访问控制、健康组、自定义 HealthIndicator、K8s 探针）
- 官方镜像：`spring-boot-4.1.1-docs/reference/actuator/observability.md`（Micrometer Observation、@Observed 注解、低/高基数、Common Tags）
- 官方镜像：`spring-boot-4.1.1-docs/reference/actuator/metrics.md`（Prometheus 抓取配置、Registering Custom Metrics、per-meter 过滤）
- 官方镜像：`spring-boot-4.1.1-docs/reference/actuator/tracing.md`（Micrometer Tracing、OTLP/Zipkin、采样率）
- 官方镜像：`spring-boot-4.1.1-docs/api/rest/actuator/loggers.md`（loggers GET/POST 请求与响应结构）
- 官方镜像：`spring-boot-4.1.1-docs/api/rest/actuator/metrics.md`（metrics 端点不作为生产抓取后端）
- 官方镜像：`spring-boot-4.1.1-docs/maven-plugin/build-info.md`、`spring-boot-4.1.1-docs/gradle-plugin/integrating-with-actuator.md`（build-info）
- 官方镜像：`spring-boot-4.1.1-docs/appendix/application-properties/index.md`（management.* 默认值）
- 站内：[打包、镜像与部署](/advanced/deployment) · [安全与鉴权](/advanced/security) · [配置项速查](/reference/api)
