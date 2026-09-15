---
title: "HTTP 客户端三件套：RestClient 与声明式 @HttpExchange"
description: "RestClient 同步调用、全动词与错误处理分层、企业级统一封装、@HttpExchange 声明式客户端与分组配置、超时三层概念与切片测试。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/io/rest-client.html"
---

# HTTP 客户端三件套：RestClient 与声明式 @HttpExchange

> **本章你会学到**
>
> - 用 `RestClient` 完成 GET/POST/PUT/DELETE 全动词调用，解析 JSON 响应
> - 错误处理分层：默认异常 → `onStatus` 定向处理 → ProblemDetail 解析
> - 企业级统一封装：baseUrl、超时、日志拦截器、token 请求头一处配置
> - 用 `@HttpExchange` 接口 + 逻辑组（group）构建可测试的声明式客户端
> - 超时的三层概念（连接/读/全局兜底），以及每一层在哪配
>
> 上一章：[虚拟线程深度实践](/practice/virtual-threads) ｜ 下一章：[内置 API 版本控制](/guide/api-versioning)

## 业务场景

企业服务间调用三种典型诉求：

| 诉求 | 选型 | 一句话理由 |
| --- | --- | --- |
| 同步调一下外部 REST，要快写完 | **RestClient** | 函数式流式 API，官方明确推荐（非响应式栈首选） |
| 多个团队共用一套远端 API，要类型安全、可测试 | **@HttpExchange 接口客户端** | 接口即契约，实现由框架生成，Mock 成本极低 |
| 流式响应、背压、网关聚合 | **WebClient** | 响应式栈（WebFlux/Reactor）专属 |

::: tip 一句话记忆
非响应式项目：默认 RestClient；远端服务接口稳定、调用点多：升级到 @HttpExchange；只有引了 WebFlux/Reactor 才考虑 WebClient。
:::

## 极简实现

### RestClient：注入 Builder，三行核心调用

Spring Boot 自动提供预配置的 `RestClient.Builder` 原型 Bean（已装配消息转换器与请求工厂），注入后建实例：

```java
@Service
public class WeatherService {

    private final RestClient restClient;

    public WeatherService(RestClient.Builder builder) {
        this.restClient = builder
                .baseUrl("https://api.weather.example")
                .build();
    }

    public Forecast forecast(String city) {
        return restClient.get()
                .uri("/v1/forecast/{city}", city)
                .retrieve()
                .body(Forecast.class);
    }
}
```

`Forecast` 直接用 record 接收 JSON 反序列化结果：

```java
public record Forecast(String city, int highCelsius, int lowCelsius) {}
```

### POST / PUT / DELETE：全动词与带体请求

写操作的套路一致：`contentType` 声明请求体格式，`body()` 携带对象（自动序列化）；DELETE 通常无响应体，用 `toBodilessEntity()` 收尾：

```java
// 新建：POST + JSON 体，期望 201
public Forecast create(ForecastCreateRequest req) {
    return restClient.post()
            .uri("/v1/forecasts")
            .contentType(MediaType.APPLICATION_JSON)
            .body(req)                          // 对象自动序列化为 JSON
            .retrieve()
            .body(Forecast.class);
}

// 更新：PUT，只关心状态码
public void update(long id, ForecastUpdateRequest req) {
    restClient.put()
            .uri("/v1/forecasts/{id}", id)
            .contentType(MediaType.APPLICATION_JSON)
            .body(req)
            .retrieve()
            .toBodilessEntity();                // 无响应体，仅校验状态
}

// 删除：DELETE
public void delete(long id) {
    restClient.delete()
            .uri("/v1/forecasts/{id}", id)
            .retrieve()
            .toBodilessEntity();
}
```

::: warning body() 的位置语义
`body()` 在请求侧是"发送请求体"，在 `retrieve()` 之后是"读取响应体"——链式调用时注意光标位置，放错一步类型就对不上。
:::

需要绕开 `retrieve()` 的约定（自己读状态码、流式处理响应体）时，用 `exchange((request, response) -> …)` 拿到原始的请求/响应做底层控制——一般用不到，用到再说。

### @HttpExchange：接口即客户端

定义服务契约（方法级注解 `@GetExchange` / `@PostExchange` / `@DeleteExchange` 等）：

```java
import org.springframework.web.service.annotation.GetExchange;
import org.springframework.web.service.annotation.HttpExchange;

@HttpExchange(url = "https://api.user.example")
public interface UserApi {

    @GetExchange("/users/{id}")
    UserResponse get(long id);

    @GetExchange("/users")
    java.util.List<UserResponse> list(@RequestParam int page);
}

public record UserResponse(long id, String name, String email) {}
```

在应用类上按包扫描导入，并用逻辑组名代替硬编码 URL（生产环境推荐去掉 `@HttpExchange` 里的硬编码地址）：

```java
@SpringBootApplication
@ImportHttpServices(group = "user", basePackages = "com.example.myclients")
public class MyApplication {
    public static void main(String[] args) {
        SpringApplication.run(MyApplication.class, args);
    }
}
```

