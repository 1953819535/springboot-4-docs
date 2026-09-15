---
title: "虚拟线程深度实践"
description: "在 Spring Boot 4.1.1 中开启虚拟线程：适用场景判断表、各组件行为变化、pinning 检测、@Async 完整例与连接池并发匹配算术，以及生产避坑清单。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/features/spring-application.html#features.spring-application.virtual-threads"
---

> **本章你会学到**
> - 用一张判断表决定服务该不该开虚拟线程（IO 密集 / CPU 密集 / 混合型 + 真实业务例子）
> - 一个开关 `spring.threads.virtual.enabled=true` 之后，Tomcat、`@Async`、`@Scheduled`、消息监听各自发生什么变化
> - 如何用日志与 JFR/jcmd 验证开关真的生效，并定位 pinning 阻塞点
> - 虚拟线程 × 数据库连接池的并发匹配算术：1000 个虚拟线程在 10 个连接前的排队真相
> - 生产环境 7 条避坑清单

> **下一章**：[HTTP 客户端三件套](/guide/http-clients)

## 业务场景

订单查询接口，峰值 QPS 500：每次请求要调 3 个下游 HTTP 接口、查 2 次数据库，单请求耗时约 400ms，几乎全部在等 IO。平台线程池 200 个 worker 全部"阻塞着等 IO"，吞吐上不去；继续加线程又要吃掉几百 MB 栈内存。

虚拟线程把"一个请求占一个线程"的成本降到接近零：线程阻塞时不再占住操作系统线程，而是被 JVM 挂起，让载体线程去跑别的任务。**它提升的是并发吞吐，不是单请求速度。**

### 适用判断表

| 类型 | 特征 | 典型业务例子 | 判断 |
| --- | --- | --- | --- |
| IO 密集 | 大部分时间在等网络 / 磁盘 / 数据库 | 网关聚合（并发调 3 个下游）、报表导出（查库 → 渲染文件 → 上传对象存储）、消息消费（拉消息 → 查库 → 写回） | ✅ 收益最大 |
| CPU 密集 | 几乎不阻塞，持续计算 | 图片压缩、加解密、风控规则引擎大循环 | ❌ 无收益：不增加 CPU 核数，还可能因调度开销更慢 |
| 混合型 | 先算一段，再等一段 IO | 实时定价：5ms 本地计算 + 50ms 查价源 | ⚠️ 看 IO 占比：>80% 可开；CPU 段建议丢到独立平台线程池，避免占住载体线程 |

判断口诀：**线程大部分时间在"等"就开，在"算"就别开。**

### 顺带澄清：虚拟线程不是响应式的替代品

| 维度 | 虚拟线程 | 响应式（WebFlux/R2DBC） |
| --- | --- | --- |
| 编程模型 | 顺序阻塞式，与普通代码无异 | 响应式流，链式操作符 |
| 栈追踪 / 调试 | 正常线程栈，好排查 | 异步栈，难定位 |
| 接入成本 | 一行开关，存量代码不动 | 生态全换，侵入性强 |
| 适用 | 绝大多数 IO 密集 Web 服务 | 极高并发长连接流、背压敏感场景 |

务实策略：先开虚拟线程拿到"够用的并发"，真的遇到十万级长连接或需要背压时再局部上响应式，而不是为了技术先进性全站改造。

## 极简实现

语料口径：虚拟线程要求 Java 21 或更高版本，官方强烈建议 Java 24+。本系列基于 JDK 25，满足推荐线。

### 第一步：一行开关

```properties
# application.properties
spring.threads.virtual.enabled=true   # 默认 false
```

开启后，所有任务统一调度在一个 JVM 级平台线程池（载体线程）上——语料原文：*"virtual threads are scheduled on a JVM wide platform thread pool and not on dedicated thread pools"*。因此所有"配线程池"的属性同时失效（见下文行为变化表）。

