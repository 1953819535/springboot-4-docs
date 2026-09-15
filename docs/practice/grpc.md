---
title: "gRPC 服务与客户端"
description: "Spring Boot 4.1.1 gRPC 实战：proto 定义与 protobuf-maven-plugin 代码生成、一元调用完整闭环、四种通信模式边界、Status 码与业务异常映射、拦截器与 Spring Security 鉴权、deadline 超时传递、与 REST 共存的端口策略、in-process 测试、proto 演进纪律。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/io/grpc.html"
---

> **本章你会学到**
> - 从一个 `.proto` 文件出发，用 `protobuf-maven-plugin` 生成 Java 代码，写出第一个可被 `grpcurl` 调通的一元（Unary）服务
> - 服务端 `@GrpcService` 暴露 `BindableService`、客户端 `@ImportGrpcClients` 注入 stub 的完整闭环
> - 四种通信模式的边界：一元调用讲全，流式模式讲清楚什么时候以官方 gRPC 文档为准
> - gRPC Status 码与业务异常的映射，服务端 `onError` 与客户端捕获 `StatusRuntimeException`
> - 拦截器与鉴权：`@PreAuthorize`、`GrpcRequest` 请求匹配器、客户端 `GrpcChannelBuilderCustomizer`
> - deadline/超时传递建议、与 REST 共存的端口策略（独立端口 vs Servlet 同端口）
> - in-process 测试传输、proto 演进纪律（字段编号永不复用）

> **上一章**：[内置 API 版本控制](/guide/api-versioning) · **下一章**：[消息：Kafka、AMQP 与 JMS](/practice/messaging)>

## 业务场景

内部微服务调用链越拉越长：订单服务每秒调用库存服务上万次，JSON 序列化开销、REST 接口契约松散、跨语言团队反复对字段类型——三件事都在烧钱。gRPC 用 Protocol Buffers 二进制编码 + 强类型契约解决这三件事，Spring Boot 4.1.1 为服务端与客户端分别提供了 `spring-boot-starter-grpc-server` 与 `spring-boot-starter-grpc-client`，默认 Netty 传输，开箱即用。

