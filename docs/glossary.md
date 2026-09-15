---
title: "核心概念速查（零基础术语表）"
description: "Bean、IoC、依赖注入、自动配置、API 版本化、DTO、AOP、切片测试、Testcontainers——本手册用到的每个核心概念的一句话定义与生活化类比"
---

# 核心概念速查（零基础术语表）

> 本章你会学到：把本手册各章反复出现的核心术语一次讲透。读后续章节遇到不懂的词，回这里查。建议第一遍通读，再当字典用。

## 容器与对象管理

<a id="bean"></a>

### Bean

**Bean 是什么**：由 Spring 容器创建、装配和管理的对象，就叫 Bean。你在类上标 `@Service`、`@Component`，或在 `@Configuration` 类里写 `@Bean` 方法，Spring 就会接管这个类的"生老病死"——你不再自己 `new`，而是声明"我需要它"，Spring 负责造好递给你。

::: tip 生活化类比
餐厅（你的应用）不自己养牛种菜，而是向供应商（Spring 容器）下订单。每一份食材就是一个 Bean——你只声明"我要牛肉"，供应商按时按量送来。
:::

**为什么重要**：测试时可以换掉任何一个 Bean（给假数据）、配置变更时不用改代码——这一切都建立在"对象由容器统一供给"之上。

<a id="ioc-容器与-ioc-容器"></a>

### IoC（控制反转）与 IoC 容器

**IoC 是什么**：Inversion of Control，控制反转。传统写法里你的代码自己 `new` 依赖；控制反转之后，**创建对象的控制权反转给了容器**——你只声明依赖，容器在运行时把现成的对象"注入"进来。

**IoC 容器**就是干这件事的运行时引擎（底层是 `ApplicationContext`）。说"Spring 容器"、"IoC 容器"、"ApplicationContext"，指的都是同一个东西。

<a id="依赖注入di"></a>

### 依赖注入（DI）

**依赖注入是什么**：IoC 的具体实现手法——容器把你需要的依赖对象**作为参数送进**构造器/setter，而不是你主动去拿。

```java
// 没有 IoC：自己创建依赖，类与类焊死
public class UserService {
    private UserRepository repo = new UserRepository();  // 换实现？改源码
}

// 依赖注入：只声明"我需要"，容器负责供给
@Service
public class UserService {
    private final UserRepository repo;
    public UserService(UserRepository repo) {  // 容器自动把实现递进来
        this.repo = repo;
    }
}
```

**为什么重要**：换数据库实现、换 Mock 测试、多环境配置——都只改容器装配，不动业务代码。

<a id="自动配置auto-configuration"></a>

### 自动配置（Auto-configuration）

**自动配置是什么**：Spring Boot 检测你 classpath 上有什么依赖，就自动帮你创建好那一整套 Bean。引入 `starter-data-jpa`，数据源、事务管理器、JPA 工厂全自动装配——这就是"约定大于配置"的落点。

**排障手段**：怀疑某个自动配置没生效，用 `--debug` 启动看条件评估报告。

<a id="starter"></a>

### Starter

**Starter 是什么**：一组"功能全家桶"依赖坐标。`spring-boot-starter-webmvc` 一个坐标带入 Web 开发所需的全部依赖与默认配置。引入 starter = 声明"我要做这类事情"。

<a id="applicationcontext"></a>

### ApplicationContext

**ApplicationContext 是什么**：IoC 容器的接口本体——所有 Bean 的注册表 + 生命周期管理者 + 依赖装配引擎。`SpringApplication.run()` 返回的就是它。日志里看到 "Started XxxApplication in 2.3 seconds"，意思是容器启动、所有 Bean 装配完毕。

## Web 与接口设计

### REST / RESTful

**REST 是什么**：一种 API 设计风格——URL 表示资源（名词），HTTP 方法表示动作（GET 查/POST 建/PUT 改/DELETE 删），状态码表达结果。RESTful 就是符合这套风格的接口。

### API 版本化

**API 版本化是什么**：接口发生不兼容变更时，新旧两版并行服务不同客户端的机制。Spring Framework 7 内置支持：同一个 `/api/users` 路径按版本（请求头/媒体类型等）路由到不同方法，详见 [内置 API 版本控制](/guide/api-versioning)。

<a id="dto"></a>

### DTO

