---
title: "IoC 与依赖注入：装配你的业务组件"
description: "构造器注入、三种注入方式对比、@Bean 装配第三方对象、record 类型安全配置绑定与条件装配，用 4.1.1 的方式组织业务代码。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/using/spring-beans-and-dependency-injection.html"
---

# IoC 与依赖注入：装配你的业务组件

本章你会学到：如何用构造器注入组织依赖、如何把第三方库对象与配置绑定进容器、如何用 record 实现类型安全的配置（含嵌套与校验），以及何时使用条件装配与 prototype 作用域。上一章：[快速开始：跑起第一个应用](/guide/getting-started)。

> **上一章**：[开始之前：环境与项目创建](/guide/getting-started) · **下一章**：[REST 接口与分层架构](/guide/rest-api)

## 业务场景

订单服务需要调用风险评审、消息通知等下游组件，还要按环境开关灰度功能。你希望：依赖全部显式声明、配置集中且类型安全、某些 Bean 只在特定配置下创建——而不是到处写 `new` 和散落的 `@Value`。

## 极简实现

### 构造器注入（默认选择）

`@SpringBootApplication` 隐式执行组件扫描，`@Service` 等构造型注解的类自动注册为 Bean。单构造器时无需任何注入注解：

```java
package com.example.order;

import org.springframework.stereotype.Service;

@Service
public class OrderService {

    private final RiskAssessor riskAssessor;

    public OrderService(RiskAssessor riskAssessor) { // 单构造器，Spring 自动调用并注入
        this.riskAssessor = riskAssessor;
    }

    public void place(Order order) {
        RiskResult result = riskAssessor.assess(order);
        // ...
    }
}
```

字段声明为 `final`，依赖不可变、测试时直接 `new OrderService(fakeAssessor)`，无需反射工具。如果类有多个构造器，用 `@Autowired` 标出想让 Spring 使用的那一个。

### 三种注入方式对比

| 方式 | 写法 | 优点 | 问题与风险 | 结论 |
| --- | --- | --- | --- | --- |
| **构造器注入** | 单构造器 + `final` 字段 | 依赖显式可见、不可变；脱离容器可直接 `new` 出来单测；循环依赖会在启动期暴露 | 多构造器时需标 `@Autowired` 指定入口 | **默认选择，官方推荐** |
| Setter 注入 | `@Autowired` 标在 setter 上 | 适合真正可选、允许后期替换的依赖 | 依赖可变；对象可能处于"半初始化"状态就被使用 | 仅用于可选依赖 |
| 字段注入 | `@Autowired` 标在字段上 | 写起来最省事 | 依赖被藏在类内部；无法 `final`；不启动容器就没法测；一个类悄悄攒了一堆依赖也不容易被发现 | **避免使用** |

字段注入的问题平时感觉不到，出问题时全在测试和重构阶段：想 `new` 一个对象测逻辑，只能靠反射塞字段。

三种方式的完整写法对照（同一个 `UserService` 依赖 `UserRepository`，三段代码等价）：

::: code-group
```java [构造器注入 · 推荐]
@Service
public class UserService {

    private final UserRepository userRepository;   // final：注入后不可变

    // 单构造器时 @Autowired 可省略，Spring 自动调用
    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public User getUser(long id) {
        return userRepository.findById(id)
                .orElseThrow(() -> new BusinessException("用户不存在: " + id));
    }
}
```
```java [Setter 注入 · 仅限可选依赖]
@Service
public class UserService {

    private UserRepository userRepository;

    public UserService() { }   // 必须有无参构造器：Spring 先 new 再调 setter

    @Autowired(required = false)   // required=false：容器里没有该 Bean 也不报错
    public void setUserRepository(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public User getUser(long id) {
        // 防御式判空：Setter 注入的依赖可能一直没被注入
        return java.util.Optional.ofNullable(userRepository)
                .flatMap(repo -> repo.findById(id))
                .orElseThrow(() -> new BusinessException("用户不存在或服务未装配"));
    }
}
```
```java [字段注入 · 仅作反面示例]
@Service
public class UserService {

    @Autowired   // 反射直接塞字段：绕过构造器
    private UserRepository userRepository;   // 非 final，随时被改

    public User getUser(long id) {
        // 想脱离容器单测这段逻辑？只能反射塞字段：
        // var f = UserService.class.getDeclaredField("userRepository");
        // f.setAccessible(true); f.set(service, mockRepo);
        return userRepository.findById(id)
                .orElseThrow(() -> new BusinessException("用户不存在: " + id));
    }
}
```
:::