对应的 Java 形态变化：以前为 `@Async` 手工定制的线程池 [Bean](/glossary#bean) 现在应该删掉。

```java
// ❌ 开启虚拟线程后删除这类定制：池参数全部失效，白留 confusion
// @Bean
// public ThreadPoolTaskExecutor applicationTaskExecutor() {
//     ThreadPoolTaskExecutor ex = new ThreadPoolTaskExecutor();
//     ex.setCorePoolSize(100);          // 现在没有任何效果
//     ex.setMaxPoolSize(200);
//     return ex;
// }

// ✅ 什么都不写：自动配置直接给出虚拟线程执行器
@Configuration
@EnableAsync
public class AsyncConfig {
}
```

### 第二步：验证开关真的生效

写一个探针接口，直接问 JDK 当前线程是什么：

```java
@RestController
public class ProbeController {

    @GetMapping("/probe")
    public Map<String, Object> probe() {
        Thread t = Thread.currentThread();
        return Map.of(
                "thread", t.toString(),
                "virtual", t.isVirtual()  // JDK 21+ API；JDK 25 行为：虚拟线程默认无名字
        );
    }
}
```

返回 `virtual=true` 即生效。也可以配合 JFR 录制观察线程事件：

```bash
java -XX:StartFlightRecording:filename=recording.jfr,duration=10s -jar demo.jar
```

更省事的日常验证法：日志里打线程名。在公共切面或请求入口加一行：

```java
log.info("handling on {}", Thread.currentThread());
```

开启前输出 `handling on tomcat-1`（平台线程池名），开启后类似 `handling on VirtualThread[#53]/runnable@ForkJoinPool-1-worker-1`——前缀 `VirtualThread` 与载体 `ForkJoinPool-worker` 是两个最直观的信号（JDK 25 行为：[虚拟线程](/glossary#虚拟线程-vs-平台线程)默认无自定义名，编号由 JVM 分配）。

### 第三步：让 JVM 别"悄悄退出"

语料警告：虚拟线程是**守护线程**——当 JVM 里所有线程都是守护线程时 JVM 会退出。依赖 `@Scheduled` 等机制"拉住"应用的做法会失效，需补一个开关：

```properties
spring.main.keep-alive=true   # 默认 false；保证 JVM 一直存活
```

## 关键注解与配置

下图对比了虚拟线程与平台线程在阻塞时的行为差异——这是理解其收益与边界的关键：

![下图对比了虚拟线程与平台线程在阻塞时的行为差异——这是理解其收益与边界的关键](/diagrams/virtual-threads.svg)

一个开关牵动全局。先看行为变化总表，再看每个组件的具体写法。

### 开启后各组件行为变化表

| 组件 | 开启后的变化 | 依据 |
| --- | --- | --- |
| 内嵌 Tomcat（请求处理线程） | 请求处理改由[虚拟线程](/glossary#虚拟线程-vs-平台线程)承载；容器线程池参数不再是有效调参点 | 机制依据语料"统一 JVM 级调度 + 专用池配置失效"（Tomcat 适配细节语料未展开，属 Boot 行为） |
| `@Async`（applicationTaskExecutor） | `spring.task.execution.pool.core-size / max-size / queue-capacity / keep-alive / allow-core-thread-timeout` **全部失效**（附录对每个键标注 "Doesn't have an effect if virtual threads are enabled"） | 语料 + 附录 |
| `@Scheduled` | 调度线程变为虚拟（守护）线程，不再维持 JVM 存活；`spring.task.scheduling.pool.size` 失效 | 语料 + 附录 |
| 消息监听容器 | 语料明确 "This not only affects scheduling and can be the case with other technologies too"——监听线程同样变为守护线程；绑定专用池的并发参数同样失效 | 语料（推断部分已标注） |

### @Scheduled 在虚拟线程下的完整例

```java
@Component
public class NightlyJob {

    @Scheduled(cron = "0 0 2 * * *")
    public void refreshMaterializedStats() {
        // 调度线程现在是虚拟（守护）线程：
        // 1) 不再维持 JVM 存活 → 必须 spring.main.keep-alive=true
        // 2) spring.task.scheduling.pool.size 失效 → 别再调它
        log.info("job on {}", Thread.currentThread());
    }
}
```

### @Async + 虚拟线程完整例

```java
@Configuration
@EnableAsync
public class AsyncConfig {
    // 开启虚拟线程后无需自定义 ThreadPoolTaskExecutor：
    // pool.* 参数已失效，任务直接跑在虚拟线程上
}

@Service
public class ReportService {

    private static final Logger log = LoggerFactory.getLogger(ReportService.class);

    @Async  // 由自动配置的 applicationTaskExecutor 执行 → 虚拟线程
    public CompletableFuture<Path> exportOrderReport(long orderId) {
        log.info("export on {}", Thread.currentThread()); // 验证：isVirtual=true
        Path pdf = renderPdf(orderId);   // 长耗 IO：查询 + 渲染 + 上传
        return CompletableFuture.completedFuture(pdf);
    }
}
```

### 深入：调度模型 60 秒版

读懂三个词，排查问题不慌（JDK 25 行为，机制描述以 JDK 官方[虚拟线程](/glossary#虚拟线程-vs-平台线程)文档为准）：

- **载体线程（carrier）**：JVM 内部的平台线程池，默认大小约等于 CPU 核数，负责真正执行虚拟线程的代码；
- **挂起（unmount）**：虚拟线程遇到托管阻塞（IO、`sleep`、等锁、等连接）时，把栈从载体线程上摘下来放进 JVM 队列，载体线程立刻去跑下一个任务——这是"百万线程"的底气；
- **钉住（pin）**：某些场景下栈摘不下来，虚拟线程赖在载体线程上，载体线程被白白占住——上一节的主题。

一个心智模型：**虚拟线程是"任务"，载体线程是"工人"**。任务可以无限多，工人只有核数那么几个；只要任务都在"等"，工人永远不会闲；只要有人在"算"或被 pin，工人就成了瓶颈。

### 深入：pinning 与阻塞点

**什么是 pinning**：虚拟线程阻塞时本应"挂起让出"载体线程；某些情况下它会钉死（pin）在载体线程上不让出，连带占住一个平台线程。语料口径：*"applications can experience lower throughput because of 'Pinned Virtual Threads'"*——吞吐不升反降，这是 IO 密集服务最危险的回归。

**检测手段（语料）**：

- JDK Flight Recorder：启动时加 `-XX:StartFlightRecording`，在录制结果中找 pinning 相关事件；
- `jcmd` CLI：`jcmd <pid> Thread.dump_to_file -format=json /tmp/threads.json`（JDK 25 行为：JSON 线程转储会同时列出虚拟线程与载体线程，可直接检索 pin 信息）。

**阻塞点现状（JDK 25 行为，语料未覆盖，以你所用 JDK 的官方虚拟线程文档为准）**：`synchronized` 阻塞导致的 pinning 自 JDK 24（JEP 491）起已大幅缓解；剩余典型 pin 点是 native/JNI 调用等少数场景。Boot 语料仍保留该警告，意味着**升级到 JDK 25 后也值得用 JFR 复测一遍**。

**区分"好阻塞"与"坏阻塞"**：

| 阻塞点 | 性质 |
| --- | --- |
| JDBC 查询、HTTP 调用、消息收发等托管 IO | 好：正常挂起让出，成本极低 |
| 长时间 CPU 循环 | 坏：占住载体线程；载体线程数有限（JDK 25 行为：默认约等于 CPU 核数） |
| native/JNI 调用 | 坏：pin 住载体线程，用 JFR 定位后拆到独立平台线程池 |

### 深入：连接池并发匹配算术例

虚拟线程不产生新的数据库连接。设连接池 10 个连接，单条 SQL 平均 20ms：

```text
池吞吐上限 ≈ 10 连接 × (1000ms / 20ms) = 500 QPS
```

现在 1000 个[虚拟线程](/glossary#虚拟线程-vs-平台线程)同时到达：

- 前 10 个拿到连接，正常执行；
- 其余 990 个 park 在 Hikari 借连接的等待队列上——**不占平台线程、几乎不耗内存，这是虚拟线程真正的进步**；
- 但数据库吞吐上限依然是 500 QPS：虚拟线程只是把"线程不够"重新包装成"连接超时"。`connection-timeout`（[HikariCP](/glossary#连接池hikaricp) 默认 30s）内排不上队就抛 `SQLException`。

结论：**虚拟线程不是连接池扩容器**。池大小应贴近数据库承载力；入口并发用限流（信号量 / 网关限流）控制，而不是指望 1000 个线程"更努力"。

结论：**虚拟线程不是连接池扩容器**。池大小应贴近数据库承载力；入口并发用限流（信号量 / 网关限流）控制，而不是指望 1000 个线程"更努力"。

### 深入：消息监听器与虚拟线程

Kafka/RabbitMQ 监听容器也在"每条消息一个任务"的模型上，是虚拟线程的天然受益者。开启开关后监听端线程同样变为守护线程——语料原文：*"This not only affects scheduling and can be the case with other technologies too"*（该句为语料对调度之外技术的推断性提示，具体容器的适配细节语料未逐项展开）。

```java
@KafkaListener(topics = "order-events", concurrency = "20")
public void onOrderEvent(OrderEvent event) {
    // concurrency 仍控制"同时拉取处理的消息数"（容器自身并发度），
    // 与线程池类型解耦：每个处理任务跑在虚拟线程上，
    // 消费逻辑内部的阻塞（查库、调下游）不再占住平台线程
    orderService.settle(event);
}
```

注意别把 `concurrency` 无脑拉高：它仍是真正的并发上限，放大会直接传导到下游数据库与远端服务——配合上一节的连接池算术一起看。

### 配置速查

| 键 | 说明 | 默认值 |
| --- | --- | --- |
| `spring.threads.virtual.enabled` | 是否使用[虚拟线程](/glossary#虚拟线程-vs-平台线程) | `false` |
| `spring.main.keep-alive` | 无非守护线程时是否保持应用存活 | `false` |
| `spring.task.execution.pool.core-size` | @Async 核心线程数（开启后无效） | `8` |
| `spring.task.scheduling.pool.size` | @Scheduled 池大小（开启后无效） | `1` |

::: warning 连接池大小不会因虚拟线程而变大
虚拟线程解决的是"线程贵"，不解决"连接贵"：[HikariCP](/glossary#连接池hikaricp) 连接池默认大小不变，开启虚拟线程后并发上来反而会先打满连接池。连接池大小要与真实并发重新评估，不是开个开关就万事大吉。
:::

## 避坑指南

以下每条都来自真实事故模式，按"现象 → 原因 → 解法"组织。

1. **按旧经验调 `spring.task.execution.pool.*`，参数静默失效** —— 开启虚拟线程后附录对每个池键统一标注无效。调参前先确认开关状态，虚拟线程模式下池参数不再是杠杆。
2. **应用"无故"退出** —— 全虚拟线程 = 全守护线程，JVM 可能直接退出。按语料建议设置 `spring.main.keep-alive=true`。
3. **吞吐不升反降，却没查 pinning** —— 语料明确 pinning 可导致吞吐下降；用 JFR 或 `jcmd Thread.dump_to_file` 复测，别只盯 CPU 曲线。
4. **把虚拟线程当连接池扩容器** —— 见 10 连接 × 1000 线程的算术例；先扩池或限流，再谈虚拟线程，否则只是把线程饥饿换成连接超时。
5. **CPU 密集任务混入虚拟线程** —— 计算会占住载体线程，拖慢同机的所有 IO 任务；CPU 段放独立平台线程池（大小≈核数）。
6. **ThreadLocal 里缓存大对象** —— 虚拟线程数量级上去后（每请求一线程、可达百万级），ThreadLocal 持有的对象随线程数放大，堆内存失控；改用方法参数显式传递（JDK 25 行为：可用 ScopedValue 替代）。
7. **误以为能降低单请求延迟** —— 虚拟线程提升的是并发吞吐；单请求该 400ms 还是 400ms，发生 pinning 时甚至更慢。压测指标看 QPS/RT 分布，不看"线程数变多"。

7. **误以为能降低单请求延迟** —— 虚拟线程提升的是并发吞吐；单请求该 400ms 还是 400ms，发生 pinning 时甚至更慢。压测指标看 QPS/RT 分布，不看"线程数变多"。
8. **灰度期全站一刀切** —— 开关是应用级全局开关，没有按接口粒度的灰度能力。正确姿势：先在非核心服务开、压测 IO 占比与 pinning 事件，再推广；核心交易链路保留回滚预案（改回 false + 调回池参数）。
9. **JVM 崩溃 / OOM 后归因错位** —— 百万虚拟线程同时持有请求上下文（MDC、事务、缓冲区）时，内存水位与线程数成正比。溢出时先看堆中线程对象与 ThreadLocal 链，不要条件反射调 `-Xmx`。

### 延伸阅读

- 官方文档：[reference/features/spring-application](https://docs.spring.io/spring-boot/4.1.1/reference/features/spring-application.html)（Virtual threads 节）、[appendix/application-properties/index](https://docs.spring.io/spring-boot/4.1.1/appendix/application-properties.html)（spring.threads.* / spring.task.* 键值）
- 官方在线：[Spring Boot 4.1.1 – Virtual threads](https://docs.spring.io/spring-boot/4.1.1/reference/features/spring-application.html#features.spring-application.virtual-threads)
- Oracle 官方虚拟线程文档（语料引用，含 JFR/jcmd 检测说明）：[Virtual Threads (JDK 24)](https://docs.oracle.com/en/java/javase/24/core/virtual-threads.html)，JDK 25 行为以对应版本文档为准
- 站内：[HTTP 客户端三件套](/guide/http-clients)（下一章）· [数据访问与事务](/practice/data-access)（连接池配套）· [消息：Kafka、AMQP 与 JMS](/practice/messaging)（监听容器并发）
