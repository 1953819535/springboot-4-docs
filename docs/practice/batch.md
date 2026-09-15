---
title: "批处理：Spring Batch"
description: "对账、迁移、报表类批量任务的现代写法——Job/Step 分块处理、断点续跑与启动即执行"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/io/spring-batch.html"
---

# 批处理：Spring Batch

> 本章你会学到：判断什么时候需要 Spring Batch 而不是 @Scheduled，写出带分块、重试、状态跟踪的完整批处理 Job。

> **上一章**：[NoSQL：MongoDB 与更多](/practice/nosql) · **下一章**：[任务调度：Quartz](/practice/quartz)
## 业务场景

月底对账要扫全表订单、迁移要搬百万行数据、报表要聚合多源数据——这类任务的共同点：**数据量大、可分块、失败要能续跑、要有执行记录可查**。`@Scheduled` + 一个大循环解决不了这些问题，这正是 Spring Batch 的领域：

| 能力 | @Scheduled 循环 | Spring Batch |
| --- | --- | --- |
| 分块处理（chunk） | 手写 | 框架内置（读 N 条-处理-写 N 条-提交） |
| 失败重试/跳过 | 手写 | 声明式配置 |
| 断点续跑 | 自己记位置 | JobInstance/执行状态自动跟踪 |
| 执行历史 | 自己建表 | 元数据表内置 |
| 并行分区 | 手写 | 内置分区策略 |

::: tip 选型一句话
"定时跑一段逻辑"用 @Scheduled；"处理一批数据、要可靠、要可追溯"用 Spring Batch。为跑个清理任务引入 Batch 是过度设计。
:::

## 极简实现

### 依赖与启动即执行

::: code-group
```xml [Maven]
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-batch</artifactId>
</dependency>
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-jdbc</artifactId>
</dependency>
```
```groovy [Gradle]
implementation 'org.springframework.boot:spring-boot-starter-batch'
implementation 'org.springframework.boot:spring-boot-starter-jdbc'
```
:::

Spring Boot 对 Batch 的核心便利：**上下文里只有一个 Job Bean 时，应用启动即自动执行它**（多个 Job 时用 `spring.batch.job.name` 指定要跑哪个）。

### 定义一个完整的 Job（读-处理-写）

```java
@Configuration
public class OrderImportJobConfig {

    @Bean
    public Job orderImportJob(JobRepository jobRepository, Step importStep) {
        return new JobBuilder("orderImportJob", jobRepository)
                .start(importStep)
                .build();
    }

    @Bean
    public Step importStep(JobRepository jobRepository,
                           PlatformTransactionManager transactionManager,
                           OrderItemProcessor processor,
                           OrderItemWriter writer) {
        return new StepBuilder("importStep", jobRepository)
                // chunk 模式：读 100 条-处理-写 100 条-提交一次事务
                .<OrderInput, OrderRecord>chunk(100, transactionManager)
                .reader(reader())
                .processor(processor)
                .writer(writer)
                .faultTolerant()                     // 容错开关：开启后可重试/跳过
                .retry(org.springframework.dao.DataAccessException.class)  // 数据库抖动自动重试
                .retryLimit(3)
                .skip(org.springframework.batch.item.validator.ValidationException.class)  // 脏数据跳过
                .skipLimit(50)                       // 最多跳 50 条，超过判定失败
                .build();
    }

    @Bean
    public org.springframework.batch.item.ItemReader<OrderInput> reader() {
        // 生产换 JdbcCursorItemReader / FlatFileItemReader（流式，不全量进内存）
        var data = java.util.List.of(new OrderInput("A001", 100));
        return new org.springframework.batch.item.support.ListItemReader<>(data);
    }
}
```

Processor（返回 null 即过滤该条）与 Writer：

```java
@Component
public class OrderItemProcessor implements org.springframework.batch.item.ItemProcessor<OrderInput, OrderRecord> {

    @Override
    public OrderRecord process(OrderInput input) {
        if (!input.valid()) return null;   // 过滤：不进入 writer
        return new OrderRecord(input.code(), input.amount() * 100);
    }
}
```

