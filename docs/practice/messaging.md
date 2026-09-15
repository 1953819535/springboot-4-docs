---
title: "消息：Kafka、AMQP 与 JMS"
description: "Spring Boot 4.1.1 消息集成：KafkaTemplate 与手动 ack、死信与重试、JSON 序列化、RabbitMQ 手动确认与死信队列完整链、@JmsListener 并发与事务、三大 MQ 选型"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/messaging/kafka.html"
---

# 消息：Kafka、AMQP 与 JMS

**本章你会学到：**

- 三者选型边界与统一写法：模板发、注解收
- Kafka：JSON 序列化、手动 ack（AckMode）、死信兜底、事务发送
- RabbitMQ：手动确认 + 重试 + 死信队列完整链
- JMS：`@JmsListener` 并发参数与事务绑定
- 消费并发、幂等、publisher confirms 等生产参数

> 上一步：[Spring gRPC 服务](/practice/grpc) ｜ 下一步：[数据访问与事务](/practice/data-access)

## 业务场景

下单后要发短信、刷新缓存、给风控系统同步数据。同步调用链一长，一个下游抖动就把下单接口拖垮。把"下单成功"这个事件丢进消息队列，主流程只管投递，其他系统各自消费——**削峰、解耦、异步**，这是消息队列的三大核心价值。

先选型，三大主流选项的适用边界：

| 维度 | Kafka | RabbitMQ (AMQP) | JMS (ActiveMQ) |
| --- | --- | --- | --- |
| 定位 | 高吞吐事件流 | 灵活路由的业务消息 | Jakarta 标准 API |
| 典型场景 | 日志采集、埋点、事件溯源、大数据管道 | 任务分发、复杂路由拓扑、延迟重试、死信细控 | 已有 ActiveMQ 技术栈、遗留集成 |
| 消费语义 | 消费组独立消费、按分区有序、可回放 | 单条可靠投递、交换机路由 | Queue 点对点 / Topic 订阅 |
| starter | `spring-boot-starter-kafka` | `spring-boot-starter-amqp` | `spring-boot-starter-activemq` / `-artemis` |

三者写法高度一致，换 MQ 时业务代码迁移成本远低于换 RPC 框架；但拓扑、运维与监控体系完全不同，选型仍要慎重。

## 极简实现

### Kafka：发送与接收

