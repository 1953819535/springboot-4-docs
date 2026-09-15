---
title: "缓存：Caffeine 与 Redis"
description: "Spring Boot 4.1.1 缓存完整指南：@Cacheable/@CacheEvict 与 SpEL key 设计、Caffeine spec 全参数、Redis 缓存 TTL 差异化与 JSON 序列化、缓存一致性与穿透雪崩"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/io/caching.html"
---

# 缓存：Caffeine 与 Redis

**本章你会学到：**

- 缓存抽象的开启姿势与 provider 自动选择顺序
- `@Cacheable` / `@CachePut` / `@CacheEvict` 与 SpEL key、`unless` / `condition` 条件缓存
- `@CacheConfig` 类级抽取重复配置
- Caffeine spec 全参数表：容量、过期、刷新三组参数怎么配
- Redis 缓存 TTL 按缓存名差异化、JSON 序列化完整配置
- 缓存一致性策略：先更库后删缓存、短 TTL 兜底、什么时候不该用缓存

> 上一步：[数据访问与事务](/practice/data-access) ｜ 下一步：[安全与鉴权](/advanced/security)

> **上一章**：[数据访问与事务](/practice/data-access) · **下一章**：[NoSQL：MongoDB 与更多](/practice/nosql)

## 业务场景

商品详情页每次打开都查三次数据库，大促期间数据库 CPU 直奔 100%。这类**读多写少、计算或查询成本高、对实时性不敏感**的数据，是最典型的缓存受益场景：把结果暂存在更快的存储层，用数据新鲜度换访问速度。

第一道选型题是本地缓存还是分布式缓存：

| 维度 | Caffeine（本地） | Redis（分布式） |
| --- | --- | --- |
| 访问延迟 | 纳秒级，纯内存 | 毫秒级，网络往返 |
| 数据共享 | 各实例独立，互不共享 | 多实例共享一份 |
| 容量 | 受单机内存限制 | 可水平扩展 |
| 适用 | 热点数据、配置项、枚举映射 | 会话、库存、跨节点共享数据 |

生产最常见的组合是 **Caffeine 做一级、Redis 做二级**：一级挡住热点读，二级保证多实例一致性与容量——多级缓存各自只做一层的事，读写路径保持简单，别在应用里手写复杂的级联逻辑。

## 极简实现

### 开启缓存抽象

Spring Boot 检测到缓存依赖并启用 `@EnableCaching` 后，缓存基础设施自动配置。注意官方提示：**不要**把 `@EnableCaching` 加在主应用类上——那会让缓存成为强制特性（跑测试也被迫初始化），放到独立配置类：

```java
@Configuration(proxyBeanMethods = false)
@EnableCaching
public class CacheConfiguration {
}
```

依赖用 `spring-boot-starter-cache`；再加 `com.github.ben-manes.caffeine:caffeine` 自动切换为 Caffeine，加 `spring-boot-starter-data-redis`（默认 Lettuce 客户端）切换为 Redis。

### 给方法加注解

```java
@Service
public class ProductService {

    @Cacheable(cacheNames = "products", key = "#id")
    public Product getProduct(Long id) {
        // 缓存未命中才执行；命中直接返回缓存值，方法体不进
        return loadFromDatabase(id);
    }

    @CachePut(cacheNames = "products", key = "#product.id")
    public Product updateProduct(Product product) {
        // 始终执行方法，用返回值刷新缓存——返回值必须是落库后的最终值
        return repository.save(product);
    }

    @CacheEvict(cacheNames = "products", key = "#id")
    public void deleteProduct(Long id) {
        repository.deleteById(id);
    }
}
```

不配置任何 provider 时默认用 `ConcurrentHashMap` 的 Simple 实现——官方明确不建议用于生产，仅适合起步验证语义。

### Caffeine 本地缓存生产配置

```yaml
spring:
  cache:
    cache-names: products, users   # 声明式建缓存，同时关闭运行时随手建缓存
    caffeine:
      spec: maximumSize=10000,expireAfterWrite=10m
```

spec 是一个逗号分隔的参数串（格式见 `CaffeineSpec`），参数分三组，全部可选但**容量与过期至少各配一个**：