三段代码的风险差异要在测试与重构时才显现。构造器版直接 `new UserService(mockRepo)` 就能测；Setter 版要 new 之后再调 setter（且对象有一段"未装配"的危险窗口期）；字段版不启动容器就无法构造——这就是"官方推荐构造器"的工程原因，不是风格偏好。

### record 配置绑定 + 模式匹配消费

```java
package com.example.order.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

@ConfigurationProperties("order")
public record OrderProperties(
        String gatewayUrl,                    // order.gateway-url
        @DefaultValue("3") int maxRetry,      // 缺省时取 3
        @DefaultValue("500ms") Duration backoff,
        Retry retry) {                        // 嵌套 record，绑定 order.retry.*

    public record Retry(int maxAttempts, Duration initialBackoff) {}
}
```

```yaml
order:
  gateway-url: https://api.example.com
  max-retry: 5
  retry:
    max-attempts: 3
    initial-backoff: 1s
```

在主类加 `@ConfigurationPropertiesScan`（或用 `@EnableConfigurationProperties(OrderProperties.class)`）后，即可像普通 Bean 一样注入。JDK 25 下用 record 模式匹配消费，天然处理 null 与解构：

```java
String describeRetry(OrderProperties props) {
    return switch (props.retry()) {
        case null -> "未启用独立重试策略，沿用全局 " + props.maxRetry() + " 次";
        case Retry(int maxAttempts, var backoff) -> "重试 " + maxAttempts + " 次，退避 " + backoff;
        default -> "未知策略";
    };
}

// 只要退避时长时，用未命名变量 _ 跳过不关心的组件
long backoffMillis(OrderProperties props) {
    return switch (props.retry()) {
        case Retry(int _, Duration backoff) -> backoff.toMillis();
        case null -> Duration.ofMillis(500).toMillis();
    };
}
```

## 关键注解与配置

| 注解 | 作用 | 要点 |
| --- | --- | --- |
| `@Service` / `@Component` / `@Repository` | 声明被扫描的 Bean | 放在主类根包之下才会被扫到 |
| `@Autowired` | 多构造器时指定注入入口 | 单构造器不需要写 |
| `@Bean` | 在 `@Configuration` 类中手动注册 Bean | 第三方库对象只能这样进容器 |
| `@ConfigurationProperties` | 前缀化配置绑定 | record 构造器绑定，嵌套 record 自动递归 |
| `@ConfigurationPropertiesScan` | 扫描注册 properties 类 | 加在主类或任意 `@Configuration` 类上 |
| `@ConditionalOnProperty` | 按配置决定是否创建 Bean | 功能开关的标准做法 |
| `@Scope("prototype")` | 每次获取都新建实例 | 默认是 singleton，见下文 |

### @Bean 方法：接入第三方组件

第三方库的类你改不了源码、没法加 `@Service`，唯一的入口是 `@Bean` 方法——方法返回什么，容器里就有什么：

```java
@Configuration(proxyBeanMethods = false)
public class ClientConfiguration {

    // 最小形态：方法参数即依赖，Spring 按类型自动注入
    @Bean
    public PaymentClient paymentClient(OrderProperties properties) {
        return new PaymentClient(properties.gatewayUrl(), properties.backoff());
    }

    // 企业形态：让第三方对象直接吃配置文件（JavaBean 绑定方式）
    // another.* 的任意属性都会映射到 SmsClient 的同名 setter
    @Bean
    @ConfigurationProperties("sms")
    public SmsClient smsClient() {
        return new SmsClient(); // 只负责 new，属性由绑定器填充
    }
}
```

`@Configuration(proxyBeanMethods = false)` 是推荐写法：Bean 方法之间不互相调用时关闭代理，启动更快。后一种写法要求第三方类有标准 setter，适合"字段名即配置键"的网关客户端、连接工厂等组件。

### @ConfigurationProperties 完整实践：校验与默认值

配置错误要在启动期暴露，而不是运行到一半才炸。加校验依赖后，`@Validated` + jakarta.validation 注解直接写在 record 上：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