### 配置与元数据

Batch 的执行状态（JobInstance/StepExecution）写入元数据表——JDBC 存储需要先建表（脚本随 spring-batch-core 发布，表前缀可改）：

```properties
spring.batch.jdbc.table-prefix=BATCH_
spring.batch.job.enabled=true
```

::: warning @EnableBatchProcessing 会让自动配置退位
手动加 `@EnableBatchProcessing`（或继承 DefaultBatchConfiguration）后，Boot 的批处理自动配置——包括元数据表初始化——全部关闭，改由注解属性接管。**默认不要加**，除非你要完全手动配置。
:::

## 关键注解与配置

| 注解 / 配置键 | 作用 | 要点 |
| --- | --- | --- |
| `@EnableBatchProcessing` | 切换手动配置 | 加了之后自动配置退位，生产默认不加 |
| `Job` / `Step` Bean | 任务与步骤定义 | 单 Job Bean 启动即执行 |
| `chunk(N, txManager)` | 分块提交 | N 是事务边界，太大单事务过重 |
| `faultTolerant()` | 容错开关 | 配套 retry/retryLimit/skip/skipLimit |
| `spring.batch.jdbc.table-prefix` | 元数据表前缀 | 多套 Batch 共库时区分 |
| `spring.batch.job.enabled=false` | 关闭启动执行 | 定时触发场景必须关 |
| `spring.batch.job.name` | 多 Job 时指定启动项 | 只对启动执行生效 |
| MongoDB 元数据存储 | 元数据存 Mongo | `spring.batch.data.mongodb.schema.initialize=true` |

**与调度器组合**（关闭启动执行后，用 @Scheduled 手动触发）：

```java
@Component
public class NightlyJobRunner {

    private final JobLauncher jobLauncher;
    private final Job orderImportJob;

    public NightlyJobRunner(JobLauncher jobLauncher, Job orderImportJob) {
        this.jobLauncher = jobLauncher;
        this.orderImportJob = orderImportJob;
    }

    @Scheduled(cron = "0 0 2 * * ?")
    public void run() throws Exception {
        // 每天用新参数实例化——同参数的 JobInstance 不会重复执行
        jobLauncher.run(orderImportJob, new JobParametersBuilder()
                .addLocalDate("date", java.time.LocalDate.now())
                .toJobParameters());
    }
}
```

## 避坑指南

- **JobParameters 不变 = 不会重跑**：同参数的 JobInstance 已 SUCCESS，再 launcher 同参数会被跳过——周期任务用日期/时间戳做参数（见上例），"重跑昨天"只需传昨天的日期。
- **元数据表没建直接启动报错**：JDBC 存储要先执行建表脚本；别用内存存储应付生产——重启丢执行历史，断点续跑失效。
- **chunk 里的异常回滚整块**：100 条一起提交意味着 1 条脏数据回滚 100 条；要么开 skip 按条跳过，要么把校验前移到 processor。
- **大对象别进元数据**：JobDataMap/ExecutionContext 适合存"跑到第几行"这类标量；塞业务大对象会拖垮元数据读写。
- **避开全内存 Reader**：FlatFileItemReader/JdbcCursorItemReader 是流式的；自己全量 list 进内存再"分块"等于没做批处理。
- **虚拟线程不加速 chunk 写入**：Batch 的并行靠多 Step/分区，chunk 事务仍绑定平台线程——开虚拟线程开关不改变批处理性能模型。

### 延伸阅读

- 官方镜像：`spring-boot-4.1.1-docs/reference/io/spring-batch.md`（自动配置存储/启动执行/多 Job 选择）
- 站内：[数据访问与事务](/practice/data-access)（chunk 事务与 JdbcClient 读写）、[消息：Kafka、AMQP 与 JMS](/practice/messaging)（异构系统解耦的另一半答案）

::: info 官方出处
- 自动配置存储与启动执行：`spring-boot-4.1.1-docs/reference/io/spring-batch.md` 全文
- 元数据表前缀：`spring-boot-4.1.1-docs/appendix/application-properties/index.md`（`spring.batch.jdbc.*`）
:::