| 参数 | 含义 | 典型取值 |
| --- | --- | --- |
| `initialCapacity` | 初始内部表大小 | 预估条目数的 1/10~1/2 |
| `maximumSize` | 条目数上限，超限按 W-TinyLFU 淘汰 | 按单条大小估算，如 `10000` |
| `maximumWeight` | 权重上限（需配合 weigher） | 大对象场景用权重代替条数 |
| `expireAfterWrite` | 写入后固定时长过期 | 强一致诉求首选，`10m` |
| `expireAfterAccess` | 最后访问后时长过期 | 越热活得越久，冷数据可能长期驻留 |
| `refreshAfterWrite` | 写入后定时刷新（配合 CacheLoader，异步重载、旧值继续服务） | 热点防雪崩，如 `5m` |
| `weakKeys` / `weakValues` / `softValues` | 弱/软引用控制 GC 回收 | 通用场景不建议开启 |

推荐组合 `maximumSize=10000,expireAfterWrite=10m`：上限挡住内存失控，写后过期保证新鲜度有明确上界。两个维度必须同时给——只给上限，陈旧数据永不过期；只给过期，突发 key 会冲垮内存。

### Redis 缓存基础配置

```yaml
spring:
  cache:
    cache-names: products
    redis:
      time-to-live: 10m         # 全局默认 TTL，不设则永不过期
      cache-null-values: false  # 不缓存 null，防穿透第一道闸
      key-prefix: "app::"       # 默认前缀为「缓存名::」，建议保留
      use-key-prefix: true
```

默认 value 序列化是 JDK 序列化：可读性差、要求实现 `Serializable`。生产换 JSON，声明自定义 `RedisCacheConfiguration` Bean：

```java
@Bean
public RedisCacheConfiguration cacheConfiguration() {
    return RedisCacheConfiguration.defaultCacheConfig()
            .entryTtl(Duration.ofMinutes(10))
            .disableCachingNullValues()
            .serializeValuesWith(RedisSerializationContext.SerializationPair
                    // GenericJackson2JsonRedisSerializer 自带类型信息，反序列化回具体类型
                    .fromSerializer(new GenericJackson2JsonRedisSerializer()));
}
```

::: tip
保持默认 key 前缀开启——官方强烈建议：两个缓存同名 key 不会在 Redis 里互相覆盖返回错值。自建 `RedisCacheManager` 时别随手关掉它。
:::

### 深入：缓存 key 设计

默认 key 是「方法参数 + 类型」的简单组合，业务上几乎总要自定义。key 支持 SpEL，与参数校验、防穿透配合才是完整姿势：

```java
// 1. 单参数 key、组合 key
@Cacheable(cacheNames = "products", key = "#id")
public Product getProduct(Long id) { ... }

@Cacheable(cacheNames = "userProfiles", key = "#tenantId + ':' + #userId")
public Profile getProfile(Long tenantId, Long userId) { ... }

// 2. 用 #p0/#a0 按位置引用参数（参数名被 -parameters 编译选项影响的兜底写法）
@Cacheable(cacheNames = "skuIndex", key = "#p0")
public Product getBySku(String sku) { ... }

// 3. result 引用：#result 仅在 @CachePut/@Cacheable 的 unless 中可用
@Cacheable(cacheNames = "products", key = "#id",
           unless = "#result == null")            // 空结果不写缓存
public Product findProduct(Long id) { ... }

// 4. condition：方法执行前判断，不满足则缓存机制完全旁路（方法照常执行）
@Cacheable(cacheNames = "products", key = "#id",
           condition = "#id > 0 and #includeDetail")
public Product getProduct(Long id, boolean includeDetail) { ... }
```

`condition` 与 `unless` 的分工记一句话：**condition 管"要不要进入缓存逻辑"（方法执行前），unless 管"这次结果要不要写缓存"（方法执行后）**。两者的 SpEL 都可用参数引用；`unless` 额外可用 `#result`。

### 深入：TTL 差异化（per-cache 配置）

全局一个 TTL 必然错配：商品页 10 分钟够用，库存却要 5 秒。Boot 提供 `RedisCacheManagerBuilderCustomizer` 按缓存名定制，与全局默认共存：

```yaml
spring:
  cache:
    cache-names: products, stock, users   # 先声明缓存名
    redis:
      time-to-live: 10m                   # 未单独配置的缓存用全局默认
```

```java
@Bean
public RedisCacheManagerBuilderCustomizer perCacheTtl() {
    return builder -> builder
            // 库存缓存 5 秒，抖动由业务侧加随机
            .withCacheConfiguration("stock",
                    RedisCacheConfiguration.defaultCacheConfig()
                            .entryTtl(Duration.ofSeconds(5))
                            .serializeValuesWith(RedisSerializationContext.SerializationPair
                                    .fromSerializer(new GenericJackson2JsonRedisSerializer())))
            // 用户资料 30 分钟
            .withCacheConfiguration("users",
                    RedisCacheConfiguration.defaultCacheConfig()
                            .entryTtl(Duration.ofMinutes(30)));
}
```