```java
@ConfigurationProperties("order.gateway")
@Validated
public record GatewayProperties(
        @NotBlank String url,                       // 必填
        @Min(1) @Max(65535) @DefaultValue("443") int port,
        @NotBlank @DefaultValue("order-service") String appId,
        @Valid Timeout timeout,                     // 嵌套校验必须显式标 @Valid
        @DefaultValue Retry retry) {                // 空 @DefaultValue：未配置时也给全默认实例

    public record Timeout(@DefaultValue("3s") Duration connect,
                          @DefaultValue("10s") Duration read) {}

    public record Retry(@DefaultValue("3") int maxAttempts) {}
}
```

`order.gateway.url` 缺失或 `port=0` 时，应用直接拒绝启动，并指出具体哪个键不合法。三个细节：

- record 构造器绑定时，`@DefaultValue` 的字符串会自动转换为目标类型（`"3s"` → `Duration`）；
- 嵌套 record 未标空 `@DefaultValue` 时，整块未配置就绑定为 `null`；
- 默认值不写入 Environment，其他地方用 `@Value("${order.gateway.port:443}")` 引用时必须自带 `:默认值`。

### 让 IDE 补全你的配置键

引入 `spring-boot-configuration-processor`，编译期会为你的 `@ConfigurationProperties` 类生成配置元数据，IDE 就能像补全 `server.port` 一样补全你自己的键，并提示取值类型与默认值：

::: code-group

```xml [Maven]
<build>
  <plugins>
    <plugin>
      <groupId>org.apache.maven.plugins</groupId>
      <artifactId>maven-compiler-plugin</artifactId>
      <configuration>
        <annotationProcessorPaths>
          <path>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-configuration-processor</artifactId>
          </path>
        </annotationProcessorPaths>
      </configuration>
    </plugin>
  </plugins>
</build>
```

```groovy [Gradle]
dependencies {
  annotationProcessor 'org.springframework.boot:spring-boot-configuration-processor'
}
```

:::

它只在编译期干活，不进运行时 classpath，不会影响产物体积。用 Lombok 时注意让它排在 configuration-processor 之前执行。

### 条件装配：功能开关

按配置决定一个 Bean 是否存在，是功能灰度/降级的标准做法：

```java
@Configuration(proxyBeanMethods = false)
public class ExportConfiguration {

    @Bean
    @ConditionalOnProperty(name = "app.export.enabled",
                           havingValue = "true",
                           matchIfMissing = false) // 属性缺失时视为关闭
    public ExportService exportService(OrderService orderService) {
        return new ExportService(orderService);
    }
}
```

配置 `app.export.enabled=true` 时 Bean 才存在。消费方用 `ObjectProvider` 或 `Optional` 承接"可能不存在"：

```java
@Service
public class ReportFacade {

    private final ObjectProvider<ExportService> exportProvider;

    ReportFacade(ObjectProvider<ExportService> exportProvider) {
        this.exportProvider = exportProvider;
    }

    void export(Order order) {
        exportProvider.ifAvailable(svc -> svc.export(order)); // 未开启时静默跳过
    }
}
```

### Bean 作用域：singleton 与 prototype

绝大多数 Bean 用默认的 **singleton**：容器启动时创建一个实例，全应用共享，无状态的服务类、配置类、客户端都应该是它。**prototype** 通过 `@Scope("prototype")` 声明，容器每次注入或 `getBean()` 都返回新实例，适合**有状态、生命周期短**的对象——比如一次报表任务累积中间结果的生成器、按请求携带上下文的处理器。

一个关键行为差异：singleton Bean 里注入 prototype，注入动作只发生一次，拿到的永远是同一个实例。如果 singleton 需要"每次都要新的"，用 `ObjectProvider` 每次向容器索取：

```java
@Service
public class ReportFacade {

    private final ObjectProvider<ReportGenerator> generators; // ReportGenerator 是 prototype

    ReportFacade(ObjectProvider<ReportGenerator> generators) {
        this.generators = generators;
    }

    Report run(ReportRequest request) {
        ReportGenerator g = generators.getObject(); // 每次调用都拿新实例
        return g.generate(request);
    }
}
```

### 深入：自动配置与你的 Bean 是什么关系（使用者视角）

把容器里的 Bean 分成两类看，就再也不迷惑了：

- **你声明的**：`@Service`、`@Bean`、`@ConfigurationProperties` 注册的 Bean，全部以你的定义为准；
- **自动配置给的**：starter 引入后按条件补齐的默认实现（DispatcherServlet、RestClient.Builder、任务执行器……）。