组名 `user` 通过属性绑定真实地址（不指定 group 时归入 `default` 组）：

```yaml
spring:
  http:
    serviceclient:
      user:
        base-url: "https://api.user.example"
```

注入接口即用——框架在启动时生成实现并注册为 Bean：

```java
@RestController
@RequestMapping("/users")
public class UserController {

    private final UserApi userApi;

    public UserController(UserApi userApi) {
        this.userApi = userApi;
    }

    @GetMapping("/{id}")
    public UserResponse get(@PathVariable long id) {
        return userApi.get(id);
    }
}
```

::: code-group
```xml [Maven]
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webmvc</artifactId>
</dependency>
```
```groovy [Gradle]
implementation 'org.springframework.boot:spring-boot-starter-webmvc'
```
:::

@HttpExchange 能力由 `spring-boot-starter-webmvc` 自带（Spring Framework 7 的 `spring-web` 模块提供注解），无需额外依赖。

同一包里的接口要进不同组时，`@ImportHttpServices` 可重复并用 `types` 逐类指定：

```java
@SpringBootApplication
@ImportHttpServices(group = "user", types = UserApi.class)
@ImportHttpServices(group = "order", types = OrderApi.class)
public class MyApplication { /* … */ }
```

### @RestClientTest：客户端切片测试

用 `@RestClientTest` 只装配被测客户端与 Mock 服务器，不启动完整应用。`MockRestServiceServer` 按 URL 与响应内容模拟远端：

```java
@RestClientTest(WeatherService.class)               // 只装配被测 Bean
class WeatherServiceTests {

    @Autowired
    private WeatherService service;

    @Autowired
    private MockRestServiceServer server;           // 拦截真实 HTTP 出口

    @Test
    void returnsForecast() {
        server.expect(requestTo("https://api.weather.example/v1/forecast/nj"))
              .andRespond(withSuccess("""
                      {"city":"nj","highCelsius":30,"lowCelsius":22}
                      """, MediaType.APPLICATION_JSON));

        Forecast forecast = service.forecast("nj");
        assertThat(forecast.highCelsius()).isEqualTo(30);
    }
}
```

::: tip 期待完整 URL
被测类通过 `RestClient.Builder` 构建客户端时，`requestTo(...)` 必须写完整 URL（baseUrl 已拼上）；这是切片测试最常见的断言失败原因。
:::

## 关键注解与配置

| 注解 / 属性 | 作用 | 要点 |
| --- | --- | --- |
| `RestClient.Builder` | 预配置构建器 | 注入使用，别自己 `RestClient.create()`（丢掉自动装配的转换器） |
| `@HttpExchange(url=…)` | 类级根路径 | 生产环境不要硬编码 URL，改用 group + 属性 |
| `@GetExchange` / `@PostExchange` / `@PutExchange` / `@DeleteExchange` | 方法级 HTTP 动作 | 方法参数支持 `@PathVariable` / `@RequestParam` / `@RequestBody` |
| `@ImportHttpServices(group=…, basePackages=…)` | 注册接口客户端 | 可重复注解；`types` 属性可逐类导入 |
| `spring.http.serviceclient.<group>.base-url` | 组地址绑定 | 组还可挂默认头、API 版本、重定向、连接/读超时、SSL bundle |
| `.retrieve().onStatus(…)` | 状态码处理 | 4xx/5xx 转异常或兜底响应 |

### 深入：企业级统一封装

真实项目里 token、日志、超时都应集中在构建处，而不是散在每个调用方法里。`requestInitializer` 负责统一加头（轻量、无包装逻辑），`requestInterceptor` 负责需要读取响应/做包装的横切逻辑（如日志）：

```java
@Configuration(proxyBeanMethods = false)
public class RestClientConfig {

    @Bean
    RestClient weatherRestClient(RestClient.Builder builder) {
        return builder
                .baseUrl("https://api.weather.example")
                // 每个请求统一携带令牌（初始化阶段直接改请求头，最轻量）
                .requestInitializer(request ->
                        request.getHeaders().setBearerAuth(tokenProvider.currentToken()))
                // 日志拦截器：出入耗时与状态码（需要读响应体时用 interceptor）
                .requestInterceptor((request, body, execution) -> {
                    long start = System.currentTimeMillis();
                    var response = execution.execute(request, body);
                    log.info("{} {} -> {} ({} ms)",
                            request.getMethod(), request.getURI(),
                            response.getStatusCode().value(),
                            System.currentTimeMillis() - start);
                    return response;
                })
                // 连接超时 2s：单独换请求工厂（JDK HttpClient 场景）
                .requestFactory(new JdkClientHttpRequestFactory(
                        HttpClient.newBuilder()
                                .connectTimeout(Duration.ofSeconds(2))
                                .build()))
                .build();
    }
}
```

::: tip 作用域从窄到宽
定制分三档：注入 Builder 局部改（最窄）→ 声明 `RestClientCustomizer` Bean 全局追加 → `RestClient.create()` 完全裸奔（无任何自动装配，别用）。全局定制还能改 HTTP 客户端工厂选择（`spring.http.clients.imperative.factory`）。
:::