Caffeine 单一 `spec` 对所有 `cache-names` 生效；确需按缓存名差异化时，`CaffeineCacheManager` 的定制粒度在 Boot 自动配置之外，参考官方镜像 caching.md 的 Caffeine 一节按 `Caffeine` Bean 方式自建。

### 深入：@CacheConfig 类级抽取

同一个类里所有方法共享缓存名、keyGenerator 等配置时，提到类级注解，方法上只写差异项：

```java
@Service
@CacheConfig(cacheNames = "products")   // 类级统一：cacheNames / keyGenerator / cacheManager / cacheResolver
public class ProductService {

    @Cacheable(key = "#id")              // 方法上只写差异
    public Product getProduct(Long id) { ... }

    @CachePut(key = "#product.id")
    public Product updateProduct(Product product) { ... }

    @CacheEvict(key = "#id", allEntries = false)
    public void deleteProduct(Long id) { ... }

    @CacheEvict(allEntries = true)       // 全量失效：商品表被批量导入后清整库缓存
    public void reloadAll() { ... }
}
```

### 深入：provider 钉死、JCache 与统计观测

classpath 上同时存在多个缓存库时，自动探测顺序可能选出你不想用的 provider，显式钉死：

```properties
spring.cache.type=redis   # 可选 generic / jcache / hazelcast / infinispan / couchbase / redis / caffeine / cache2k / simple / none
```

走 JCache (JSR-107) 生态（Ehcache 3、Infinispan 等）时，provider 与配置文件两行接入：

```properties
# 多个 provider 同时在 classpath 时必须显式指定
spring.cache.jcache.provider=com.example.MyCachingProvider
spring.cache.jcache.config=classpath:example.xml
```

微调自动配置结果用 `CacheManagerCustomizer` Bean（在 CacheManager 初始化完成前生效；类型对不上则不会被调用）：

```java
@Bean
CacheManagerCustomizer<ConcurrentMapCacheManager> allowNullTuning() {
    // Simple provider 下禁止缓存 null（示例；生产应换 Caffeine/Redis）
    return cacheManager -> cacheManager.setAllowNullValues(false);
}
```

观测面两件事：Redis 缓存开启统计（`spring.cache.redis.enable-statistics=true`，命中率看 Redis 侧 `INFO` 即可）；应用侧命中率与延迟交给 Micrometer 观测（见[可观测性一章](/advanced/observability)）。**缓存没有指标就是盲飞**——命中率长期低于预期就该重新评估这份缓存的价值。

### 深入：缓存一致性策略

注解只保证"方法调用与缓存操作同刻发生"，跨服务、跨实例的一致性要靠策略：

**标准姿势是 Cache-Aside：先更库、后删缓存（`@CacheEvict`）**，而不是更新缓存。原因：并发写时"更新缓存"可能把旧值写回，而删除后下次读自然回填，天然抗并发错序。Boot 落地即上一节的样子——写路径 `@CacheEvict`，读路径 `@Cacheable`。

配套三条防线：

1. **短 TTL 兜底**：再干净的删除逻辑也可能漏（别的服务直改库、消息丢失）。TTL 是最终一致性的时间上界，业务能容忍多旧，TTL 就设多长；
2. **写多读少直接删**：数据频繁变化时缓存永远在过期边缘，命中率低还引入一致性负担——直接读库或只缓存聚合结果；
3. **强一致需求别硬上缓存**：库存扣减、账户余额这类精确实时数据直接走数据库（或分布式锁串行化），缓存只放"展示层快照"。

**什么时候不用缓存**：写多读少、每次都要精确实时、命中率预测极低的超长尾 key——缓存只会白耗内存并引入一致性问题。加缓存前先看监控确认命中率预期。

### 深入：测试与降级

缓存配置放进独立 `@Configuration` 类，切片测试就不会被迫初始化缓存。测试时两种 no-op 姿势：

```java
@SpringBootTest
@AutoConfigureCache   // 用 no-op CacheManager 替换自动配置
class MyIntegrationTests { ... }
```

```properties
# 或全局一键降级：完全旁路缓存
spring.cache.type=none
```

## 关键注解与配置

