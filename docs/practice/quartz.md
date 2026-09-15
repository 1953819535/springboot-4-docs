---
title: "任务调度：Quartz"
description: "持久化与集群调度——当 @Scheduled 不够用时：Job 持久化、cron 集群不重跑、misfire 策略"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/io/quartz.html"
---

# 任务调度：Quartz

> 本章你会学到：把调度从"进程内存"升级到"数据库持久化"，多实例部署下 cron 任务不重跑，以及 Job 里怎么注入 Spring Bean。上一章：[批处理：Spring Batch](/practice/batch)。

> **上一章**：[批处理：Spring Batch](/practice/batch) · **下一章**：[安全与鉴权](/advanced/security)
## 业务场景

`@Scheduled` 有两个硬边界：**任务定义只存在内存里**（重启即丢，改 cron 要发版）、**多实例各自触发**（3 台机器同一个 cron 跑 3 遍）。Quartz 补上这两块：

| 需求 | @Scheduled | Quartz |
| --- | --- | --- |
| 单实例定时执行 | ✅ 开箱即用 | 可用但杀鸡用牛刀 |
| 任务定义持久化（重启不丢） | ❌ | ✅ JDBC JobStore |
| 集群模式不重跑 | ❌（要自己加锁） | ✅ 数据库行锁天然支持 |
| 运行期改 cron | ❌（改配置发版） | ✅ 改库表触发器即可 |
| misfire 错过策略 | ❌ | ✅ 声明式配置 |

::: tip 升级时机一句话
单实例、cron 固定、丢了无所谓 → @Scheduled 够用；多实例部署、任务必须不重不漏 → 升级 Quartz。
:::

## 极简实现

### 依赖与持久化配置

::: code-group
```xml [Maven]
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-quartz</artifactId>
</dependency>
```
```groovy [Gradle]
implementation 'org.springframework.boot:spring-boot-starter-quartz'
```
:::

```properties
# 任务与触发器持久化到数据库（多实例集群的前提）
spring.quartz.job-store-type=jdbc
# 启动时初始化 Quartz 标准表（官方脚本自带；注意脚本会先 DROP 再建）
spring.quartz.jdbc.initialize-schema=always
```

::: danger initialize-schema=always 每次重启都会重建表
官方脚本先 DROP 已有表再创建——**已注册的触发器全部丢失**。首次部署用 always，之后改成 `never`（或用 Flyway 管理 Quartz 表结构）。
:::

### 定义 Job 与 Trigger

Job 本体继承 `QuartzJobBean`——普通 Spring Bean 与 JobDataMap 属性都通过 **setter 注入**：

```java
public class ReportJob extends org.springframework.scheduling.quartz.QuartzJobBean {

    private ReportService reportService;   // Spring [Bean](/glossary#bean)：setter 注入
    private String target;                 // JobDataMap 属性：同名 setter 注入

    public void setReportService(ReportService reportService) {
        this.reportService = reportService;
    }
    public void setTarget(String target) {
        this.target = target;
    }

    @Override
    protected void executeInternal(org.quartz.JobExecutionContext context) {
        reportService.generate(target, context.getFireTime());
    }
}
```

JobDetail 与 Trigger 声明为 Bean 后**自动被调度器拾取**，无需手动注册：

```java
@Configuration
public class QuartzConfig {

    @Bean
    public org.quartz.JobDetail reportJobDetail() {
        return org.quartz.JobBuilder.newJob(ReportJob.class)
                .withIdentity("reportJob")
                .usingJobData("target", "daily")     // 进 JobDataMap → setTarget
                .storeDurably()
                .build();
    }

    @Bean
    public org.quartz.Trigger reportJobTrigger() {
        return org.quartz.TriggerBuilder.newTrigger()
                .forJob(reportJobDetail())
                .withIdentity("reportJobTrigger")
                .withSchedule(org.quartz.CronScheduleBuilder
                        .cronSchedule("0 0 1 * * ?")                     // 每天 01:00
                        .withMisfireHandlingInstructionFireAndProceed()) // 错过补跑一次
                .build();
    }
}
```

## 关键注解与配置

| 注解 / 配置键 | 作用 | 要点 |
| --- | --- | --- |
| `spring.quartz.job-store-type=jdbc` | JDBC 持久化存储 | 集群不重跑的前提 |
| `spring.quartz.jdbc.initialize-schema` | 建表时机 | 首装 always，此后 never |
| `@QuartzDataSource` | Quartz 专用数据源 | 与业务库分库时标注在独立 DataSource Bean 上 |
| `@QuartzTransactionManager` | Quartz 专用事务管理器 | 同上，避免调度事务污染业务事务 |
| `spring.quartz.overwrite-existing-jobs` | 覆盖已注册任务 | 持久化后代码改动想生效时设 true |
| `spring.quartz.properties.*` | 透传 Quartz 原生配置 | 线程池、misfire 阈值等高级项 |
| `@DisallowConcurrentExecution` | 同一 Job 不并发 | 加在 Job 类上（长任务防重叠） |
| `SchedulerFactoryBeanCustomizer` | 编程式定制 | 官方明示 Executor Bean 不会自动挂给 Quartz |

**集群与 cron 速查**：

```properties
# 集群模式（JDBC 存储下自动生效；各实例时钟需同步）
spring.quartz.properties.org.quartz.jobStore.isClustered=true
spring.quartz.properties.org.quartz.jobStore.clusterCheckinInterval=15000
# 调度线程池
spring.quartz.properties.org.quartz.threadPool.threadCount=10
```

| cron 表达式 | 含义 |
| --- | --- |
| `0 0 1 * * ?` | 每天 01:00 |
| `0 0/30 * * * ?` | 每 30 分钟 |
| `0 0 9-18 ? * MON-FRI` | 工作日 9–18 点整点 |

## 避坑指南

- **initialize-schema=always 是双刃剑**：官方脚本 DROP 重建，已注册触发器每次重启清零——首装后立刻改 never，表结构交给 Flyway。
- **Job 里注入 Bean 必须走 setter**：Quartz 每次 new Job 实例，构造器注入不可用；继承 QuartzJobBean 并用 setter（Spring Bean 与 JobDataMap 属性都靠同名 setter 注入）。
- **JobDataMap 只放标量**：放进来的对象会被序列化持久化，类升级反序列化就炸；传 ID 让 Job 执行时自己查。
- **长任务加 @DisallowConcurrentExecution**：持久化触发器在上次没跑完时也可能到点触发，不加注解同一 Job 会并发执行。
- **集群时钟必须同步**：JDBC 行锁依赖时间判断 misfire，实例间时钟漂移会造成触发错乱——NTP 是前提。
- **misfire 策略要显式选**：错过触发点是"补跑一次"还是"等下一次"因业务而异（`withMisfireHandlingInstructionFireAndProceed` vs `DoNothing`），默认行为未必是你想要的。

### 延伸阅读

- 官方镜像：`spring-boot-4.1.1-docs/reference/io/quartz.md`（JobStore/数据源/属性透传/Job 注入全文）
- 站内：[批处理：Spring Batch](/practice/batch)（调度触发批任务的组合）、[虚拟线程深度实践](/practice/virtual-threads)（@Scheduled 与调度的分工）

::: info 官方出处
- Starter 与自动拾取/持久化/集群：`spring-boot-4.1.1-docs/reference/io/quartz.md` 全文
- Job setter 注入示例原文：同文件 Java/Kotlin 双栏
:::
