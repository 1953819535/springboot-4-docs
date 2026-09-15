---
title: "IoC、依赖注入与配置绑定"
description: "构造器注入、三种注入方式对比、@Bean 装配第三方对象、record 类型安全配置绑定与条件装配，用 4.1.1 的现代写法管理你的业务组件。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/using/spring-beans-and-dependency-injection.html"
---

# IoC、依赖注入与配置绑定

> 本章你会学到：声明 Bean、注入依赖、绑定配置——把"对象创建与组装"这件事交给框架，你的代码只写业务。

::: tip 术语速览 · 先懂三个词
**Bean**：交给 Spring 容器管理的对象（你声明要什么，容器负责造好递来）。**IoC/依赖注入（DI）**：创建对象的控制权交给容器，依赖作为构造器参数注入，不再自己 new。**Starter**：一组功能全家桶依赖坐标，引一个 = 声明我要做这类事。更多概念随时查 [核心概念速查](/glossary)。
:::

## 业务场景

企业应用的底层问题：一个订单服务要用用户仓库、要用网关客户端、要读一堆配置项。如果每个类自己创建依赖（`new UserRepository()`），类与类焊死、换实现要改源码、测试无法隔离。Spring 的答案是三层解耦——**Bean 定义（谁归容器管）→ 依赖注入（谁需要谁）→ 配置绑定（参数从哪来）**。

## 极简实现

### 三种注入方式对比

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

### @Bean 方法：装配第三方库对象

自己的类加 `@Service` 就行，第三方库的类改不了源码——在 `@Configuration` 类里用 `@Bean` 方法手工装配：

```java
@Configuration
public class HttpClientConfig {

    @Bean   // 方法返回值注册为一个 Bean，方法名默认就是 Bean 名称
    public RestTemplate thirdPartyRestClient(
            @Value("${thirdparty.base-url}") String baseUrl) {
        var factory = new HttpComponentsClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        return new RestTemplate(factory);
    }

    // 第三方 SDK：构造参数由容器自动注入（引用其他 Bean）
    @Bean
    public OrderGateway orderGateway(RestTemplate thirdPartyRestClient) {
        return new OrderGateway(baseUrl, thirdPartyRestClient);
    }
}
```

两种配置类写法按场景选：`@Configuration(proxyBeanMethods = true)`（默认）支持 `@Bean` 方法之间互相调用且仍返回同一单例；`@Configuration(proxyBeanMethods = false)` 是推荐写法：Bean 方法之间不互相调用时关闭代理，启动更快。后一种写法要求第三方类有标准 setter，适合"字段名即配置键"的网关客户端、连接工厂等组件。

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

## 关键注解与配置

| 注解 / 属性 | 作用 | 要点 |
| --- | --- | --- |
| `@Service` / `@Component` | 声明业务 Bean | 加在类上，容器启动时自动注册 |
| `@Bean` | 方法级注册 | 第三方类无法加注解时的装配入口 |
| `@Autowired` | 注入标记 | 构造器单注入可省略；字段注入不推荐 |
| `@ConfigurationProperties(prefix)` | 类型安全配置绑定 | record + `@DefaultValue` + `@Validated` |
| `@ConditionalOnProperty` | 条件装配 | 功能开关：`havingValue` + `matchIfMissing` |
| `@Scope("prototype")` | 多例作用域 | 每次注入/获取都新建实例 |

### 深入：包结构——按功能分层还是按业务模块

官方文档（structuring-your-code）明确给出两种组织方式，且**示例代码用的就是按业务模块**：

```java
com
 +- example
     +- myapplication
         +- MyApplication.java
         |
         +- customer                     // 客户模块
         |   +- Customer.java            // 领域对象
         |   +- CustomerController.java
         |   +- CustomerService.java
         |   +- CustomerRepository.java
         |
         +- order                        // 订单模块
             +- Order.java
             +- OrderController.java
             +- OrderService.java
             +- OrderRepository.java
```

两种主流组织方式对比：

| 维度 | 按层分包（controller/service/repository 大文件夹） | 按模块分包（customer/order 各自内聚） |
| --- | --- | --- |
| 官方文档示例 | — | **正是官方 "typical layout" 示例** |
| 小项目起步 | 直观，符合"先分技术层"直觉 | 模块边界要先想清楚 |
| 中大型演进 | 单层膨胀：service 文件夹几十个类互相依赖 | 加一个业务 = 加一个包，模块高内聚 |
| 可见性控制 | 无法限制跨层乱引用 | 可配合包级可见性限制模块间耦合 |
| 团队协作 | 按"改哪一层"分工 | 按"改哪个业务"分工（特性团队友好） |
| 官方强化方案 | — | Spring Modulith（官方提供的模块化 enforcement 框架） |

