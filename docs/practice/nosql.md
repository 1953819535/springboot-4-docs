---
title: NoSQL 数据访问
description: Spring Boot 4.1.1 NoSQL 全家桶：MongoDB/Cassandra/Neo4j/Elasticsearch/Couchbase/LDAP 选型对照、starter 坐标与连接配置，重点展开 MongoDB 实体、仓储与 MongoTemplate。
official: https://docs.spring.io/spring-boot/4.1.1/reference/data/nosql.html
---

# NoSQL 数据访问

> Redis 缓存用法在[缓存实战](/practice/caching)中已讲，本章聚焦其余 NoSQL。

**本章你会学到：**

- Spring Boot 支持的 NoSQL 全家桶定位与选型：MongoDB、Cassandra、Neo4j、Elasticsearch、Couchbase、LDAP
- 各技术对应的 starter 坐标与连接配置键（`spring.mongodb.*`、`spring.elasticsearch.*`、`spring.neo4j.*` 等）
- 重点上手 MongoDB：`@Document` 实体、方法名派生查询的 Repository、`MongoTemplate`
- Elasticsearch Repository 方法名派生查询的最小示例
- NoSQL 与关系型数据库的选型对照思路，以及企业落地四大避坑

> **上一章**：[缓存：Caffeine 与 Redis](/practice/caching) · **下一章**：[批处理：Spring Batch](/practice/batch)

## 业务场景

- 订单宽表字段花样百出（不同品类字段不同），关系型表改一次加一列，想换成**文档模型**；
- 商品搜索要做全文检索与聚合分析，SQL `LIKE '%x%'` 慢得不可接受；
- 用户的好友推荐、社团关系需要**多跳查询**，关系型要写五六层自连接；
- 海量写入的设备上报数据，需要**线性水平扩展**。