### 深入：错误处理分层

**第一层（默认）**：4xx/5xx 自动抛 `RestClientResponseException` 子类（按状态码区分），不处理就会向上冒泡——这是安全的默认。

**第二层（定向处理）**：`onStatus` 按状态码把响应转成业务异常，并把错误体解析成 ProblemDetail（与 [REST API 章](/guide/rest-api)的服务端错误格式对齐）：

```java
public Forecast forecast(String city) {
    return restClient.get()
            .uri("/v1/forecast/{city}", city)
            .retrieve()
            .onStatus(status -> status.value() == 404,
                      (request, response) -> {
                          // 把远端 ProblemDetail 错误体翻译成本地异常
                          ProblemDetail pd = ProblemDetail.forStatusAndDetail(
                                  HttpStatus.NOT_FOUND, "城市不存在: " + city);
                          throw new CityNotFoundException(pd);
                      })
            .body(Forecast.class);
}
```

**第三层（客户端级兜底）**：Builder 上的 `defaultStatusHandler` 为该客户端所有请求设定统一的 4xx/5xx 处理，方法级 `onStatus` 仍可覆盖它——分层的意义就在这里。

### 深入：超时的三层概念

超时有三个不同层面，配错位置等于没配：

| 层 | 含义 | 配置位置 |
| --- | --- | --- |
| 连接超时 | TCP 连接建立的最长等待 | `spring.http.clients.connect-timeout`（全局）或 `serviceclient.<group>.connect-timeout`（组）；手工构建时用 `HttpClientSettings.withConnectTimeout(...)` |
| 读超时 | 响应到达的最长等待 | `spring.http.clients.read-timeout`（全局）或 `serviceclient.<group>.read-timeout`（组）；手工构建用 `HttpClientSettings.withReadTimeout(...)` |
| 请求总预算 | 一次调用端到端的兜底上限 | Boot 不提供该属性；用调用方线程池/超时注解或响应式 `timeout` 自行约束 |

```yaml
# 全局兜底 + 组内覆盖：所有客户端 1s 连接，echo 组单独收紧为 2s 读
spring:
  http:
    clients:
      connect-timeout: 1s          # 全局连接超时
      read-timeout: 2s             # 全局读超时
    serviceclient:
      echo:
        base-url: "https://echo.example"
        connect-timeout: 1s        # 组级覆盖：连接
        read-timeout: 2s           # 组级覆盖：读
```

`@HttpExchange` 组同样支持 SSL bundle（`serviceclient.<group>.ssl-bundle`），配合 [SSL 配置](/advanced/security) 使用。失败重试 Boot 不默认集成——需要幂等重试时引入 Spring Retry 自行包装，别在客户端里裸循环。

## 避坑指南

- **不要 new RestTemplate / 直接 new RestClient**：绕过 Builder 会丢失 Boot 预装配的消息转换器（Jackson 3）与请求工厂；观测、指标也挂不上。
- **远端 5xx 默认会抛异常**：`RestClientResponseException` 子类按状态码区分；需要降级就在 `onStatus` 里显式处理，不要 try-catch 一刀切吞掉。
- **@HttpExchange 的 URL 硬编码只适合 demo**：生产一律走 group 属性绑定，多环境切换（见[配置管理与多环境](/guide/configuration)）才有意义。
- **连接/读超时必须显式配**：默认值偏宽甚至无界，不配超时的客户端在远端故障时会把调用方线程拖死；虚拟线程也一样会全部挂起。全局与组级属性优先，仅在需要更细控制时才手工换请求工厂。
- **接口方法参数注解别省**：`@RequestParam`、`@PathVariable` 不写，参数名编译后丢失（未开 `-parameters`）会绑定失败；starter-parent 已默认开 `-parameters`，但 Gradle 手写任务时要确认。
- **切片测试断言要写完整 URL**：`RestClient.Builder` 构建的客户端，`MockRestServiceServer` 期望的是 baseUrl 拼接后的完整地址，漏拼会导致 expect 不命中、真实请求外发。
- **响应式客户端误用**：WebClient 放在 Servlet 栈里跑只会徒增复杂度；同步调用请回 RestClient。

### 延伸阅读

- 官方镜像：`spring-boot-4.1.1-docs/reference/io/rest-client.md`——RestClient 定制/SSL、HTTP Service Interface Clients、Importing HTTP Services、Service Client Groups、全局配置与 SSRF 过滤
- 官方镜像：`spring-boot-4.1.1-docs/reference/testing/spring-boot-applications.md`——`@RestClientTest` 切片与 `MockRestServiceServer` 完整规则
- 官方镜像：`spring-boot-4.1.1-docs/appendix/application-properties/index.md`——`spring.http.clients.*` / `spring.http.serviceclient.*` 属性全集
- 站内：[内置 API 版本控制](/guide/api-versioning)（客户端携带版本）｜ [可观测性与 Actuator](/advanced/observability)（客户端指标）｜ [测试策略与 Testcontainers](/advanced/testing)
- 重试：Spring Retry 官方文档 <https://spring.io/projects/spring-retry>（Boot 不默认集成，需自行引入）
