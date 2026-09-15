---
title: "数据访问实践"
description: "Spring Boot 4.1.1 数据访问深扩：JdbcClient 全 API 增删改查与 record 映射、JPA 企业形态（审计/Pageable/EntityGraph/投影）、事务属性与失效五坑、多数据源骨架与 [Flyway](/glossary#flyway-与数据库迁移) 规范。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/data/sql.html"
---

> **本章你会学到**
> - JdbcClient 的完整 API 面：query / update / param / record 映射 / 分页，一套流式链路写完增删改查
> - JPA 的企业形态：审计字段、Pageable 分页、`@EntityGraph` 根治 [N+1](/glossary#n1-查询)、`@Query`+`@Modifying`、interface 与 record 两种投影
> - 事务传播属性选型表（REQUIRED / REQUIRES_NEW / NESTED）与事务失效五坑（每个带最小反例）
> - 两个数据源 + 两个事务管理器的配置类骨架（含 Boot 4 的 `defaultCandidate=false` 关键写法）
> - Flyway 版本化迁移规范与生产配置，外加 7 条数据层避坑
>
> **上一章**：[消息：Kafka、AMQP 与 JMS](/practice/messaging) · **下一章**：[缓存：Caffeine 与 Redis](/practice/caching)

## 业务场景

::: tip 术语速览
**ORM**：对象↔数据库表的映射，操作对象即操作数据（Hibernate 是实现，JPA 是标准接口）。**[懒加载](/glossary#懒加载lazy-loading)**：关联数据第一次访问才发 SQL——省资源，但可能引发 **N+1**（查 1 次列表 + 每行各查 1 次关联 = 1+N 条 SQL）。**[DTO](/glossary#dto)**：层间搬运数据的 record 对象，不把数据库 Entity 直接暴露给接口。更多见 [核心概念速查](/glossary)。
:::


一个中台服务同时面对三类数据访问需求：

- 报表查询要求 SQL 可控、返回只读结果——ORM 反而累赘，需要轻量直查；
- 订单/客户主数据要经得起多人维护——需要 JPA 的变更跟踪、审计字段和仓储抽象；
- 对账逻辑必须"要么全成、要么全不加"——需要可控的事务边界；此外还要从老库抽数，天然出现**多数据源**。

Spring Boot 的选型答案：**简单直查用 `JdbcClient`（Framework 6.1+ 引入，Boot [自动配置](/glossary#自动配置auto-configuration)），复杂领域模型用 Spring Data JPA，两者共存于同一个连接池之上并不冲突。** 连接池默认 [HikariCP](/glossary#连接池hikaricp)——语料口径："We prefer HikariCP for its performance and concurrency. If HikariCP is available, we always choose it."

### 极简选型表

| 需求 | 选型 | 理由 |
| --- | --- | --- |
| 报表、聚合查询、批量导数 | JdbcClient | SQL 所见即所得，零魔法，record 直接收 |
| 领域模型 + 增删改查 + 审计 | Spring Data JPA | 方法名派生查询、脏检查、审计注入 |
| 跨表强一致写 | `@Transactional` | 声明式事务边界（见事务属性表） |
| 存量库/多库 | 多数据源配置类 | Boot 4 用 `defaultCandidate=false` 并存 |

同一个"按城市查活跃用户"需求，两条路线的写法对照（服务层伪签名 `findActiveByCity(city)`）：

::: code-group
```java [JdbcClient：SQL 即代码]
public List<UserRow> findActiveByCity(String city) {
    return jdbcClient.sql("""
            SELECT id, name, email FROM users
            WHERE city = :city AND deleted = false
            ORDER BY created_at DESC
            """)
            .param("city", city)
            .query(UserRow.class)      // record 直映射，列名对齐组件名
            .list();
}
```
```java [Spring Data JPA：方法名派生]
public interface UserRepository extends JpaRepository<User, Long> {

    // 方法名即查询：派生规则解析属性链，无需写 SQL
    List<User> findByCityAndDeletedFalseOrderByCreatedAtDesc(String city);

    // 条件复杂退到 @Query，仍是对象查询
    @Query("select u from User u where u.city = :city and u.deleted = false")
    List<User> activeInCity(@Param("city") String city);
}
```
:::

对照结论：查询形状简单稳定 → JPA 派生查询代码最少；动态条件/聚合/多表 → JdbcClient 直接掌控 SQL。两者可在同一服务层混用，事务管理完全一致。

## 极简实现

### 第一步：引依赖 + 连上数据库

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
    <!-- 传递引入 spring-jdbc 与 [HikariCP](/glossary#连接池hikaricp)：JdbcClient 也能直接用 -->
</dependency>
<dependency>
    <groupId>com.h2database</groupId>
    <artifactId>h2</artifactId>
    <scope>runtime</scope>
</dependency>
```

```properties
# H2 内存库：开发期最快起跑
spring.datasource.url=jdbc:h2:mem:demo;DB_CLOSE_ON_EXIT=FALSE
spring.datasource.username=sa
spring.datasource.password=
```

语料提醒：不配 `spring.datasource.url` 时 Boot 会尝试自动配置内嵌库（H2/HSQL/Derby）；给内嵌库配了 URL 就要记得 `DB_CLOSE_ON_EXIT=FALSE`，把关闭时机交给 Boot 管。

### 第二步：JdbcClient 五分钟上手

`JdbcClient` 基于 `NamedParameterJdbcTemplate` 自动配置，直接注入即可（语料示例形态）：

```java
@Component
public class MyBean {

    private final JdbcClient jdbcClient;

    public MyBean(JdbcClient jdbcClient) {
        this.jdbcClient = jdbcClient;
    }

    public void doSomething() {
        this.jdbcClient.sql("delete from customer").update();
    }
}
```

通过 `spring.jdbc.template.max-rows=500` 等属性做的 `JdbcTemplate` 定制，会同步作用于 JdbcClient（语料口径）。第三方库想用 `JdbcTemplate` 也不冲突：`JdbcClient` 内部就是同一个实例。

## 关键注解与配置

### JdbcClient 全 API 面

从最小查询到企业分页，一套链路全覆盖：

```java
public record OrderRow(Long id, String orderNo, BigDecimal amount,
                       LocalDateTime createdAt) {}

@Repository
public class OrderQueryDao {

    private final JdbcClient jdbc;

    public OrderQueryDao(JdbcClient jdbcClient) {
        this.jdbc = jdbcClient;
    }

    // 1) 单行查询 → record 映射（按列名自动装配）
    public Optional<OrderRow> findByOrderNo(String orderNo) {
        return jdbc.sql("select id, order_no, amount, created_at from orders where order_no = :no")
                .param("no", orderNo)
                .query(OrderRow.class)
                .optional();
    }

    // 2) 多行查询 → List<record>
    public List<OrderRow> findByCustomer(Long customerId) {
        return jdbc.sql("""
                select id, order_no, amount, created_at
                from orders where customer_id = :cid order by created_at desc
                """)
                .param("cid", customerId)
                .query(OrderRow.class)
                .list();
    }

    // 3) 分页：limit/offset 由数据库方言书写，count 单独一条
    public List<OrderRow> page(long customerId, int page, int size) {
        return jdbc.sql("""
                select id, order_no, amount, created_at from orders
                where customer_id = :cid order by created_at desc
                limit :size offset :offset
                """)
                .param("cid", customerId)
                .param("size", size)
                .param("offset", page * size)
                .query(OrderRow.class)
                .list();
    }

    public long countByCustomer(long customerId) {
        return jdbc.sql("select count(*) from orders where customer_id = :cid")
                .param("cid", customerId)
                .query(Long.class)   // 单值映射
                .single();
    }

    // 4) 插入：update() 返回受影响行数
    public int insert(String orderNo, BigDecimal amount) {
        return jdbc.sql("insert into orders(order_no, amount) values(:no, :amt)")
                .param("no", orderNo)
                .param("amt", amount)
                .update();
    }

    // 5) 更新 / 删除同构：sql → param → update
    public int markPaid(String orderNo, BigDecimal paidAmount) {
        return jdbc.sql("update orders set amount = :amt, status = 'PAID' where order_no = :no")
                .param("amt", paidAmount)
                .param("no", orderNo)
                .update();
    }
}
```

API 心法：`sql(...)` 返回的规范实例只有两条出口——**读走 `query(...)`、写走 `update()`**；`query` 之后再按结果形态选 `.single()` / `.optional()` / `.list()`。

### JPA 企业形态

**实体 + 审计字段（`@EnableJpaAuditing` + `@EntityListeners`）**——语料示例模式：`@Id @GeneratedValue` + 受保护的无参构造：

```java
import jakarta.persistence.Entity;
import jakarta.persistence.EntityListeners;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import java.math.BigDecimal;
import java.time.LocalDateTime;
import org.springframework.data.annotation.CreatedBy;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedBy;
import org.springframework.data.annotation.LastModifiedDate;
import org.springframework.data.jpa.domain.support.AuditingEntityListener;

@Entity
@EntityListeners(AuditingEntityListener.class)   // 审计由监听器自动填充
public class Order {

    @Id
    @GeneratedValue
    private Long id;

    private String orderNo;
    private BigDecimal amount;

    @CreatedDate      private LocalDateTime createdAt;
    @CreatedBy        private String createdBy;
    @LastModifiedDate private LocalDateTime updatedAt;
    @LastModifiedBy   private String updatedBy;

    protected Order() {
        // JPA 规范要求的无参构造；protected 防止业务代码误用
    }

    public Order(String orderNo, BigDecimal amount) {
        this.orderNo = orderNo;
        this.amount = amount;
    }
    // getter 略；状态变更语义写成实体方法，而不是 service 里 set 字段
}
```

启动类或配置类上开启审计并提供当前用户：

```java
@Configuration
@EnableJpaAuditing
public class JpaAuditingConfig {
    @[Bean](/glossary#bean)
    public AuditorAware<String> auditor() {
        return () -> Optional.of("system"); // 生产中从登录态取当前用户
    }
}
```

**Repository + Pageable 分页**（方法名派生查询，语料示例口径）：

```java
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.repository.Repository;

public interface OrderRepository extends Repository<Order, Long> {

    Page<Order> findByCustomerId(Long customerId, Pageable pageable);

    Order findByNameAndStateAllIgnoringCase(String name, String state); // 语料示例方法名风格
}

// 使用：按创建时间倒序取第 0 页、每页 20 条
Page<Order> page = repository.findByCustomerId(42L,
        PageRequest.of(0, 20, Sort.by(Sort.Direction.DESC, "createdAt")));
```

**`@EntityGraph` 根治 N+1**——查订单列表时每单再发一条 SQL 查明细，就是经典 N+1：

```java
public interface OrderRepository extends Repository<Order, Long> {

    // 不加 EntityGraph：1 条查订单 + N 条查明细 = [N+1](/glossary#n1-查询)
    @EntityGraph(attributePaths = {"items"})   // 一次 left join 带回明细
    Page<Order> findByCustomerId(Long customerId, Pageable pageable);
}
```

**`@Query` + `@Modifying` 写复杂更新**：

```java
public interface OrderRepository extends Repository<Order, Long> {

    @Query("select o from Order o where o.amount > :min and o.status = 'PAID'")
    List<Order> findBigPaidOrders(@Param("min") BigDecimal min);

    @Modifying            // 声明这是写操作（update/delete）
    @Query("update Order o set o.status = 'CLOSED' where o.createdAt < :deadline")
    int closeStaleOrders(@Param("deadline") LocalDateTime deadline);
}
```

**两种投影**——interface 投影按 getter 约定取列，record 投影整块构造：

```java
// ① interface 投影：只声明需要的 getter，框架按 getter 名取对应列，不查多余字段
public interface OrderSummary {
    String getOrderNo();
    BigDecimal getAmount();
}

// 查询方法直接返回投影类型
List<OrderSummary> summariesByCustomer(Long customerId);

// ② record 投影（类级）：
public record OrderBrief(String orderNo, BigDecimal amount) {}

@Query("select new com.example.OrderBrief(o.orderNo, o.amount) from Order o where o.customerId = :cid")
List<OrderBrief> briefsOf(@Param("cid") Long cid);
```

### 事务属性表与失效五坑

传播行为选型（最常用的三档）：

| 传播属性 | 语义 | 典型场景 |
| --- | --- | --- |
| `REQUIRED`（默认） | 有事务就加入，没有就新建 | 绝大多数业务写操作 |
| `REQUIRES_NEW` | 挂起当前事务，另起新事务 | 操作日志/审计流水：不管主事务成败都要落库 |
| `NESTED` | 在当前事务内开保存点，可独立回滚到保存点 | 批量导入：单条失败回滚该条，整体仍可继续 |

其他关键属性：

| 属性 | 写法 | 说明 |
| --- | --- | --- |
| `readOnly` | `@Transactional(readOnly = true)` | 纯读方法声明只读，给驱动/优化器留空间；写方法勿加 |
| `rollbackFor` | `@Transactional(rollbackFor = Exception.class)` | 默认只对 RuntimeException/Error 回滚；受检异常需显式声明 |
| timeout | `@Transactional(timeout = 5)` | 慢 SQL 兜底，防长事务拖垮连接池 |

**事务失效五坑（每个最小反例）**——失效 = `@Transactional` 没起作用，改动直接提交：

```java
// 坑1：同类内部调用——绕过代理，注解形同虚设
@Service
public class OrderService {
    public void create() {
        this.audit();            // ❌ 直接 this 调用，不经过代理
    }
    @Transactional
    public void audit() { ... }
    // ✅ 解法：注入自身代理 self.audit()；或把 audit() 挪到另一个 [Bean](/glossary#bean)
}

// 坑2：方法不是 public——代理不为非 public 方法织入事务
@Transactional
protected void settle() { ... }  // ❌ protected/包私有失效；✅ 改 public

// 坑3：默认策略下受检异常不回滚
@Transactional
public void importBatch() throws Exception {
    throw new Exception("biz fail");  // ❌ 受检异常默认照常提交
    // ✅ rollbackFor = Exception.class，或改抛 RuntimeException
}

// 坑4：异常被 try-catch 吞掉，事务看不到
@Transactional
public void pay() {
    try {
        doDeduct();
    } catch (Exception e) {
        log.error("failed", e);   // ❌ 吞掉异常 = 告诉事务"一切正常"
    }
    // ✅ 要么继续抛出，要么 TransactionAspectSupport 手动标记回滚
}

// 坑5：库引擎/数据源不支持事务，或自建 DataSource 未被事务管理器管理
//      自定义 DataSource Bean 后必须配套声明事务管理器，否则注解无对象可管
```

### 深入：多数据源配置骨架

需求：主库走 Boot 自动配置，老库 `second` 并存。Boot 4 的关键是 **`@Bean(defaultCandidate = false)`**——额外数据源不参与默认候选，避免与自动配置的 DataSource 抢位（语料原文："This prevents the auto-configured DataSource from backing off"），注入处用 `@Qualifier` 点名：

```java
import com.zaxxer.hikari.HikariDataSource;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.jdbc.DataSourceBuilder;
import org.springframework.context.annotation.[Bean](/glossary#bean);
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class SecondDataSourceConfiguration {

    @Qualifier("second")
    @Bean(defaultCandidate = false)
    @ConfigurationProperties("app.datasource")
    public HikariDataSource secondDataSource() {
        return DataSourceBuilder.create().type(HikariDataSource.class).build();
    }
}
```

```properties
# 主库：走 spring.datasource.*（自动配置）
spring.datasource.url=jdbc:mysql://localhost/main
spring.datasource.username=dbuser
spring.datasource.password=dbpass
# 老库：走 app.datasource.*
app.datasource.url=jdbc:mysql://localhost/legacy
app.datasource.username=dbuser
app.datasource.password=dbpass
```

JPA 多库还需各配一套 EntityManagerFactory + 事务管理器，仓储用 `@EnableJpaRepositories` 按实体包分家（语料 Multiple EntityManagerFactories 节骨架）：

```java
@Configuration(proxyBeanMethods = false)
@EnableJpaRepositories(basePackageClasses = Customer.class,          // 老库仓储包
        entityManagerFactoryRef = "secondEntityManagerFactory",
        transactionManagerRef = "secondTransactionManager")
public class SecondJpaConfiguration {

    @Qualifier("second")
    @[Bean](/glossary#bean)(defaultCandidate = false)
    public LocalContainerEntityManagerFactoryBean secondEntityManagerFactory(
            @Qualifier("second") DataSource dataSource, @Qualifier("second") JpaProperties jpaProperties) {
        EntityManagerFactoryBuilder builder =
                new EntityManagerFactoryBuilder(new HibernateJpaVendorAdapter(), jpaProperties.getProperties(), null);
        return builder.dataSource(dataSource).packages(Customer.class).persistenceUnit("second").build();
    }

    @Qualifier("second")
    @Bean(defaultCandidate = false)
    public JpaTransactionManager secondTransactionManager(
            @Qualifier("second") EntityManagerFactory emf) {
        return new JpaTransactionManager(emf);
    }
}
// 主库同理：@EnableJpaRepositories 指向 entityManagerFactory/transactionManager [自动配置](/glossary#自动配置auto-configuration) Bean
```

要点三条：① 额外 Bean 一律 `defaultCandidate = false` + `@Qualifier`；② 事务管理器与 EntityManagerFactory 一一对应，`@Transactional` 跨不了两个库——真要跨库一致，需上 JTA（语料口径）；③ 仓储按实体包严格分家，防止扫描错库。

### 深入：Flyway 版本化迁移

`spring-boot-starter-data-jpa` 场景下，`spring.jpa.hibernate.ddl-auto` 默认仅对内嵌库生效（`create-drop`）；生产一律交给 Flyway 管 schema，Hibernate 只管映射：

```properties
spring.jpa.hibernate.ddl-auto=validate   # 校验映射与表结构一致
spring.jpa.open-in-view=false            # 关闭 OSIV：视图层惰性加载是 [N+1](/glossary#n1-查询) 隐患
```

迁移脚本放 `src/main/resources/db/migration`，命名规则 `V<版本>__<描述>.sql`（双下划线）：

```text
db/migration/
├── V1__init_order_schema.sql
├── V2__add_order_auditing.sql
└── R__refresh_order_stats.sql     # R 前缀 = 可重复执行迁移
```

```sql
-- V1__init_order_schema.sql
create table orders (
    id         bigint generated by default as identity primary key,
    order_no   varchar(32) not null unique,
    amount     decimal(12,2) not null,
    created_at timestamp default current_timestamp
);
```

常用键与默认值（摘自官方附录）：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `spring.flyway.enabled` | `true` | 是否启用 |
| `spring.flyway.locations` | — | 脚本位置，支持 `{vendor}` 占位 |
| `spring.flyway.clean-disabled` | `true` | 禁用 clean，防误清库（生产必须 true） |
| `spring.flyway.validate-on-migrate` | `true` | 迁移前校验校验和 |
| `spring.flyway.baseline-on-migrate` | `false` | 对非空存量库先做基线再迁移 |
| `spring.flyway.out-of-order` | `false` | 是否允许乱序执行 |
| `spring.flyway.table` | `flyway_schema_history` | 历史表名 |
| `spring.flyway.url` / `user` / `password` | — | 不设则用主数据源 |

多实例同时启动不慌：Flyway 自带锁机制（`lock-retry-count` 默认 50）保证迁移并发安全。

### 配置速查

| 键 | 说明 | 默认值 |
| --- | --- | --- |
| `spring.datasource.hikari.maximum-pool-size` | 池最大连接数 | 按数据库承载力调 |
| `spring.datasource.hikari.leak-detection-threshold` | 连接泄漏检测阈值 | 生产建议开启 |
| `spring.datasource.hikari.connection-timeout` | 借连接等待上限 | 超时抛 SQLException |
| `spring.jpa.hibernate.ddl-auto` | DDL 模式 | 内嵌库 `create-drop`，否则 `none` |
| `spring.jpa.open-in-view` | OSIV 开关 | `true`（建议显式关闭） |
| `spring.jpa.show-sql` | 控制台打印 SQL | `false` |
| `spring.jdbc.template.max-rows` | JdbcTemplate/JdbcClient 行数上限 | 同步作用于 JdbcClient |

::: warning Flyway clean 是生产红线
`spring.flyway.clean-disabled` 默认已禁用 clean 命令，这是官方故意的——clean 会删库。任何环境都不要打开它；需要重建库就用重建环境，而不是 clean + 重跑迁移。
:::

## 避坑指南

1. **OSIV 默认开着，事务边界名存实亡** —— `spring.jpa.open-in-view` 默认 `true`，视图渲染期间连接被占，连接池高峰期直接被打穿。显式关掉，惰性加载在 service 层取完再返回 DTO。
2. **`ddl-auto` 留在生产** —— 内嵌库默认 `create-drop` 没问题，生产沿用就是"重启丢表/乱建表"事故；生产铁律 `validate` + Flyway 管变更。
3. **N+1 靠肉眼难发现** —— 列表页一条 SQL，渲染时每行再查一次；用 `@EntityGraph` 或 fetch join 解决，配合 `show-sql` 在开发期数 SQL 条数。
4. **`@Transactional` 打在类内被自己调用的方法上** —— 事务靠代理织入，自调用直接绕过（见失效五坑坑 1）；拆 Bean 或注自身代理。
5. **受检异常导致"没回滚"错觉** —— 默认只回滚 RuntimeException/Error；业务上想"任何异常都回滚"就写 `rollbackFor = Exception.class`。
6. **多数据源只建了 DataSource 没配事务管理器** —— 老库写操作没有对应 `JpaTransactionManager`/`DataSourceTransactionManager` 时，注解事务无对象可管；每个库一套 EMF + TM，仓储按包分家。
7. **Flyway 脚本迁移后回改** —— 历史表记录了校验和，已应用的 `V2` 改一个字符启动就报校验失败；错了就写 `V3` 修正，而不是改 `V2`（团队协作时尤其致命）。
8. **Hikari 池大小拍脑袋** —— 池不是越大越好：连接过多会把压力转嫁给数据库；`leak-detection-threshold` 开起来，用监控数据定池大小。

### 延伸阅读

- 官方镜像：`spring-boot-4.1.1-docs/reference/data/sql.md`（JdbcClient / JPA / 连接池）、`how-to/data-access.md`（自定义与多数据源、Multiple EntityManagerFactories）、`appendix/application-properties/index.md`（spring.datasource.hikari.* / spring.jpa.* / spring.flyway.*）
- 官方在线：[SQL Databases](https://docs.spring.io/spring-boot/4.1.1/reference/data/sql.html) · [How-to: Data Access](https://docs.spring.io/spring-boot/4.1.1/how-to/data-access.html)
- 站内：[[虚拟线程](/glossary#虚拟线程-vs-平台线程)深度实践](/practice/virtual-threads)（连接池并发匹配）· [消息：Kafka、AMQP 与 JMS](/practice/messaging)（上一章）· [缓存：Caffeine 与 Redis](/practice/caching)（下一章）