这些问题催生了对 NoSQL 的选型需求。Spring Data 为多种 NoSQL 提供了统一编程模型，Spring Boot 又为其中大多数提供了[自动配置](/glossary#自动配置auto-configuration)——掌握"定位 + starter + 连接键"三要素，切换存储的心智成本极低。

## 极简实现（以 MongoDB 为例）

MongoDB 是使用 JSON 类文档模式的开源 NoSQL 文档数据库。引入 starter，写出实体、仓储、模板三层，十几行即可跑通：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-mongodb</artifactId>
</dependency>
```

```java
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

// @Document 标注持久化到 MongoDB 集合（collection），缺省集合名为类名首字母小写
@Document
public class City {

    @Id                 // 主键，映射 _id
    private Long id;

    private String name;

    private String state;

    // 构造器与 getter 省略
    public City(Long id, String name, String state) {
        this.id = id;
        this.name = name;
        this.state = state;
    }
    public Long getId() { return id; }
    public String getName() { return name; }
    public String getState() { return state; }
}
```

```java
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.repository.Repository;

// 与 Spring Data JPA 共享同一套仓储基础设施，方法名即查询：
// findByNameAndStateAllIgnoringCase → {"name": x, "state": y} 的忽略大小写组合查询
public interface CityRepository extends Repository<City, Long> {

    Page<City> findAll(Pageable pageable);

    City findByNameAndStateAllIgnoringCase(String name, String state);
}
```

```java
import com.mongodb.client.MongoCollection;
import org.bson.Document;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.stereotype.Component;

@Component
public class CityDao {

    private final MongoTemplate mongoTemplate;

    public CityDao(MongoTemplate mongoTemplate) {
        this.mongoTemplate = mongoTemplate;   // 设计对标 JdbcTemplate，Boot 已自动配置，直接注入
    }

    // 复杂查询不走方法名派生，直接用 MongoTemplate 手写条件
    public MongoCollection<Document> rawUsers() {
        return mongoTemplate.getCollection("users");
    }
}
```

启动时[自动配置](/glossary#自动配置auto-configuration)尝试连接 `mongodb://localhost/test`，其余什么都不用配。仓储与文档默认扫描**自动配置包**，需要自定义位置时用 `@EnableMongoRepositories`（仓储）与 `@EntityScan`（文档）。

::: tip
如果你不用 Spring Data MongoDB，也可以直接注入原生 `MongoClient`；定义了自己的 `MongoClientSettings` [Bean](/glossary#bean) 时 `spring.data.mongodb` 属性将被忽略。
:::

## 关键注解与配置

### NoSQL 全家桶选型总览

Spring Data 覆盖的 NoSQL 中，Spring Boot 为 **Cassandra、Couchbase、Elasticsearch、LDAP、MongoDB、Neo4j、Redis** 提供自动配置（Apache Geode 由独立项目 Spring Boot for Apache Geode 提供），其余项目可用但需自行配置。

| 技术 | 定位一句话 | 典型场景 | starter 坐标 |
| --- | --- | --- | --- |
| MongoDB | JSON 类文档数据库，模式灵活 | 订单宽表、内容管理、用户画像 | `spring-boot-starter-data-mongodb`（响应式：`spring-boot-starter-data-mongodb-reactive`） |
| Elasticsearch | 分布式 RESTful 搜索与分析引擎 | 全文检索、日志分析、聚合统计 | `spring-boot-starter-data-elasticsearch`（纯客户端用 `spring-boot-starter-elasticsearch`） |
| Cassandra | 分布式数据库，跨大量普通服务器存海量数据 | 设备时序、写入密集型流水 | `spring-boot-starter-data-cassandra` |
| Neo4j | 图数据库，节点 + 一等公民关系，比 RDBMS 更适合关联大数据 | 社交关系、风控图谱、推荐多跳 | `spring-boot-starter-data-neo4j` |
| Couchbase | 分布式多模型文档数据库，为交互式应用优化 | 高读写低延迟在线业务 | `spring-boot-starter-data-couchbase`（响应式：`spring-boot-starter-data-couchbase-reactive`） |
| LDAP | 轻量目录访问协议，访问分布式目录信息服务 | 组织架构、统一账号认证 | `spring-boot-starter-data-ldap` |
| Redis | 缓存、消息代理与功能丰富的键值存储 | 缓存、分布式锁、计数器 | `spring-boot-starter-data-redis`（响应式：`spring-boot-starter-data-redis-reactive`） |

> Redis 的缓存实战见[缓存](/practice/caching)，本章不再展开。

### 连接配置键速查

各存储的连接属性前缀不同，**以语料/附录原文为准**，常用的如下（YAML 写法同层级）：

```yaml
spring:
  mongodb:                        # 注意 4.1.1 中 MongoDB 连接键位于 spring.mongodb（非 spring.data.mongodb）
    uri: mongodb://user:pass@mongoserver1.example.com:27017,mongoserver2.example.com:23456/test
    ssl:
      enabled: true               # 也可用 ssl.bundle 引用 SSL bundle
  elasticsearch:
    uris: https://search.example.com:9200
    username: user
    password: secret
    socket-timeout: 10s
  neo4j:
    uri: bolt://my-server:7687    # 默认 localhost:7687，Bolt 协议
    authentication:
      username: neo4j
      password: secret
  cassandra:
    keyspace-name: mykeyspace
    contact-points: cassandrahost1:9042,cassandrahost2:9042   # 端口默认 9042
    local-datacenter: datacenter1
  couchbase:
    connection-string: couchbase://192.168.1.123
    username: user
    password: secret
  data:
    couchbase:
      bucket-name: my-bucket      # bucket 归属 spring.data.couchbase
  ldap:
    urls: ldap://myserver:1235
    username: admin
    password: secret
```

MongoDB 也可以不写 URI、改用离散属性：`spring.mongodb.host`、`spring.mongodb.port`、`spring.mongodb.additional-hosts[0]`、`spring.mongodb.database`、`spring.mongodb.username`、`spring.mongodb.password`。URI 与离散属性二选一，企业环境推荐 URI + 环境变量注入。

各存储的高级定制入口：MongoDB 用 `MongoClientSettingsBuilderCustomizer`，Neo4j 用 `ConfigBuilderCustomizer`，Cassandra 用 `DriverConfigLoaderBuilderCustomizer`/`CqlSessionBuilderCustomizer`，Elasticsearch 用 `Rest5ClientBuilderCustomizer`——均为"声明一个 [Bean](/glossary#bean) 即生效"。

### MongoDB 深入：从仓储到 MongoTemplate

`MongoTemplate` 与 Spring 的 `JdbcTemplate` 设计同源，Boot [自动配置](/glossary#自动配置auto-configuration)好 Bean 供注入，覆盖 CRUD、聚合、地图Reduce式复杂操作；日常单表语义用方法名派生的 Repository，跨集合或动态条件落回 Template。两种风格在同一段代码里混用毫无障碍。

**响应式一句话**：若技术栈是 WebFlux，把 starter 换成 `spring-boot-starter-data-mongodb-reactive`，即可注入 `ReactiveMongoTemplate` 并声明返回 `Mono`/`Flux` 的响应式仓储——编程模型不变，返回类型换成响应式流。注意响应式驱动走 SSL 需要 Netty，Boot 会在 classpath 有 Netty 且未自定义时自动配好。

```yaml
# application.yaml —— 生产 MongoDB 最小配置
spring:
  mongodb:
    uri: ${MONGODB_URI}   # 凭据从环境变量注入，禁止硬编码
```

### Elasticsearch：客户端与仓储

Spring Boot 支持三种 Elasticsearch 客户端：官方低层 REST 客户端（`elasticsearch-rest5-client`）、官方 Java API 客户端（`elasticsearch-java`，[自动配置](/glossary#自动配置auto-configuration) `ElasticsearchClient`）、以及 Spring Data Elasticsearch 提供的响应式 `ReactiveElasticsearchClient`。默认目标 `localhost:9200`，用 `spring.elasticsearch.*` 属性调整；还可自动配置 `Sniffer` 自动发现集群节点（`spring.elasticsearch.restclient.sniffer.enabled=true`）。

仓储用法与 JPA 同构，实体改用 `@Document` 注解，查询按方法名派生：

```java
import org.springframework.data.elasticsearch.annotations.Document;
import org.springframework.data.repository.Repository;

@Document(indexName = "cities")
public record CitySummary(String id, String name, String state) {
}

// 方法名派生：findByState → term 查询 state 字段
public interface CitySummaryRepository extends Repository<CitySummary, String> {
    Iterable<CitySummary> findByState(String state);
}
```

如需关闭 Elasticsearch 仓储支持，设 `spring.data.elasticsearch.repositories.enabled=false`。

### Neo4j / Cassandra / LDAP：什么场景选它

**Neo4j——关系即数据**。数据的价值在"节点之间的关系"时选它：社交好友推荐（好友的好友喜欢什么）、反欺诈风控（担保环、资金链路）、知识图谱。节点用 `@Node` 标注，仓储继承 `Neo4jRepository`，方法名派生照样可用；starter 同时启用仓储与事务管理，经典与响应式两种风格都支持（响应式事务管理器需手动声明 `ReactiveNeo4jTransactionManager` [Bean](/glossary#bean)）。

```java
import org.springframework.data.neo4j.repository.Neo4jRepository;

public interface CityRepository extends Neo4jRepository<City, Long> {

    City findOneByNameAndState(String name, String state);
}
```

**Cassandra——为海量写入而生**。数据量跨众多廉价服务器线性扩展、写入吞吐优先、按分区键查询即可满足时选它：设备上报、埋点流水、消息存档。注意它的仓储**比 JPA 有限**，查找方法需要 `@Query` 注解写 CQL；连接必填 `keyspace-name`、`contact-points` 与 `local-datacenter` 三件套。

**LDAP——目录服务标准协议**。需要读取/维护组织架构、做统一身份认证对接（Active Directory、OpenLDAP）时选它。`LdapContextSource` 按配置自动装配，`LdapTemplate` 直接注入 `findAll(User.class)`；测试场景可加 `com.unboundid:unboundid-ldapsdk` 依赖并设 `spring.ldap.embedded.base-dn` 启动内嵌内存 LDAP 服务器（classpath 放 `schema.ldif` 即可初始化数据）。

### 与关系型选型对照

| 决策点 | 关系型（JPA/JDBC） | NoSQL |
| --- | --- | --- |
| 数据结构 | 结构固定，Schema 先行 | 文档/键值/图/列簇，模式灵活 |
| 一致性 | 强事务、ACID 完备 | 多为最终一致，事务能力各异（见避坑 2） |
| 扩展方式 | 纵向为主 + 读写分离/分库分表 | 天然分片、线性水平扩展 |
| 查询能力 | SQL 全能、复杂 JOIN | 各有所长：Mongo 查文档、ES 查全文、Neo4j 查关系 |
| 选型口诀 | 默认起点：业务核心账务、强一致 | **按查询形态选库**：全文检索→ES，文档宽表→Mongo，多跳关系→Neo4j，海量写→Cassandra |

企业实践多为组合拳：账务与订单主链路留在关系型（见[关系型数据访问](/practice/data-access)），商品搜索交 ES、会话缓存交 Redis、行为画像交 Mongo——各取所长。

::: warning
不要为了"技术时髦"引入 NoSQL。每多一个存储组件，就多一份运维、备份、监控与数据一致性成本。先用关系型建模，遇到明确的查询形态瓶颈再做针对性引入。
:::

## 避坑指南

1. **连接 URI 凭据硬编码进仓库**。`spring.mongodb.uri=mongodb://admin:123456@...` 提交进 Git 等于裸奔，LDAP/Neo4j/Couchbase 的 `password` 同理。一律走环境变量或配置中心占位符（`${MONGODB_URI}`），生产再叠加网络隔离与 SSL bundle；各存储都支持 `ssl.enabled`/`ssl.bundle` 引用统一证书。

2. **默认假设"NoSQL 没有事务"与反向假设"跨库也有事务"都危险**。MongoDB 4.0+ 在副本集下支持多文档事务但需显式启用、有性能成本；Cassandra仓储有限、本质偏最终一致；Neo4j starter 启用了事务管理但响应式风格要手动声明事务管理器 [Bean](/glossary#bean)。结论：跨文档/跨集合的强一致关键路径要么留在关系型，要么逐存储确认事务语义后再设计，切勿想当然。

3. **查询字段没建索引，全表扫描拖垮集群**。MongoDB 的方法名派生查询不会自动建索引，`findByNameAndStateAllIgnoringCase` 上线即 COLLSCAN。为高频查询字段手工建索引（`@Indexed`/`@CompoundIndex` 或脚本），并用 `explain` 验证；Cassandra 更严格——查询必须贴合分区键设计，先设计表再写查询。

4. **测试直连共享开发库，数据互相污染**。NoSQL 的集成测试用 **[Testcontainers](/glossary#testcontainers)** 拉起一次性 MongoDB/Elasticsearch 容器，配合 `@ServiceConnection` 自动注入连接属性，测试结束即销毁；LDAP 则优先用内嵌内存服务器（UnboundID + `spring.ldap.embedded.base-dn`），比真容器更快。

5. **URI 里写死主机与拓扑，换环境全崩**。副本集成员列表、数据中心名（`local-datacenter`）、bucket 名散落在各环境配置里互不一致，是 NoSQL 事故高发区。按 profile 分层：`application-prod.yaml` 只放环境变量占位符，真实拓扑由部署平台注入；Cassandra 连接必三查 `keyspace-name`/`contact-points`/`local-datacenter`。

6. **以为引了 starter 就万事俱备，属性前缀却张冠李戴**。MongoDB 连接键是 `spring.mongodb.*`，bucket 名却是 `spring.data.couchbase.bucket-name`；把 Redis 键写成 `spring.redis.*`（缺 `data`）在 4.x 会静默失效。属性键以本章速查表与官方附录为准，启动后用 `/actuator/configprops` 核对实际绑定值。

### 延伸阅读

- 官方文档：[reference/data/nosql](https://docs.spring.io/spring-boot/4.1.1/reference/data/nosql.html)（工作区语料，含全部存储的连接属性示例）
- 官方原文：[Working with NoSQL Technologies](https://docs.spring.io/spring-boot/4.1.1/reference/data/nosql.html)
- 站内相关：[关系型数据访问](/practice/data-access) ｜ [缓存实战（Redis）](/practice/caching) ｜ [测试策略（Testcontainers）](/advanced/testing)