引入 `spring-boot-starter-kafka` 后 `KafkaTemplate` [自动配置](/glossary#自动配置auto-configuration)，`spring.kafka.*` 控制全部行为：

```yaml
spring:
  kafka:
    bootstrap-servers: localhost:9092
    consumer:
      group-id: order-service    # 未在 @KafkaListener 指定 groupId 时生效
    producer:
      acks: all                  # leader + 所有 ISR 副本确认
```

```java
@Component
public class OrderEventPublisher {

    private final KafkaTemplate<String, String> kafkaTemplate;

    OrderEventPublisher(KafkaTemplate<String, String> kafkaTemplate) {
        this.kafkaTemplate = kafkaTemplate;
    }

    public void orderCreated(String orderId) {
        // key 相同的消息进同一分区，保证该订单事件有序
        kafkaTemplate.send("order-events", orderId, "created");
    }
}
```

消费端任意 [Bean](/glossary#bean) 加 `@KafkaListener` 即成为监听端点；未定义 `KafkaListenerContainerFactory` 时，Boot 用 `spring.kafka.listener.*` [自动配置](/glossary#自动配置auto-configuration)默认工厂：

```java
@Component
public class OrderEventConsumer {

    @KafkaListener(topics = "order-events", groupId = "cache-refresher")
    public void onOrderEvent(String message) {
        // 处理消息
    }
}
```

启动时自动建 Topic：声明一个 `NewTopic` [Bean](/glossary#bean) 即可，已存在则忽略。

::: tip
若定义了 `RecordFilterStrategy`、`CommonErrorHandler`、`AfterRollbackProcessor` 或 `ConsumerAwareRebalanceListener` Bean，会自动关联到默认工厂——错误处理与过滤逻辑按 Bean 装配，不用手动 set。
:::

### Kafka：JSON 序列化完整配置

发对象而不是字符串。生产端用 `JacksonJsonSerializer` 并关闭类型头（消费端按自己的类型反序列化，避免包名耦合）；消费端用 `JacksonJsonDeserializer` 指定默认类型与信任包：

```yaml
spring:
  kafka:
    producer:
      value-serializer: org.springframework.kafka.support.serializer.JacksonJsonSerializer
      properties:
        "[spring.json.add.type.headers]": false
    consumer:
      value-deserializer: org.springframework.kafka.support.serializer.JacksonJsonDeserializer
      properties:
        "[spring.json.value.default.type]": com.example.order.event.OrderEvent
        "[spring.json.trusted.packages]": com.example.order
```

消费方法签名直接收目标类型，反序列化已完成：

```java
@KafkaListener(topics = "order-events")
public void onOrderEvent(OrderEvent event) {
    // 强类型对象直接用
}
```

需要流处理时，Kafka Streams 走 `@EnableKafkaStreams` + `StreamsBuilder`，序列化用 `JacksonJsonSerde`，应用id 默认取 `spring.application.name`（详见官方镜像 kafka.md 的 Streams 一节）。

### RabbitMQ：发送与接收

引入 `spring-boot-starter-amqp`，`AmqpTemplate` / `AmqpAdmin` [自动配置](/glossary#自动配置auto-configuration)：

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: admin
    password: secret
    # 或一行连串 addresses=amqp://admin:secret@localhost；amqps 自动启用 SSL
```

```java
@Component
public class NotificationPublisher {

    private final AmqpTemplate amqpTemplate;

    NotificationPublisher(AmqpTemplate amqpTemplate) {
        this.amqpTemplate = amqpTemplate;
    }

    public void send(String payload) {
        amqpTemplate.convertAndSend("notification-queue", payload);
    }
}
```

```java
@Component
public class NotificationConsumer {

    @RabbitListener(queues = "notification-queue")
    public void onMessage(String content) {
        // 处理消息
    }
}
```

两个自动化行为要记住：**Queue [Bean](/glossary#bean) 自动向 broker 声明**；**MessageConverter Bean 自动关联**到模板与监听容器工厂（JSON 消息换 `Jackson2JsonMessageConverter` 一个 Bean 即可）。发送侧网络抖动用模板重试兜底：

```yaml
spring:
  rabbitmq:
    template:
      retry:
        enabled: true          # 默认 false
        initial-interval: 2s
```

### JMS：发送与接收

引入 `spring-boot-starter-activemq`（或 `spring-boot-starter-artemis`）。Spring Boot [自动配置](/glossary#自动配置auto-configuration)了更流畅的 `JmsClient`：

```java
@Component
public class AuditPublisher {

    private final JmsClient jmsClient;

    AuditPublisher(JmsClient jmsClient) {
        this.jmsClient = jmsClient;
    }

    public void audit(String action) {
        jmsClient.destination("audit-queue").send(action);
    }
}
```

```java
@Component
public class AuditConsumer {

    @JmsListener(destination = "audit-queue")
    public void onMessage(String content) {
        // 处理消息
    }
}
```

默认容器工厂是**事务性**的：有 JTA 管理器就关联它，否则启用 `sessionTransacted`。监听方法上加 `@Transactional` 可把本地数据库事务与消息确认绑在一起——本地事务提交后消息才被确认。

### 深入：Kafka 手动 ack 与幂等消费

自动提交下，消费者崩溃会把"已处理未提交"的消息重投一遍。要精确控制提交时机，切手动 ack：

```yaml
spring:
  kafka:
    consumer:
      enable-auto-commit: false   # 关闭后台周期提交
    listener:
      ack-mode: manual            # 批量场景可用 batch / count / time / count_time
      # ack-count: 100            # COUNT 模式：每 100 条提交一次
      # ack-time: 10s             # TIME 模式：每 10 秒提交一次
      # async-acks: true          # 异步 ack，仅 manual / manual-immediate 下生效
```

监听方法注入 `Acknowledgment`，处理成功后显式提交：

```java
@KafkaListener(topics = "order-events", groupId = "cache-refresher")
public void onOrderEvent(OrderEvent event, Acknowledgment ack) {
    handle(event);     // 业务落库
    ack.acknowledge(); // 成功才提交位移；失败不提交，重启后重投
}
```

手动 ack 只解决"不丢"，**重复投递仍会发生**（处理完、ack 前崩溃）。消费逻辑必须幂等：业务唯一键做去重表或条件更新，"处理 + 幂等记录"同一数据库事务。

### 深入：Kafka 异常处理与死信

监听器抛异常且无人接住时，容器会在同一条消息上反复重试——一条毒消息就能卡住整个分区。Boot 的装配姿势是注册 `CommonErrorHandler` [Bean](/glossary#bean)（自动关联默认工厂）：有限次退避重试 + 死信 Topic 兜底：

```java
@Configuration(proxyBeanMethods = false)
public class KafkaErrorConfiguration {

    @Bean
    public CommonErrorHandler errorHandler(KafkaTemplate<Object, Object> template) {
        // 重试耗尽后把消息原样发布到 "<topic>.DLT" 死信 Topic
        var recoverer = new DeadLetterPublishingRecoverer(template);
        // 最多重试 3 次，指数退避 1s → 2s → 4s
        return new DefaultErrorHandler(recoverer, new ExponentialBackOff(1000, 2));
    }
}
```

`DefaultErrorHandler` / `DeadLetterPublishingRecoverer` 属 spring-kafka 公共 API，重试策略与死信命名细节以 Spring for Apache Kafka 文档为准；轻量场景也可方法内 try-catch 上报，但别吞业务异常。

**事务发送**一句话：配 `spring.kafka.producer.transaction-id-prefix` 后 Boot 自动装配 `KafkaTransactionManager`，发送随之在事务内执行（默认禁止非事务发送逃逸）。

### 深入：RabbitMQ 手动确认 + 重试 + 死信完整链

RabbitMQ 的可靠链路分三层，缺一环消息就可能丢：

**第一层：确认模式与 requeue 行为**。默认自动 ack；监听器抛异常时消息**无限重回队列**（这是默认行为，不是配置错误）。切手动确认并控制 requeue：

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        acknowledge-mode: manual          # 手动确认（direct 容器同名键）
        default-requeue-rejected: false   # 抛异常被拒后不再重回，转投死信
        prefetch: 10                      # 每消费者未 ack 消息上限
        concurrency: 2                    # 最小并发消费者
        max-concurrency: 8                # 最大并发消费者
```

手动模式下监听方法注入 `Channel`，`basicAck` / `basicNack` 自行决策；或者继续用自动 ack，靠异常类型表态——抛 `AmqpRejectAndDontRequeueException` 即"拒绝且不重回"，这是重试耗尽后 Boot 采用的同一机制。

**第二层：有限重试**。开启容器重试，监听器异常在客户端侧按指数退避重试：

```yaml
spring:
  rabbitmq:
    listener:
      simple:
        retry:
          enabled: true        # 默认 false
          max-retries: 3       # 默认 3
          initial-interval: 1s
          multiplier: 2
```

重试耗尽后默认用 `RejectAndDontRequeueRecoverer` 拒绝消息；需要自定义恢复逻辑就声明 `MessageRecoverer` [Bean](/glossary#bean)（自动关联默认工厂），也可用 `RabbitListenerRetrySettingsCustomizer` Bean 编程式定制 RetryPolicy。

**第三层：死信队列**。被拒绝且不重回的消息去哪？由 broker 侧的死信交换机（DLX）决定——给业务队列声明 `x-dead-letter-exchange` 参数即可，死信自动路由到绑定的死信队列：

```java
@Bean
Queue notificationQueue() {
    // spring-amqp QueueBuilder：声明队列时挂上死信参数
    return QueueBuilder.durable("notification-queue")
            .deadLetterExchange("dlx")
            .deadLetterRoutingKey("notification.dead")
            .build();
}
```

链路全景：**消费失败 → 客户端重试 3 次 → 耗尽后 reject（不重回）→ broker 按 DLX 路由到死信队列 → 人工或定时任务消费死信**。发送侧可靠性另外开 `spring.rabbitmq.publisher-confirm-type=correlated` + `publisher-returns=true`，确认投递结果。

### 深入：JMS 并发与自定义容器工厂

`@JmsListener` 的并发不在注解上，而在 `spring.jms.listener.*`：

```yaml
spring:
  jms:
    listener:
      min-concurrency: 2
      max-concurrency: 8   # 未指定 max 时 min 同时充当 max
```

需要自定义 `MessageConverter` 等更多控制时，用 `DefaultJmsListenerContainerFactoryConfigurer` 造第二个工厂，注意用 `ConnectionFactoryUnwrapper` 解包原生工厂（监听容器要用原生连接工厂自己做恢复）：

```java
@Bean
public DefaultJmsListenerContainerFactory myFactory(
        DefaultJmsListenerContainerFactoryConfigurer configurer,
        ConnectionFactory connectionFactory) {
    var factory = new DefaultJmsListenerContainerFactory();
    configurer.configure(factory, ConnectionFactoryUnwrapper.unwrapCaching(connectionFactory));
    factory.setMessageConverter(new MyMessageConverter());
    return factory;
}

// 使用：@JmsListener(destination = "audit-queue", containerFactory = "myFactory")
```

容器实现两条路线：默认 `DefaultMessageListenerContainer` 拉模式（轮询、可动态调并发），`SimpleMessageListenerContainer` 推模式（贴近 JMS 规范语义），差异见各自 javadoc。

## 关键注解与配置

| 注解 / 配置 | 作用 |
| --- | --- |
| `@KafkaListener(topics, groupId)` | Kafka 消费端点；容器工厂按 `spring.kafka.listener.*` [自动配置](/glossary#自动配置auto-configuration) |
| `spring.kafka.listener.concurrency` | Kafka 消费线程数，与分区数对齐，超出只空转 |
| `spring.kafka.listener.ack-mode` | 提交模式（`manual` / `manual-immediate` / `batch` / `count`…），manual 需注入 `Acknowledgment` |
| `spring.kafka.producer.transaction-id-prefix` | 非空即启用事务生产者并装配 `KafkaTransactionManager` |
| `@RabbitListener(queues, containerFactory)` | RabbitMQ 消费端点，可指定自定义容器工厂 |
| `spring.rabbitmq.listener.simple.acknowledge-mode` | 容器确认模式，`manual` 为手动 ack |
| `spring.rabbitmq.listener.simple.retry.*` | 监听器重试（默认关闭），耗尽后 reject 可入死信 |
| `spring.rabbitmq.listener.simple.default-requeue-rejected` | 被拒消息是否重回队列，死信链路里设 `false` |
| `spring.rabbitmq.template.retry.enabled` | 发送重试，默认 `false` |
| `spring.rabbitmq.publisher-confirm-type` | 生产确认，`correlated` 为异步逐条确认 |
| `@JmsListener(destination)` | JMS 消费端点，默认工厂事务性 |
| `spring.jms.listener.min-concurrency` / `max-concurrency` | JMS 并发消费者数区间 |
| `NewTopic` / `Queue` [Bean](/glossary#bean) | 启动时自动向 broker 声明 Topic / 队列 |

## 避坑指南

**Kafka 并发受分区数封顶**。一个分区同一时刻只被组内一个消费者消费，`concurrency` 超过分区数不会提升吞吐；扩容消费实例时分区数就是吞吐上限，上线前按目标吞吐预估分区数。

**幂等必须自己保证**。Kafka 默认 at-least-once，手动 ack 也只是"不丢"；RabbitMQ 重试与死信链路同样会重复投递。消费逻辑用业务唯一键做幂等去重，"处理 + 幂等记录"同一事务。

**毒消息卡分区**。Kafka 消费失败未被错误处理器接住会在同一条消息上无限重试，整个分区停止消费。必须配 `CommonErrorHandler`（重试 + 死信）或方法内兜底 catch，别裸奔。

**RabbitMQ 别只靠 requeue**。重试关闭时监听器抛异常会**无限重回队列**形成死循环。三选一：开 `listener.simple.retry`（耗尽后 reject）、设 `default-requeue-rejected=false` + 死信交换机兜底、或精确抛 `AmqpRejectAndDontRequeueException`。

**JSON 反序列化要收口信任包**。`JacksonJsonDeserializer` 不配 `spring.json.trusted.packages` 时信任范围过宽，有反序列化攻击面；消费端按生产者包名收口。生产端记得关 `spring.json.add.type.headers`，否则类名写进消息头，跨服务重构包名就翻车。

**生产者可靠性按需开启**。Kafka 高吞吐权衡 `acks` 与重试；RabbitMQ 默认发后即忘，要确认就开 `publisher-confirm-type=correlated`，别不知情地裸发。

**嵌入式 broker 只属于开发**。ActiveMQ 依赖在 classpath 就启动内嵌 broker，生产忘配 `broker-url` 会静默变成单机队列，消息随应用重启消失。

## 延伸阅读

- 官方镜像（本章依据语料）：`spring-boot-4.1.1-docs/reference/messaging/kafka.md`、`spring-boot-4.1.1-docs/reference/messaging/amqp.md`、`spring-boot-4.1.1-docs/reference/messaging/jms.md`
- Spring for Apache Kafka 文档（AckMode 全表、错误处理与死信细节）：[spring-kafka reference](https://docs.spring.io/spring-kafka/reference/4.1/index.html)
- Spring AMQP 文档（死信交换机、容器配置）：[spring-amqp reference](https://docs.spring.io/spring-amqp/reference/4.1/index.html)
- Spring Framework JMS 集成（两种监听容器差异）：[JMS chapter](https://docs.spring.io/spring-framework/reference/7.0/integration/jms.html)
- 站内：上一章 [Spring gRPC 服务](/practice/grpc) ｜ 下一章 [数据访问与事务](/practice/data-access) ｜ 配套 [可观测性与 Actuator](/advanced/observability)

::: info 官方出处
本文依据 Spring Boot 官方文档 [Apache Kafka Support](https://docs.spring.io/spring-boot/4.1.1/reference/messaging/kafka.html)、[AMQP](https://docs.spring.io/spring-boot/4.1.1/reference/messaging/amqp.html)、[JMS](https://docs.spring.io/spring-boot/4.1.1/reference/messaging/jms.html) 章节（v4.1.1）整理。
:::