::: tip 选型建议
原型/小工具按层分包足够；**业务会持续生长的企业应用，官方推荐并示例了按模块分包**（每个业务一个包，内聚 Controller/Service/Repository）。两者混合也常见：顶层按模块、模块内小项目再分 controller/service。想强制模块边界（编译期检查模块间依赖），官方提供了 [Spring Modulith](https://spring.io/projects/spring-modulith) 项目。
:::

### 深入：条件装配与功能开关

同一套代码要在不同环境启用不同实现（测试环境用假支付、生产用真支付），`@ConditionalOnProperty` 按配置决定 Bean 是否创建：

```java
@Bean
@ConditionalOnProperty(name = "app.payment.provider",
                       havingValue = "mock",
                       matchIfMissing = true)     // 不配置时默认启用
public PaymentProvider mockPaymentProvider() {
    return new MockPaymentProvider();
}

@Bean
@ConditionalOnProperty(name = "app.payment.provider", havingValue = "alipay")
public PaymentProvider alipayPaymentProvider(AlipayClient client) {
    return new AlipayPaymentProvider(client);
}
```

配置 `app.payment.provider=mock`（或不配置）走假支付，`=alipay` 时切真支付——切换不改编译产物。

### 深入：自动配置与你的 Bean 是什么关系（使用者视角）

把容器里的 Bean 分成两类看，就再也不迷惑了：

- **你声明的**：`@Service`、`@Bean`、`@ConfigurationProperties` 注册的 Bean，全部以你的定义为准；
- **自动配置给的**：starter 根据 classpath 条件注册的基础设施 Bean（数据源、事务管理器、RestClient.Builder 等）。

两者冲突时你的声明赢——Boot 的自动配置全部带 `@ConditionalOnMissingBean` 语义：你定义了同类型 Bean，自动配置就自动退位。这就是"约定优于配置，但永远可覆盖"的机制。

## 避坑指南

1. **字段注入的隐藏代价**：脱离容器无法单测、循环依赖被掩盖、依赖关系不显式。构造器注入让依赖关系在签名里一目了然——多到超过 5 个构造参数时，先想这个类是不是职责太多。
2. **循环依赖报错别急着加 `@Lazy`**：先想两个类为什么互相需要——多数情况是职责划分错了；`@Lazy` 只是延后暴露问题。
3. **`@ConfigurationProperties` 别注入其他 Bean**：它只该消费配置环境；实在需要与其他 Bean 协作时，把协作逻辑放在使用它的 Service 里，而不是绑定点。
4. **@ConfigurationProperties 与 @Value 别混用于同一组配置**：同一批键两套读取方式，团队协作时必然有人改错地方；一个功能域选定一种。
5. **@ConfigurationProperties 类要加 setter 或用 record 构造器绑定**：普通 class 没有无参构造 + setter，绑定静默失败（字段全 null），启动不报错——这是最隐蔽的坑。
6. **Bean 方法之间互相调用要开代理**：`proxyBeanMethods = false` 时 `this.otherBeanMethod()` 拿到的是新实例而非容器单例。
7. **条件装配别过度**：`@ConditionalOnProperty` 适合功能级开关；到处使用会让依赖关系难以追踪，优先考虑 profile 级装配。
8. **singleton 注入 prototype 只注入一次**：需要反复拿新实例时用 `ObjectProvider`，直接注入字段等于把 prototype 用成了 singleton。
9. **Auto-config 排查**：启动加 `--debug` 输出条件评估报告，看到哪个自动配置生效/失效；干扰项用 `@SpringBootApplication(exclude = ...)` 排除。

### 延伸阅读

官方文档（在线）：

- [reference/using/spring-beans-and-dependency-injection](https://docs.spring.io/spring-boot/4.1.1/reference/using/spring-beans-and-dependency-injection.html) —— 构造器注入与多构造器处理
- [reference/using/structuring-your-code](https://docs.spring.io/spring-boot/4.1.1/reference/using/structuring-your-code.html) —— 官方包结构示例（customer/order 模块划分）与 Spring Modulith 指引
- [reference/using/auto-configuration](https://docs.spring.io/spring-boot/4.1.1/reference/using/auto-configuration.html) —— 自动配置的退位规则与排除方式
- [reference/features/external-config](https://docs.spring.io/spring-boot/4.1.1/reference/features/external-config.html) —— Type-safe Configuration Properties / 构造器绑定 / 默认值与校验各节
- [specification/configuration-metadata/annotation-processor](https://docs.spring.io/spring-boot/4.1.1/specification/configuration-metadata/annotation-processor.html) —— configuration-processor 的 Maven/Gradle 接法
- [appendix/dependency-versions/coordinates](https://docs.spring.io/spring-boot/4.1.1/appendix/dependency-versions/coordinates.html) —— starter 坐标清单

站内相关页：[快速开始](/guide/getting-started) · [外化配置与多环境](/guide/configuration) · [REST API 开发全规范](/guide/rest-api)

::: info 官方出处
- 三种注入方式与 Bean 定义：`reference/using/spring-beans-and-dependency-injection.md`
- 包结构示例原文：`reference/using/structuring-your-code.md`（customer/order 模块示例即官方原文）
- 配置绑定：`reference/features/external-config.md`
:::