两条判断依据覆盖全部行为：**classpath 上有什么依赖**决定自动配置尝试装配什么；**你自己有没有定义同类 Bean**决定它的兜底是否退位。所以"为什么我这个 Bean 没生效"的排查路径永远是：启动加 `--debug` 看条件评估报告 → 确认依赖是否在 → 确认自己的定义是否恰好排在了前面。干扰项用 `@SpringBootApplication(exclude = XxxAutoConfiguration.class)` 排除。

### 常用 starter（4.x 命名）

| starter | 用途 |
| --- | --- |
| `spring-boot-starter` | 核心与自动配置基础 |
| `spring-boot-starter-webmvc` | Spring MVC + Tomcat（REST/页面） |
| `spring-boot-starter-validation` | jakarta.validation 参数校验 |
| `spring-boot-starter-jackson` | JSON 序列化 |
| `spring-boot-starter-restclient` | RestClient 同步 HTTP 客户端 |
| `spring-boot-starter-aspectj` | AOP 切面 |
| `spring-boot-starter-data-jdbc` / `data-jpa` | 数据访问 |
| `spring-boot-starter-security` | 安全 |
| `spring-boot-starter-actuator` | 生产可观测端点 |
| `spring-boot-starter-test` | 测试（JUnit 6、MockMvc 等） |

::: tip 开启虚拟线程
配置 `spring.threads.virtual.enabled=true` 后，Tomcat 请求处理与 `@Async` 任务池都跑在虚拟线程上，容器注入的 `TaskExecutor` 随之切换，业务代码零改动。
:::

## 避坑指南

::: warning 配置绑定类的三个硬约束
1. **不要给 record 加 `@Component`**：构造器绑定只支持 `@EnableConfigurationProperties` 或扫描注册的 Bean，`@Component`/`@Bean` 创建的对象走不了构造器绑定。
2. **`-parameters` 编译参数必须开启**：使用 starter-parent 或 Boot Gradle 插件会自动开启，自行覆盖编译配置时丢失它会导致绑定失败。
3. **多构造器必须显式指定**：多个构造器时用 `@Autowired` 标注入入口（或 `@ConstructorBinding` 标绑定入口），否则启动报错。
:::

- **别用字段注入**：`@Autowired` 打在字段上会隐藏依赖、无法 `final`、单测难写；构造器注入是官方推荐。
- **前缀必须 kebab-case**：`@ConfigurationProperties("order.gateway")` 合法，带大写下划线的前缀非法。
- **列表覆盖不合并**：多环境对同一个 List 属性分别配置时，高优先级来源整体替换低优先级列表，不是按元素合并。
- **条件装配别过度**：`@ConditionalOnProperty` 适合功能级开关；到处使用会让依赖关系难以追踪，优先考虑 profile 级装配。
- **`@ConfigurationProperties` 别注入其他 Bean**：它只该消费配置环境；实在需要与其他 Bean 协作时，把协作逻辑放在使用它的 Service 里，而不是绑定点。
- **singleton 注入 prototype 只注入一次**：需要反复拿新实例时用 `ObjectProvider`，直接注入字段等于把 prototype 用成了 singleton。
- **Auto-config 排查**：启动加 `--debug` 输出条件评估报告，看到哪个自动配置生效/失效；干扰项用 `@SpringBootApplication(exclude = ...)` 排除。

### 延伸阅读

官方镜像（本地 `spring-boot-4.1.1-docs/` 目录）：

- `reference/using/spring-beans-and-dependency-injection.md` —— 构造器注入与多构造器处理
- `reference/using/auto-configuration.md` —— 自动配置的退位规则与排除方式
- `reference/features/external-config.md` —— Type-safe Configuration Properties / 构造器绑定 / 默认值与校验各节
- `specification/configuration-metadata/annotation-processor.md` —— configuration-processor 的 Maven/Gradle 接法
- `appendix/dependency-versions/coordinates.md` —— starter 坐标清单

官网对应页：<https://docs.spring.io/spring-boot/4.1.1/reference/using/spring-beans-and-dependency-injection.html>

站内相关页：[快速开始](/guide/getting-started) · [外化配置与多环境](/guide/configuration) · [REST API 开发全规范](/guide/rest-api)