**DTO 是什么**：Data Transfer Object，数据传输对象——**专门在层与层之间搬运数据的简单对象**，通常用 record。Controller 收到的请求体、返回的响应体都应该是 DTO，而不是把数据库 Entity 直接暴露给外界。

::: warning 为什么不让 Entity 直接出门
Entity 含数据库内部字段（创建时间、软删标记），直接返回会泄露内部结构、且字段变更直接破坏 API 契约。DTO 是接口的"稳定门面"。
:::

### 拦截器 / 过滤器

**过滤器（Filter）**：Servlet 规范层面，在请求进入 Controller **之前**处理（如日志、编码）。
**拦截器（Interceptor）**：Spring MVC 层面，能拿到 Handler 信息，常用于鉴权、埋点。
两者都是"请求链路上的关卡"，颗粒度不同。

## 数据与事务

### ORM 与 Hibernate

**ORM 是什么**：Object-Relational Mapping，对象关系映射——把 Java 类映射到数据库表、对象属性映射到列，让你操作对象而不是拼 SQL。Hibernate 是最主流的 ORM 实现（JPA 是其标准接口）。

<a id="懒加载lazy-loading"></a>

### 懒加载（Lazy Loading）

**懒加载是什么**：查询主对象时不立刻加载其关联数据，等第一次访问关联字段才发 SQL。省资源，但用不好会触发 N+1（见下）。

<a id="n1-查询"></a>

### N+1 查询

**N+1 是什么**：查 1 次列表 + 对列表里每一行再各查 1 次关联 = 1+N 条 SQL。列表页 50 行就有 51 条 SQL，性能杀手。解法：`@EntityGraph` / join fetch，见 [数据访问与事务](/practice/data-access)。

### 事务（Transaction）

**事务是什么**：一组数据库操作的"要么全成、要么全不算"的执行单元。`@Transactional` 标注的方法里，任何一步失败整个回滚。详细传播行为与失效场景见 [数据访问与事务](/practice/data-access)。

### 连接池（HikariCP）

**连接池是什么**：数据库连接的创建成本极高（TCP 握手+认证），池子预先建好一批连接反复借还。HikariCP 是 Spring Boot 默认的连接池实现。

<a id="flyway-与数据库迁移"></a>

### Flyway 与数据库迁移

**迁移是什么**：把每次表结构变更写成带版本号的 SQL 脚本（V1、V2…），工具按序执行并记录——表结构也进版本控制。Flyway 是 Spring Boot 集成的迁移工具。

## 测试概念

<a id="mock"></a>

### Mock

**Mock 是什么**：测试时用一个"假的"替换真实依赖，预设它的返回值——隔离被测代码，不真的调数据库/远端。`@MockitoBean` 声明的就是 Mock Bean。

<a id="切片测试test-slice"></a>

### 切片测试（Test Slice）

**切片测试是什么**：只加载"某一层"的 Bean 来测试——@WebMvcTest 只装 Web 层、@DataJpaTest 只装数据层。启动快、隔离准，代价是其他层都是 Mock。详见 [测试策略](/advanced/testing)。

<a id="testcontainers"></a>

### Testcontainers

**Testcontainers 是什么**：测试里用 Docker 拉起真实的 PostgreSQL/Redis/Kafka 容器供集成测试使用——比内嵌库真实，比手工环境可靠。`@ServiceConnection` 自动接线。

## 部署与运维概念

### 镜像 / 镜像层 / Buildpacks

**容器镜像**：把应用+运行时打包成"到处能跑"的模板。**镜像层**：镜像由多层只读层叠成，依赖层不变就不重建——分层构建加速 CI。**Buildpacks**：不用写 Dockerfile，工具链扫描你的 jar 自动生成合规镜像（`bootBuildImage`）。

<a id="fat-jar-与-boot-inf"></a>

### fat jar 与 BOOT-INF

**fat jar**：把自己的类+全部依赖打进一个 jar 的产物（约 18MB 起步）。依赖放在 jar 内部的 `BOOT-INF/lib/` 目录，应用类在 `BOOT-INF/classes/`——`java -jar` 能跑起来靠的是 Boot 自定义的类加载器读这套结构。

### 端点（Endpoint）

**端点**：API 语境下指"一个可调用的 URL"（如 `/actuator/health`）；Actuator 语境下指运维信息的暴露点。本手册两种语境都出现，按上下文理解。