| 注解 / 配置 | 作用 |
| --- | --- |
| `@EnableCaching` | 启用缓存抽象（放独立配置类，不放主应用类） |
| `@Cacheable` | 命中返回缓存跳过方法；未命中执行并回填 |
| `@CachePut` | 始终执行方法，用返回值刷新缓存（写路径） |
| `@CacheEvict` | 删除缓存条目；`allEntries=true` 清整个缓存名 |
| `@CacheConfig` | 类级抽取 cacheNames / keyGenerator / cacheManager 等公共配置 |
| `key` / `condition` / `unless` | SpEL：参数 `#id`/`#p0`、组合拼接、结果 `#result`（unless/CachePut） |
| `spring.cache.type` | 强制指定 provider（`caffeine` / `redis` / `none`），排障与测试常用 |
| `spring.cache.cache-names` | 启动时建缓存清单，通常同时禁止运行时新建 |
| `spring.cache.caffeine.spec` | Caffeine 参数串（容量 + 过期 [+ 刷新]） |
| `spring.cache.redis.time-to-live` | Redis 全局 TTL，默认永不过期 |
| `spring.cache.redis.cache-null-values` | 是否缓存 null（默认 `true`，防穿透建议关） |
| `spring.cache.redis.key-prefix` / `use-key-prefix` | key 前缀（默认 `缓存名::`），建议保持开启 |
| `RedisCacheManagerBuilderCustomizer` | 按缓存名差异化 TTL 与序列化的定制 Bean |

provider 自动探测顺序：Generic → JCache → Hazelcast → Infinispan → Couchbase → Redis → Caffeine → Cache2k → Simple；classpath 同时有多个时用 `spring.cache.type` 显式钉死。微调自动配置用 `CacheManagerCustomizer` Bean（如 `setAllowNullValues(false)`）。

## 避坑指南

**自调用失效**。同类内 `this.updateProduct()` 不触发 `@CachePut`/`@CacheEvict`——缓存切面基于代理，内部调用绕过代理。拆到另一个 Bean，或注入自身代理。

**缓存穿透**。查询数据库里也不存在的 id，每次都打到库。三招组合：`cache-null-values=false` 关掉后用**短 TTL 的空值缓存**或 `unless="#result == null"` 的反向思路（空结果也缓存、TTL 给 30s~2m）；入口校验 key 合法性；恶意扫描用布隆过滤器前置拦截。

**缓存雪崩**。大批 key 同一秒集体过期，数据库瞬间被打满。TTL 加随机抖动（`10m + random(0,2m)`）；热点用 `refreshAfterWrite` 异步刷新 + 旧值兜底；容量规划给数据库留出缓存全灭时的降级水位。

**@CachePut 返回值必须落库**。`@CachePut` 用返回值刷新缓存，方法里改了实体但返回旧对象，缓存里就是脏数据；且这个"落库后的最终值"要与 `@Cacheable` 读到的对象结构一致。

**TTL 是兜底不是同步机制**。把"依赖过期"当"更新通知"是脏读的经典来源；一致性靠删除（`@CacheEvict`），TTL 只兜漏网的。

**Simple provider 别带到生产**。`ConcurrentHashMap` 实现无容量上限、无过期、多实例不共享，生产必须显式选 Caffeine 或 Redis；`spring.cache.type` 可随时钉死排障。

**null 值策略要想清楚**。`cache-null-values=true`（默认）会把 null 写进缓存——防穿透友好但占内存；关掉后穿透要靠入口校验补位。两难时用短 TTL 空值缓存折中，别二选一硬拍。

## 延伸阅读

- 官方镜像（本章唯一依据语料）：`spring-boot-4.1.1-docs/reference/io/caching.md`
- Spring Framework 缓存抽象（注解全语义、SpEL 上下文、keyGenerator、CacheManager/CacheResolver 组合）：[cache chapter](https://docs.spring.io/spring-framework/reference/7.0/integration/cache.html)
- Caffeine 官方仓库（spec 参数完整口径）：[github.com/ben-manes/caffeine](https://github.com/ben-manes/caffeine)
- 站内：上一章 [数据访问与事务](/practice/data-access) ｜ 下一章 [安全与鉴权](/advanced/security) ｜ 配套 [可观测性与 Actuator](/advanced/observability)

::: info 官方出处
本文依据 Spring Boot 官方文档 [Caching](https://docs.spring.io/spring-boot/4.1.1/reference/io/caching.html) 章节（v4.1.1）整理。
:::
