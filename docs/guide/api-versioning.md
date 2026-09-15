---
title: "内置 API 版本控制"
description: "Spring Framework 7 原生 API Versioning——version 属性映射、四种版本解析策略对比、编程式配置、优雅弃用与客户端携带版本。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/web/servlet.html"
---

# 内置 API 版本控制

> **本章你会学到**
>
> - 用 `version` 属性让同一个 Controller 路径按版本分流，不再复制 `/v1/users`、`/v2/users` 两套代码
> - 四种版本解析策略（请求头/查询参数/媒体类型参数/路径段）的请求形态与适用场景
> - `configureApiVersioning` 编程式配置：多策略顺序、默认版本、强制要求与版本集合
> - 用 `ApiVersionDeprecationHandler` 做"先提示、后停用"的优雅弃用
> - 客户端（RestClient/WebClient）如何与服务器策略对齐地携带版本
>
> 上一章：[HTTP 客户端三件套](/guide/http-clients) ｜ 下一章：[Spring gRPC 服务](/practice/grpc)

## 业务场景

::: tip 术语速览
**API 版本化**：接口发生不兼容变更时，新旧两版并行服务不同客户端——同一 URL 按版本路由到不同方法。**解析策略（Resolver）**：从请求的哪个位置读取版本（请求头/查询参数/媒体类型参数/路径段）的规则。更多见 [核心概念速查](/glossary)。
:::


API 演进的经典两难：破坏性变更必须发新版，但路径前缀版本（`/v1/`、`/v2/`）会把代码与文档翻倍。Spring Framework 7 给出了框架级答案——**版本是请求映射的一等属性**：

- 同一个 `@Controller` 的同一个路径，可按版本多次映射
- 版本从请求头、查询参数、媒体类型参数、路径段中解析（策略可配）
- 客户端侧 `RestClient` / `WebClient` 同步支持发送版本

::: tip 适用判断
内部少量接口演进：请求头策略最省事；对外开放 API 且文档按版本发布：媒体类型参数策略更符合 REST 语义；存量网关只认路径：用路径段策略兜底。
:::

## 极简实现

### 第一步：映射加 version 属性

`@RequestMapping` 及其组合注解（`@GetMapping` 等）新增 `version` 属性：

```java
@RestController
@RequestMapping("/api/users")
public class UserController {

    @GetMapping("/{id}")                              // 无版本：兼容未升级的存量客户端
    public UserResponse getV1(@PathVariable long id) {
        return new UserResponse(id, "v1-minimal-fields");
    }

    @GetMapping(value = "/{id}", version = "1.1")     // 仅当请求版本解析为 1.1 时命中
    public UserResponseV11 getV11(@PathVariable long id) {
        return new UserResponseV11(id, "v1.1", java.time.Instant.now());
    }
}

public record UserResponse(long id, String name) {}
public record UserResponseV11(long id, String name, java.time.Instant updatedAt) {}
```

`version` 值有三种写法，匹配规则是"**所有 ≤ 请求版本的映射中，最高且最接近者胜出**"：

| version 值 | 匹配行为 |
| --- | --- |
| （不写） | 匹配任意版本，但优先级最低——任何带版本的精确映射都会压过它 |
| `"1.1"` | 精确匹配 1.1 |
| `"1.2+"` | 基线匹配：1.2 及其以上受支持版本都命中（升级少量字段时少写重复方法） |

匹配算法：取所有 ≤ 请求版本的候选映射中的最高者；若最高候选实际不匹配（如严格版本不符）或请求版本超出受支持范围，抛 `NotAcceptableApiVersionException` 返回 400。以控制器含无版本、`1.1`、`1.2+`、`1.5` 四个映射为例：

| 请求携带版本 | 命中映射 | 原因 |
| --- | --- | --- |
| `1.1` | `version = "1.1"` | 精确匹配，压过无版本兜底 |
| `1.3` | `version = "1.2+"` | 基线映射覆盖 1.2 及以上；`1.5` 严格高于请求，不参与 |
| `1.5` | `version = "1.5"` | 精确映射优先于更宽的 `1.2+` |
| `1.6` | 400 错误 | 最高候选 `1.5` 不匹配，且 1.6 超出受支持范围 |

### 第二步：配置版本解析策略

以 `X-Version` 请求头解析、默认 `1.0.0` 为例——属性即可开箱：

::: code-group
```properties [application.properties]
spring.mvc.apiversion.default=1.0.0
spring.mvc.apiversion.use.header=X-Version
```
```yaml [application.yaml]
spring:
  mvc:
    apiversion:
      default: 1.0.0
      use:
        header: X-Version
```
:::