### 指标 / 标签（Micrometer）

**指标（Metric）**：数值型运行数据（QPS、耗时、内存）。**标签（Tag）**：指标的维度键值对（如 `uri=/users`）。纪律：标签取值必须是有限集合（低基数），放用户 ID 这种无限值会撑爆时序库。

## 并发概念

<a id="虚拟线程-vs-平台线程"></a>

### 虚拟线程 vs 平台线程

**平台线程**：一对一映射操作系统线程，创建成本高（MB 级栈内存），数量受限。**虚拟线程**：JVM 调度的轻量线程，阻塞时自动让出，百万级并发也只用少量平台线程——IO 密集型应用的红利，见 [虚拟线程深度实践](/practice/virtual-threads)。

### pinning（虚拟线程钉住）

**pinning 是什么**：虚拟线程在某些操作（旧 JDK 的 synchronized、native 调用）中无法让出载体线程，退化成独占——高并发下会卡死吞吐。JDK 25 基准下 synchronized 已不再是 pinning 点，但 native 调用仍需注意。

### RPC、protobuf 与 deadline

**RPC**：Remote Procedure Call——调远端服务像调本地方法。**protobuf**：gRPC 用的二进制序列化格式与接口定义语言（.proto 文件即契约）。**deadline**：gRPC 调用的超时上限，必须显式设置并随调用链传播，否则故障时会无限等待。

### 缓存穿透 / 雪崩 / 击穿

**穿透**：查询根本不存在的数据，缓存永远不命中，全打到数据库——用空值缓存/参数校验挡。**雪崩**：大量缓存同一时刻过期，数据库瞬间过载——TTL 加随机抖动。**击穿**：某个热点 key 过期瞬间并发全打到库——加锁或逻辑过期。

<a id="aop-与切面"></a>

### AOP 与切面

**AOP 是什么**：Aspect-Oriented Programming，面向切面编程——把"横切多个业务的通用逻辑"（日志、计时、鉴权）从业务代码里抽出来，声明"在哪些方法前后执行"。`@Cacheable`、`@Transactional` 的实现都基于 AOP 动态代理。

::: warning AOP 的一个重要副作用
基于代理的 AOP 意味着**同类内部方法调用不走代理**——这就是 `@Transactional`、`@Cacheable` 自调用失效的根源，详见事务失效五坑。
:::

### MDC 与链路追踪

**MDC**：Mapped Diagnostic Context——在日志里附加请求级上下文（如 requestId），一次写入全链路日志可见。**链路追踪（Tracing）**：跨服务跟踪一次请求的完整路径（Micrometer Tracing/OTel）。

<a id="jwt--csrf--cors-速记"></a>

### JWT / CSRF / CORS 速记

**JWT**：JSON Web Token——自包含的签名令牌，服务端不存会话也能验明身份。**CSRF**：跨站请求伪造，浏览器 Cookie 会话场景的攻击面（纯 Bearer Token API 可关）。**CORS**：浏览器跨域请求的放行机制，服务端显式声明允许来源。

### 术语之间的关系图

```
Spring 容器 (ApplicationContext)
   ├─ 管理所有 Bean（@Service/@Bean 创建）
   ├─ 靠依赖注入 (DI) 装配它们
   ├─ 启动时按自动配置决定装什么
   └─ Web 层：拦截器/过滤器 → Controller(收 DTO)
                              └→ Service(@Transactional 事务)
                                    └→ Repository(JPA/Hibernate ORM)
                                          └→ 连接池(HikariCP) → 数据库
   横切能力：AOP（缓存/事务/指标）
   运维出口：Actuator 端点 → 指标/日志/追踪
```

### 延伸阅读

- 概念的完整展开散见各章：[IoC、依赖注入与配置绑定](/guide/ioc-di)、[内置 API 版本控制](/guide/api-versioning)、[数据访问与事务](/practice/data-access)、[测试策略](/advanced/testing)
- 官方文档：`reference/`（各板块对应文件，页内"延伸阅读"逐页标注）

::: info 官方出处
本页为概念梳理页，定义以官方语料行为描述为准：Bean/DI/自动配置见 `reference/using/`，测试概念见 `reference/testing/`，部署概念见 `reference/packaging/`。
:::

> **下一章**：[常见问题](/faq)