| 需求 | 方案 | 说明 |
| --- | --- | --- |
| 服务端暴露 gRPC 接口 | `spring-boot-starter-grpc-server` | 默认 Netty，监听 9090 |
| 客户端调用远端服务 | `spring-boot-starter-grpc-client` | stub 作为 [Bean](/glossary#bean) 注入 |
| 契约先行 | `.proto` 文件 + 代码生成 | Maven/Gradle 插件均受支持 |
| 内部高频、低延迟 | gRPC（二进制 + HTTP/2） | 比 JSON 文本更小更快 |

## 极简实现：一元调用完整闭环

一元（Unary）调用是 gRPC 的"普通方法调用"：客户端发一个请求，服务端回一个响应。先把这条链路走通。

### 第一步：定义 `.proto` 契约

`.proto` 文件定义服务与消息，放在 `src/main/proto` 下：

```protobuf
syntax = "proto3";

option java_package = "com.example.grpc.proto";
option java_multiple_files = true;

service HelloWorld {
    rpc SayHello (HelloRequest) returns (HelloReply) {}
}

message HelloRequest {
    string name = 1;      // 字段编号是线上格式的唯一标识，见后文"演进纪律"
}

message HelloReply {
    string message = 1;
}
```

除了 `java_package` 与 `java_multiple_files` 两个选项，这份文件与 Java 无关——Go、Python 团队拿同一份文件即可生成各自代码。

### 第二步：配置代码生成（Maven）

Spring Boot 为 `io.github.ascopes:protobuf-maven-plugin` 提供了依赖管理；继承 `spring-boot-starter-parent` 时，`protoc` 版本、`binary-maven` 插件与 `generate` 目标都已配好：

```xml
<build>
    <plugins>
        <plugin>
            <groupId>io.github.ascopes</groupId>
            <artifactId>protobuf-maven-plugin</artifactId>
        </plugin>
        <plugin>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-maven-plugin</artifactId>
        </plugin>
    </plugins>
</build>
```

> 💡 **提示**：Gradle 用户用 `com.google.protobuf` 插件（Boot 管理版本并[自动配置](/glossary#自动配置auto-configuration) `protoc` 与 `protoc-gen-grpc-java`），`.proto` 同样放 `src/main/proto`。

### 第三步：实现服务端

引入 `spring-boot-starter-grpc-server`，继承生成基类并加 `@GrpcService`。Spring gRPC 会把任何实现了 `BindableService` 的 [Bean](/glossary#bean) 自动暴露为 gRPC 服务——生成的基类都实现了它，注册为 Bean 就够了：

```java
import io.grpc.stub.StreamObserver;
import org.springframework.grpc.server.service.GrpcService;

@GrpcService
public class MyHelloWorldService extends HelloWorldGrpc.HelloWorldImplBase {

    @Override
    public void sayHello(HelloRequest request, StreamObserver<HelloReply> responseObserver) {
        // 1. 组装响应消息（builder 模式）
        String message = "Hello '%s'".formatted(request.getName());
        HelloReply reply = HelloReply.newBuilder().setMessage(message).build();
        // 2. 回写响应
        responseObserver.onNext(reply);
        // 3. 声明本次调用结束
        responseObserver.onCompleted();
    }
}
```

使用 `spring-boot-starter-grpc-server` 时，Netty 作为服务端实现，监听 **9090** 端口。用 `grpcurl` 即可验证：

```bash
grpcurl -d '{"name":"Spring"}' -plaintext localhost:9090 HelloWorld.SayHello

{
  "message": "Hello 'Spring'"
}
```

::: tip Windows PowerShell 下调 grpcurl
JSON 体里的双引号需要转义，推荐把报文放进文件再引用，避开引号地狱：`grpcurl -d @request.json -plaintext localhost:9090 HelloWorld.SayHello`（`@文件名` 语法从文件读 payload，跨平台行为一致）。
:::

### 第四步：客户端注入 stub

客户端引入 `spring-boot-starter-grpc-client`，用 `@ImportGrpcClients` 导入要用的 stub。`target` 建议写**逻辑通道名**而非硬编码地址：

```java
@SpringBootApplication(proxyBeanMethods = false)
@ImportGrpcClients(target = "hello", types = HelloWorldGrpc.HelloWorldBlockingStub.class)
public class MyApplication {
    public static void main(String[] args) {
        SpringApplication.run(MyApplication.class, args);
    }
}
```

逻辑名对应的真实地址通过通道属性提供，顺带把保活超时、入站消息上限一起调了：

```properties
spring.grpc.client.channel.hello.target=static://grpc.example.com:9090
spring.grpc.client.channel.hello.inbound.keepalive.timeout=40s
spring.grpc.client.channel.hello.inbound.message.max-size=8MB
```

stub 与普通 [Bean](/glossary#bean) 一样注入使用（`BlockingStub` 的方法调用是同步阻塞的）：

```java
@Component
class MyApplicationRunner implements ApplicationRunner {

    private final HelloWorldBlockingStub helloStub;

    MyApplicationRunner(HelloWorldGrpc.HelloWorldBlockingStub helloStub) {
        this.helloStub = helloStub;
    }

    @Override
    public void run(ApplicationArguments args) {
        HelloRequest request = HelloRequest.newBuilder().setName("Spring").build();
        HelloReply reply = this.helloStub.sayHello(request);
        System.out.println(reply.getMessage());
    }
}
```

> 💡 **提示**：`@ImportGrpcClients` 不指定 `target` 时默认为 `"default"`；`basePackageClasses`/`basePackages` 属性可一次导入整个包下的所有 stub。

### 企业形态：按调用场景分层封装

不要让业务代码直接操作 stub——在外面包一层门面，集中处理错误映射、超时与降级：

```java
@Service
public class InventoryClient {

    private final HelloWorldBlockingStub stub;

    InventoryClient(HelloWorldGrpc.HelloWorldBlockingStub stub) {
        this.stub = stub;
    }

    public StockInfo getStock(String sku) {
        try {
            // 每次调用设置 deadline：超时由 gRPC 统一以 DEADLINE_EXCEEDED 报错
            return toInfo(stub
                    .withDeadlineAfter(500, TimeUnit.MILLISECONDS)
                    .sayHello(HelloRequest.newBuilder().setName(sku).build()));
        } catch (StatusRuntimeException e) {
            // 集中把 gRPC 状态翻译成业务语义（见下文状态码映射）
            throw new InventoryUnavailableException(sku, e.getStatus().getCode(), e);
        }
    }
}
```

### 深入：四种通信模式

gRPC 一共有四种模式，取决于请求与响应是否是"流"（多条消息）：

| 模式 | proto 签名形态 | 适用场景 |
| --- | --- | --- |
| 一元 Unary | `rpc A (Req) returns (Resp)` | 普通请求/响应 |
| 服务端流 Server streaming | `rpc A (Req) returns (stream Resp)` | 下发列表、订阅推送 |
| 客户端流 Client streaming | `rpc A (stream Req) returns (Resp)` | 分块上传、批量聚合 |
| 双向流 Bidirectional | `rpc A (stream Req) returns (stream Resp)` | 聊天、实时同步 |

一元调用在上一节已讲全。流式模式在生成的 stub 上形态不同（例如服务端流在 blocking stub 上返回迭代器、双向流只有异步形态），且需要处理 `StreamObserver` 的 `onNext`/`onError`/`onCompleted` 回调时序，写法与一元调用差异较大。**本文语料未覆盖流式实现细节，请以官方 gRPC 文档为准**，不要按一元调用硬套：

- [gRPC 基础教程（含四种模式）](https://grpc.io/docs/what-is-grpc/core-concepts/)
- [gRPC Java 示例](https://github.com/grpc/grpc-java/tree/master/examples)

> ⚠️ **注意**：流式接口天然是有状态长连接，注意服务端内存中活跃流的上限与取消传播（客户端断开后应尽快释放服务端资源）。


**一元模式完整实现**（覆盖 90% 的真实场景，从 proto 到客户端三步走）：

```protobuf
// src/main/proto/user.proto
syntax = "proto3";

package user.v1;

option java_multiple_files = true;
option java_package = "com.example.grpc.user.v1";

message GetUserRequest {
  int64 id = 1;
}

message UserReply {
  int64 id = 1;
  string name = 2;
  string email = 3;
}

service UserGrpc {
  rpc GetUser (GetUserRequest) returns (UserReply);   // 一元：一进一出
}
```java
// 服务端：继承生成基类，@GrpcService 即注册进服务器
@GrpcService
public class UserGrpcService extends UserGrpcGrpc.UserGrpcImplBase {

    @Override
    public void getUser(GetUserRequest request,
                        StreamObserver<UserReply> responseObserver) {
        var reply = UserReply.newBuilder()
                .setId(request.getId())
                .setName("alice")
                .setEmail("alice@example.com")
                .build();
        responseObserver.onNext(reply);    // 返回响应
        responseObserver.onCompleted();    // 必须调用，否则客户端一直等
    }
}
```java
// 客户端：注入生成的 blocking stub，deadline 必设
@Service
public class UserGrpcClient {

    private final UserGrpcGrpc.UserGrpcBlockingStub blockingStub;

    public UserGrpcClient(UserGrpcGrpc.UserGrpcBlockingStub blockingStub) {
        this.blockingStub = blockingStub;
    }

    public UserReply getUser(long id) {
        return blockingStub
                .withDeadlineAfter(2, java.util.concurrent.TimeUnit.SECONDS)
                .getUser(GetUserRequest.newBuilder().setId(id).build());
    }
}


**流式三模式**的 proto 签名速览（流式 API 细节以官方 Spring gRPC 文档为准）：

```protobuf
// 服务端流：一个请求，服务端多次 onNext 推送
rpc ListUsers (ListRequest) returns (stream UserReply);
// 客户端流：客户端多次 onNext 上传，服务端返回一个汇总
rpc UploadLogs (stream LogEntry) returns (UploadSummary);
// 双向流：两边都是 StreamObserver，全双工
rpc Chat (stream ChatMessage) returns (stream ChatMessage);


::: tip 流式实现的心智模型
流式方法里的 `StreamObserver` 就是"回复通道"：一元模式 onNext 一次 + onCompleted；服务端流 onNext 多次 + onCompleted；客户端流的入参变成接收侧 Observer。所有模式结束时必须调 `onCompleted()`（或 `onError()`），否则调用方悬挂。
:::


### 深入：错误处理——Status 码与业务异常映射

gRPC 不传 HTTP 状态码，也不建议在 payload 里自定义错误字段；正路是 **Status 码 + 描述信息**。常用状态码与业务语义的映射建议：

| Status 码 | 业务语义 | 典型场景 |
| --- | --- | --- |
| `INVALID_ARGUMENT` | 参数不合法 | 校验失败 |
| `NOT_FOUND` | 资源不存在 | 订单号查不到 |
| `ALREADY_EXISTS` | 资源已存在 | 重复创建 |
| `PERMISSION_DENIED` / `UNAUTHENTICATED` | 无权/未认证 | 鉴权失败 |
| `RESOURCE_EXHAUSTED` | 配额/限流 | 超过速率限制 |
| `FAILED_PRECONDITION` | 前置条件不满足 | 账户未初始化 |
| `UNAVAILABLE` | 暂不可用，可重试 | 依赖超载 |
| `INTERNAL` / `UNKNOWN` | 服务端内部错误 | 兜底 |
| `DEADLINE_EXCEEDED` | 超时 | deadline 到期 |
| `CANCELLED` | 调用被取消 | 客户端断开 |

**服务端**：业务失败时通过 `onError` 返回带状态的异常，正常路径依旧 `onNext` + `onCompleted`：

```java
@Override
public void getOrder(GetOrderRequest request, StreamObserver<OrderReply> responseObserver) {
    Order order = orderRepository.findById(request.getOrderId()).orElse(null);
    if (order == null) {
        // 映射：查不到 → NOT_FOUND，附带可读描述
        responseObserver.onError(
                Status.NOT_FOUND.withDescription("order " + request.getOrderId() + " not found")
                        .asRuntimeException());
        return;   // onError 之后不要再 onNext/onCompleted
    }
    responseObserver.onNext(toReply(order));
    responseObserver.onCompleted();
}
```

**客户端**：`BlockingStub` 的错误以 `StatusRuntimeException` 抛出，取 `Status` 判断分支：

```java
import io.grpc.Status;
import io.grpc.StatusRuntimeException;

try {
    OrderReply reply = stub.getOrder(GetOrderRequest.newBuilder().setOrderId(id).build());
} catch (StatusRuntimeException e) {
    Status.Code code = e.getStatus().getCode();
    switch (code) {
        case NOT_FOUND -> throw new OrderNotFoundException(id, e);       // 语义化业务异常
        case DEADLINE_EXCEEDED -> fallbackCache(id);                    // 超时走降级
        case UNAVAILABLE -> scheduleRetry(id);                          // 可重试错误
        default -> throw new IllegalStateException("gRPC call failed: " + code, e);
    }
}
```

> ⚠️ **注意**：`UNAVAILABLE` 可安全重试（未执行或幂等），`INTERNAL`/`UNKNOWN` 不建议盲目重试——请求可能已经执行过一次。

### 深入：拦截器与鉴权

**服务端 + Spring Security**：Spring gRPC 提供与 Web 应用同风格的声明式安全。Spring Boot [自动配置](/glossary#自动配置auto-configuration)了 `GrpcSecurity` 与 `SecurityGrpcExceptionHandler`，最常用做法是在 gRPC 服务 [Bean](/glossary#bean) 上直接加 `@PreAuthorize`，或定义 `AuthenticationProcessInterceptor` Bean。详见 [Spring gRPC 文档：声明式安全](https://docs.spring.io/spring-grpc/reference/1.1/server.html#_declarative_security_with_spring_security)。

**Servlet 容器模式**：gRPC 服务跑在标准 Servlet 容器里时，用常规 Web 安全配置即可，Boot 还提供了 gRPC 请求匹配器：

```java
@Configuration(proxyBeanMethods = false)
public class MySecurityConfiguration {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        // 匹配所有 gRPC 服务，但排除名为 "special" 的服务
        http.securityMatcher(GrpcRequest.toAnyService().excluding("special"));
        http.authorizeHttpRequests(requests -> requests.anyRequest().hasRole("GRPC_ADMIN"));
        http.httpBasic(withDefaults());
        return http.build();
    }
}
```

CSRF 保护与 gRPC 协议不兼容，对 gRPC 请求默认关闭（`spring.grpc.server.security.csrf.enabled` 可改）。

**客户端**：通过 `GrpcChannelBuilderCustomizer` 给通道挂拦截器，例如挂载基础认证头（`matching` 方法按正则限定目标）：

```java
@Configuration(proxyBeanMethods = false)
public class MyGrpcConfiguration {

    @Bean
    GrpcChannelBuilderCustomizer<?> helloChannelCustomizer() {
        // 只对逻辑名匹配 "hello" 的通道生效
        return GrpcChannelBuilderCustomizer.matching("hello",
                builder -> builder.intercept(new BasicAuthenticationInterceptor("user", "password")));
    }
}
```

OAuth2 资源服务器支持与 gRPC 兼容，按常规方式配置即可（见 Spring Security 的 OAuth2 章节）。

### 深入：deadline 与超时传递

分布式链路上，"不设超时"等于"允许一个慢服务拖死全链路"。gRPC 的答案是一元化的 **deadline**：

1. **入口设总预算**：最外层调用设置 `withDeadlineAfter`，例如网关给整链 2s。
2. **deadline 自动传播**：下游调用若不显式设置，会继承上游剩余时间——整个链路共享同一个截止点，不会层层放大。
3. **各层只减不增**：内层调用应设更小的预算（如 1s、500ms），给响应序列化与网络回程留余量。
4. **服务端配合**：长任务可检查上下文取消状态（如 `Context.current().isCancelled()`，属 gRPC 核心 API，用法以 [官方 Context 文档](https://grpc.io/docs/guides/cancellation/) 为准），提前放弃无谓计算。
5. **超时码要区分**：`DEADLINE_EXCEEDED` 说明"太慢"，`UNAVAILABLE` 说明"没连上/暂不可用"，监控与重试策略应当分开对待。

### 深入：与 REST 共存的端口策略

同一个应用常常既要对外提供 REST，又要对内提供 gRPC。两种策略：

| 策略 | 做法 | 适用 |
| --- | --- | --- |
| **独立端口（默认）** | Netty 起 gRPC（9090），Web 服务器起 REST（8080），互不干扰 | 内网微服务间调用，最简单 |
| **同端口（Servlet 模式）** | 排除 `grpc-netty`，加入 `grpc-servlet-jakarta`，gRPC 随 Servlet 容器在 `server.port` 上暴露 | 需要复用统一入口/端口、过网关的场景 |

Servlet 模式的关键配置（必须支持 HTTP/2）：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-webmvc</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-grpc-server</artifactId>
    <exclusions>
        <exclusion>          <!-- 排除 gRPC Netty -->
            <groupId>io.grpc</groupId>
            <artifactId>grpc-netty</artifactId>
        </exclusion>
    </exclusions>
</dependency>
<!-- 改用 Servlet Jakarta 实现 -->
<dependency>
    <groupId>io.grpc</groupId>
    <artifactId>grpc-servlet-jakarta</artifactId>
</dependency>
```

```properties
server.http2.enabled=true
```

> ⚠️ **注意**：Servlet 模式下 `spring.grpc.server.port` 被忽略，端口由 `server.port` 决定；部分 gRPC 服务器配置属性不再生效。Netty 版本与其他库冲突时，可换成 `io.grpc:grpc-netty-shaded`（客户端同理）。

**SSL**：服务端用 SSL bundle 一行挂载（`spring.grpc.server.ssl.bundle=mysslbundle`），可配 `ssl.client-auth=optional|require` 启用双向认证；客户端单向 TLS 设 `ssl.enabled=true`，mTLS 设 `ssl.bundle`。临时关闭便于测试用 `spring.grpc.server.ssl.enabled=false`。

### 深入：proto 演进纪律

`.proto` 是跨团队契约，演进纪律比代码更严格：

1. **字段编号永不复用**：线上消息里每个编号都可能是别人缓存的旧数据。删除字段时必须 `reserved` 占住编号与名字，防止后人误用：

```protobuf
message OrderEvent {
    reserved 4, 8;            // 这两个编号已废弃，永不复用
    reserved "couponId", "oldStatus";

    int64 order_id = 1;
    string status = 2;
}
```

2. **只加不改**：新增字段用新编号；绝不能改已有字段的编号与类型。
3. **编号分配写进评审**：同一条消息的编号由契约 owner 统一分配，避免两人在不同分支各占一个编号——合并后就是线上事故。
4. **消息上限有默认**：服务端入站消息默认上限 4MB（`spring.grpc.server.inbound.message.max-size`），大文件传输应走对象存储再传引用，而不是调大 gRPC 限制。

### 测试：in-process 传输

引入 `spring-boot-starter-grpc-client-test` / `spring-boot-starter-grpc-server-test`，测试类加 `@AutoConfigureTestGrpcTransport` 注解，即可用进程内测试通道跑全上下文测试：

```java
@SpringBootTest
@AutoConfigureTestGrpcTransport
@ImportGrpcClients(types = HelloWorldGrpc.HelloWorldBlockingStub.class)
class MyGrpcTests {

    @Autowired
    private HelloWorldGrpc.HelloWorldBlockingStub helloStub;

    @Test
    void sayHello() {
        HelloRequest request = HelloRequest.newBuilder().setName("Spring").build();
        HelloReply reply = this.helloStub.sayHello(request);
        assertThat(reply.getMessage()).isEqualTo("Hello 'Spring'");
    }
}
```

要打真实网络栈时，用 `spring.grpc.server.port=0` 起随机端口，`@LocalGrpcServerPort` 注入实际端口。

## 配置速查

| 键 | 说明 | 默认值 |
| --- | --- | --- |
| `spring.grpc.server.port` | gRPC 服务端口，`0` 为动态端口 | 9090 |
| `spring.grpc.server.inbound.message.max-size` | 服务端入站消息上限 | 4MB |
| `spring.grpc.server.ssl.bundle` | 服务端 SSL bundle | — |
| `spring.grpc.server.ssl.client-auth` | 客户端认证模式 | `none` |
| `spring.grpc.server.reflection.enabled` | 反射服务（需 `io.grpc:grpc-services`） | `true` |
| `spring.grpc.server.health.enabled` | 标准 gRPC 健康服务桥接 | `true` |
| `spring.grpc.server.security.csrf.enabled` | gRPC 请求的 CSRF 开关 | `false` |
| `spring.grpc.server.inprocess.name` | 进内服务器名称（配 `io.grpc:grpc-inprocess`） | — |
| `spring.grpc.client.channel.<name>.target` | 逻辑通道真实地址，如 `static://host:9090` | — |
| `spring.grpc.client.channel.<name>.ssl.enabled` | 客户端单向 TLS | `false` |
| `spring.grpc.client.channel.<name>.ssl.bundle` | 客户端 mTLS bundle | — |
| `spring.grpc.client.inprocess.enabled` | 进内通道工厂 | `true` |
| `spring.grpc.client.observation.enabled` | 客户端可观测性拦截器 | `true` |

## 避坑指南

1. **`.proto` 放错目录** —— 代码生成器只扫 `src/main/proto`，放到别的包下生成不出类，报一堆 "cannot find symbol"。
2. **逻辑通道名没配地址** —— `@ImportGrpcClients(target = "hello")` 之后忘了配 `spring.grpc.client.channel.hello.target`，调用期直接失败；坚持"逻辑名 + 属性配置"，不要在注解里硬编码地址。
3. **超 4MB 消息直接被拒** —— 入站消息默认上限 4MB，批量导出/大文件场景优先拆分或走对象存储，别轻易调大上限（会放大内存与超时风险）。
4. **全链路没人设 deadline** —— 上游不设、下游也不设，一个慢依赖把线程池耗尽；入口设总预算、逐层递减，超时与不可用分开监控。
5. **流式接口按一元写法硬套** —— blocking stub 不支持双向流、服务端流的回调时序与一元不同，实现前先看官方 gRPC 文档对应语言的示例。
6. **反射服务暴露契约元数据** —— `grpc-services` 在类路径上反射默认开启（便于 `grpcurl` 调试），生产环境评估是否关闭：`spring.grpc.server.reflection.enabled=false`。
7. **错误映射不一致** —— 有的服务把"查不到"返回 `UNKNOWN`，有的返回 `NOT_FOUND`，客户端没法写统一分支；在团队内固化状态码映射表并写进 `grpc` 门面层。

### 延伸阅读

- 官方文档：[reference/io/grpc](https://docs.spring.io/spring-boot/4.1.1/reference/io/grpc.html)（本章全部事实来源）、[appendix/application-properties/index](https://docs.spring.io/spring-boot/4.1.1/appendix/application-properties.html)（spring.grpc.*）、[appendix/dependency-coordinates/coordinates](https://docs.spring.io/spring-boot/4.1.1/appendix/dependency-coordinates/coordinates.html)（starter 坐标）
- 官方在线：[gRPC 支持](https://docs.spring.io/spring-boot/4.1.1/reference/io/grpc.html) · [Spring gRPC 文档](https://docs.spring.io/spring-grpc/reference/1.1/) · [gRPC 核心概念](https://grpc.io/docs/what-is-grpc/core-concepts/) · [Status 码定义](https://grpc.io/docs/guides/error/)
- 站内：[[虚拟线程](/glossary#虚拟线程-vs-平台线程)深度实践](/practice/virtual-threads)（上章）· [消息：Kafka、AMQP 与 JMS](/practice/messaging)（内部异步解耦）· [安全](/advanced/security)（@PreAuthorize 体系）