::: code-group
```xml [Maven]
<!-- 无额外依赖：Spring MVC 7 内置能力 -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webmvc</artifactId>
</dependency>
```
```groovy [Gradle]
implementation 'org.springframework.boot:spring-boot-starter-webmvc'
```
:::

### 客户端按版本调用

最直接的方式是手动携带版本头（与服务器解析策略对齐）：

```java
public UserResponseV11 getV11(long id) {
    return restClient.get()
            .uri("/api/users/{id}", id)
            .header("X-Version", "1.1")
            .retrieve()
            .body(UserResponseV11.class);
}
```

更推荐把版本收敛进客户端封装（见下方[深入：客户端携带版本](#深入：客户端携带版本)）。

## 关键注解与配置

### 四种解析策略对比

**四种策略（`spring.mvc.apiversion.use.*`，官方属性附录现行键）**：

| 策略 | 属性键 | 请求形态 | 优点 | 缺点 | 适用团队场景 |
| --- | --- | --- | --- | --- | --- |
| 请求头 | `use.header=X-Version` | `X-Version: 1.1` | 不改路径，缓存/网关零影响；实现最简单 | 浏览器地址栏带不了头，需契约化规范 | 内部系统、服务间调用为主 |
| 查询参数 | `use.query-parameter=api-version` | `?api-version=1.1` | URL 可直接粘贴调试、文档可点 | 版本混进业务参数；日志/缓存键易被干扰 | 面向浏览器端与联调环境 |
| 媒体类型参数 | `use.media-type-parameter.application/vnd.api+json=v` | `Content-Type: application/vnd.api+json; v=1.1` | 最贴合 REST 内容协商语义 | 客户端要精确管理请求头，出错常表现为协商失败 | 开放 API、文档按版本发布的平台 |
| 路径段 | `use.path-segment=1` | `/api/v1.1/users/42`（第 1 段为版本，索引从 0 计） | 网关/CDN/日志肉眼可见；与存量 `/v1/` 前缀兼容 | 侵入路径语义，路径规划要为版本让位 | 网关只认路径、存量前缀体系迁移 |

::: warning media-type-parameter 是"映射"不是"参数名"
属性键里的 `*` 是**媒体类型**，值才是参数名——即键里带媒体类型、值是参数名：`spring.mvc.apiversion.use.media-type-parameter.application/vnd.api+json=v` 表示从媒体类型 `application/vnd.api+json` 的 `v` 参数取版本。反过来把参数名写进键里（如 `...media-type-parameter.v=...`）只会解析不到版本。
:::

四种策略各取一种时的完整配置与请求样例（四段配置互斥，选一种即可）：

::: code-group
```properties [请求头策略]
spring.mvc.apiversion.default=1.0.0
spring.mvc.apiversion.use.header=X-Version

# 客户端发送：X-Version: 1.1
# curl -H "X-Version: 1.1" http://localhost:8080/api/users/42
```
```properties [查询参数策略]
spring.mvc.apiversion.default=1.0.0
spring.mvc.apiversion.use.query-parameter=api-version

# 客户端发送：URL 直接带参，浏览器可直接调试
# curl "http://localhost:8080/api/users/42?api-version=1.1"
```
```properties [媒体类型参数策略]
spring.mvc.apiversion.default=1.0.0
# 键 = 媒体类型，值 = 参数名（见上方 warning）
spring.mvc.apiversion.use.media-type-parameter.application/vnd.api+json=v

# 客户端发送：版本藏在 Content-Type 的参数里
# curl -H "Content-Type: application/vnd.api+json; v=1.1" \
#      -H "Accept: application/vnd.api+json; v=1.1" \
#      http://localhost:8080/api/users/42
```
```properties [路径段策略]
spring.mvc.apiversion.default=1.0.0
# 值 = 版本所在的路径段索引（从 0 计）：/api/v1.1/users/42 的第 1 段是 v1.1
spring.mvc.apiversion.use.path-segment=1

# 客户端发送：版本直接出现在路径里
# curl http://localhost:8080/api/v1.1/users/42
```
:::

::: tip 策略切换零代码成本
四种策略只改属性、不改任何 Java 代码——`version = "1.1"` 的映射写法对所有策略通用。选错策略时改一行配置即可切换，这正是"版本解析与映射解耦"的设计意图。
:::

**配套控制键**：

| 属性键 | 作用 | 推荐值 |
| --- | --- | --- |
| `spring.mvc.apiversion.default` | 未携带版本时的默认版本 | `1.0.0` 起步，随主流客户端升级 |
| `spring.mvc.apiversion.required` | 是否强制要求版本（缺版本直接报错） | 对外 API `true`，内部 `false` |
| `spring.mvc.apiversion.supported` | 受支持版本集合 | 与 `detect-supported` 二选一 |
| `spring.mvc.apiversion.detect-supported` | 从控制器映射自动探测支持版本 | 多版本共存时 `true` 最省心 |

### 深入：configureApiVersioning 编程式配置

属性只能配单一策略；**头 + 查询参数混用**（先头后参数按序尝试）这类多策略需求，或要把弃用处理器挂进配置时，用 `WebMvcConfigurer#configureApiVersioning(…)` 编程式声明：

```java
@Configuration(proxyBeanMethods = false)
public class ApiVersioningConfig implements WebMvcConfigurer {

    @Override
    public void configureApiVersioning(ApiVersionConfigurer config) {
        config
                // 多策略按序尝试：先取 X-Version 头，取不到再解析 ?api-version
                .useVersionResolver(
                        new HeaderApiVersionResolver("X-Version"),
                        new QueryApiVersionResolver("api-version"))
                .setDefaultVersion("1.0.0")            // 未携带版本时的兜底
                .setVersionRequired(true)              // 对外 API：缺版本直接 400
                // 版本格式契约：只接受 主.次 两段，挡住 1.1.3.4 之类的脏值
                .setSupportedVersionPredicate(
                        v -> v.toString().matches("\\d+\\.\\d+"));
    }
}
```

响应式栈对称：`WebFluxConfigurer` 同名方法 + `spring.webflux.apiversion.*` 属性前缀。

### 深入：自定义解析器与版本解析

内置解析器覆盖不了的场景（如自研网关注入的私有头、多套头名兼容），实现 `ApiVersionResolver` Bean 注入自动配置——只有一个方法 `resolveVersion(HttpServletRequest)`，返回版本字符串或 `null`（`null` 表示未携带版本，交给 `default` / `required` 处理）：

```java
@Bean
ApiVersionResolver gatewayVersionResolver() {
    // 先从网关注入的私有头取版本，缺失时回落到标准 X-Version
    return request -> {
        String v = request.getHeader("X-Gateway-Api-Version");
        return v != null ? v : request.getHeader("X-Version");
    };
}
```

版本字符串如何变成可比较的对象（`1.1` 与 `1.1.0` 是否相等）由 `ApiVersionParser` 决定，框架默认语义化版本解析。Resolver 管取版本，Parser 管版本解析，两个扩展点注册为 Bean 即可替换默认实现。WebFlux 侧在 `org.springframework.web.reactive.accept` 包提供对称接口，基于 `ServerWebExchange` 解析。

### 深入：版本弃用 ApiVersionDeprecationHandler

弃用不是删代码，是**先通知、再观察、后停用**。框架提供 `StandardApiVersionDeprecationHandler`：为指定版本声明弃用日期、迁移文档链接与停用（Sunset）日期，命中该版本的请求会带上弃用提示头（如 `Deprecation`、`Sunset`）：

```java
@Bean
StandardApiVersionDeprecationHandler apiVersionDeprecationHandler() {
    StandardApiVersionDeprecationHandler handler = new StandardApiVersionDeprecationHandler();
    handler.configureVersion("1.0")                // 声明弃用 1.0 版
           .setDeprecationDate(ZonedDateTime.now(ZoneOffset.UTC))
           .setDeprecationLink(URI.create("https://api.example.com/docs/migrate-1-1"))
           .setSunsetDate(ZonedDateTime.now(ZoneOffset.UTC).plusDays(90));  // 90 天后停用
    return handler;
}
```

注册为 Bean 即被注入 MVC 自动配置，也可在 `configureApiVersioning` 里用 `setDeprecationHandler(...)` 挂载。完整下线动作见[废弃项清理](/reference/cleanup)。

### 深入：客户端携带版本

手动 `.header(...)` 的版本会散落在每个调用点。企业封装把**插入器 + 默认版本**收敛到客户端构建处：`apiVersionInserter` 决定版本放哪里（必须与服务器解析策略对齐），`defaultApiVersion` 决定缺省值：

```java
@Bean
RestClient userRestClient(RestClient.Builder builder) {
    return builder
            .baseUrl("https://api.user.example")
            // 版本插入器：把版本放进指定请求头（对应服务器 use.header=X-Version）
            .apiVersionInserter(ApiVersionInserter.useHeader("X-Version"))
            .defaultApiVersion("1.0.0")            // 未显式指定时的默认版本
            .build();
}

public UserResponseV11 getV11(long id) {
    return userRestClient.get()
            .uri("/api/users/{id}", id)
            .apiVersion("1.1")                     // 本次请求显式用 1.1
            .retrieve()
            .body(UserResponseV11.class);
}
```

`ApiVersionInserter` 另有 `useQueryParam` / `useMediaTypeParam` / `usePathSegment` 工厂方法，与服务器四种策略一一对应；`WebClient.Builder` 有同名方法；`@HttpExchange` 组属性同样支持 API 版本配置。

::: warning 服务端配置不会自动同步到客户端
服务器的 API 版本配置**不会**自动装配进客户端——测试用客户端必须显式配置策略。
:::

### 深入：与网关/路径前缀版本的共存

框架版本控制解决"**一个应用内**的版本分流"，网关解决"**跨服务路由**"。两者共存的三种常见格局：

- **网关透明转发 + 头策略**（推荐）：网关只按服务路由，版本全部交给应用内的请求头解析——版本语义单点归框架管。
- **网关剥离前缀 + 重写头**：存量网关按 `/v1/users` 路由时，由网关把 `/v1` 重写为 `X-Version: 1` 头再转发，应用侧保持头策略。
- **应用侧路径段策略**：网关完全不动时，应用用 `use.path-segment` 直接从 `/api/v1.1/users` 解析版本——代价是控制器路径规划必须为版本段让位，且网关重写规则要与段索引对齐。

原则只有一条：**版本解析的真相源只有一个**。要么框架、要么网关，两边同时做版本判断迟早互相打架。

### 深入：版本升级迁移清单

每次发新版本走一遍这份清单，避免"加了映射就算升级"：

1. **版本格式先契约**：团队约定两段式 `主.次`（配合 `setSupportedVersionPredicate` 强校验），`1.1` 与 `1.1.0` 的相等性取决于解析器，别留给客户端猜。
2. **新映射以无版本或更高版本共存发布**：用 `version = "1.2+"` 基线匹配减少重复方法；`detect-supported` 或 `supported` 确认新版本已纳入。
3. **旧版本走弃用流程**：`StandardApiVersionDeprecationHandler` 声明弃用日期、迁移链接与 Sunset 日期。
4. **观察旧版本流量**：靠[可观测性](/advanced/observability)指标确认旧版本调用量归零。
5. **删除旧映射并回归**：删除后跑一遍 400 路径验证（旧版本请求应得到明确错误而非静默匹配）。
6. **客户端同步升级**：RestClient 封装里的 `defaultApiVersion` / `apiVersion` 调用点与服务器 `default` 一起评估切换。

## 避坑指南

- **版本字符串是精确匹配语义**：`1.1` 与 `1.1.0` 是否相等取决于解析器；团队先约定版本格式（建议 `主.次` 两段），不要混用。
- **`detect-supported` 与手工 `supported` 别同时配**：自动探测以控制器映射为准，手工集合以属性为准——同时写容易在重构 Controller 时漏改。
- **路径段策略的段索引从 0 计**（`/api/v1.1/users` 的版本在第 1 段），配错索引会把普通段当版本解析；网关重写规则要与段索引同步对齐，否则版本永远解析不到。
- **客户端不会自动继承服务端版本配置**：把 `ApiVersionInserter` + 默认版本封装进 [HTTP 客户端](/guide/http-clients)的统一构建处，散落硬编码迟早漂移。
- **`required` 与 `default` 的组合要想清楚**：对外 API 开 `required` 后，未带版本的请求直接报错——发布前确认存量调用方都已在传版本。
- **弃用要有缓冲期**：用 `ApiVersionDeprecationHandler` 先返回弃用提示头（如 `Deprecation` / `Sunset`），观察流量归零后再删除旧映射；直接删代码等于给客户端埋雷。
- **无版本映射是最低优先级**：它"匹配任意版本"但会被任何带版本的映射压过——别把新逻辑偷偷写进无版本方法，存量客户端会悄悄走到新逻辑上。
- **MVC 与 WebFlux 属性前缀别混用**：Servlet 栈用 `spring.mvc.apiversion.*`，响应式栈用 `spring.webflux.apiversion.*`。

### 延伸阅读

- 官方镜像：`spring-boot-4.1.1-docs/reference/web/servlet.md`（API Versioning 节）；响应式对称支持见 `reference/web/reactive.md`
- 官方镜像：`spring-boot-4.1.1-docs/reference/io/rest-client.md`（API Versioning 节——客户端侧配置与"服务端配置不自动生效"提示）
- 官方镜像：`spring-boot-4.1.1-docs/appendix/application-properties/index.md`——`spring.mvc.apiversion.*` / `spring.webflux.apiversion.*` / `spring.http.serviceclient.*` 属性全集
- 站内：[HTTP 客户端三件套](/guide/http-clients)（客户端封装与测试）｜ [REST API 开发全规范](/guide/rest-api)（错误响应格式）｜ [废弃项清理清单](/reference/cleanup)
- Spring Framework 7 版本映射详解：<https://docs.spring.io/spring-framework/reference/7.0/web/webmvc/mvc-controller/ann-requestmapping.html#mvc-ann-requestmapping-version>
