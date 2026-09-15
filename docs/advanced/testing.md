---
title: "测试策略与 Testcontainers"
description: "Spring Boot 4.1.1 测试实战：测试金字塔分层、不启 Spring 的纯单元测试、@WebMvcTest/@DataJpaTest/@JsonTest 切片全家福、MockMvcTester 断言、Testcontainers 与 @ServiceConnection、测试配置隔离与数据清理策略。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/testing/index.html"
---

# 测试策略与 Testcontainers

> **本章你会学到**：如何按测试金字塔分配单元/切片/集成三层用例；不启动 Spring 的纯 JUnit + AssertJ 写法；`@WebMvcTest`、`@DataJpaTest`、`@JsonTest` 等切片的最小完整例；`MockMvcTester` 的 AssertJ 断言语法；Testcontainers 连真实数据库以及 `@ServiceConnection` 的能力清单；测试配置隔离与测试数据清理的选型。
> 上一章：[安全](/advanced/security) ｜ 下一章：[可观测性](/advanced/observability)

## 业务场景

::: tip 术语速览
**Mock**：测试时替换真实依赖的"假对象"，预设返回值以隔离被测代码。**切片测试**：只加载某一层 Bean 的测试（@WebMvcTest 只装 Web 层），快而准。**Testcontainers**：测试中用 Docker 拉起真实数据库/中间件容器，`@ServiceConnection` 自动接线。更多见 [核心概念速查](/glossary)。
:::


企业项目的三类测试诉求：纯逻辑秒级跑完（单元测试）、只加载 Web 层验证路由与校验（切片测试）、连真实 PostgreSQL/Redis 跑完整请求（集成测试）。Spring Boot 的测试模块按这个金字塔分层，`@SpringBootTest` 全量上下文是最后手段而不是默认动作。

::: tip 速度判断
切片测试只装需要的自动配置，上下文秒起；全量 `@SpringBootTest` 一次起全家桶。先用切片，切片覆盖不了再全量——上下文缓存机制会让同配置切片在多个测试类间复用，速度优势随用例数放大。
:::

## 极简实现

### 依赖

::: code-group
```xml [Maven]
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
<!-- 集成测试用 Testcontainers（版本由 Boot BOM 管理） -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-testcontainers</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>postgresql</artifactId>
    <scope>test</scope>
</dependency>
<dependency>
    <groupId>org.testcontainers</groupId>
    <artifactId>junit-jupiter</artifactId>
    <scope>test</scope>
</dependency>
```
```groovy [Gradle]
testImplementation 'org.springframework.boot:spring-boot-starter-test'
testImplementation 'org.springframework.boot:spring-boot-testcontainers'
testImplementation 'org.testcontainers:postgresql'
testImplementation 'org.testcontainers:junit-jupiter'
```
:::

starter-test 自带 JUnit、AssertJ、Mockito、JSON 断言与 Spring Test——一个依赖齐活。测试真实数据库再加 `spring-boot-testcontainers`（提供 `@ServiceConnection`）与对应驱动的 testcontainers 模块。

### 第一步：测试金字塔——先定比例，再写代码

| 层级 | 典型形态 | 单次耗时 | 数量占比建议 | 覆盖目标 |
| --- | --- | --- | --- | --- |
| 单元测试 | 纯 JUnit，不启动 Spring | 毫秒级 | 约 70% | 领域逻辑、工具类、边界条件 |
| 切片测试 | `@WebMvcTest` / `@DataJpaTest` / `@JsonTest` | 亚秒~秒级（缓存复用） | 约 20% | 路由、校验、序列化、SQL 映射 |
| 集成测试 | `@SpringBootTest(RANDOM_PORT)` + Testcontainers | 秒~十秒级 | 约 10% | 真实链路：建表、事务、鉴权、外部依赖 |

金字塔的经济学：越往上越贵、越慢、越脆，所以数量递减、只覆盖"拼装正确性"；算法与分支逻辑压在最底层。反过来写（大量 `@SpringBootTest`）的团队，最终都会因为 CI 太慢而放弃跑全量测试。

### 第二步：单元测试——不启动 Spring

不涉及容器与 Web 的逻辑（金额计算、状态机、参数校验规则）直接 new 对象断言，这是跑得最快的一层：

```java
class OrderPricingTest {

    private final OrderPricing pricing = new OrderPricing();

    @Test
    void vipEnjoyDiscount() {
        // 纯对象协作，无 Spring、无 Mock，毫秒级完成
        Money total = pricing.total(
                List.of(new OrderItem("book", 2, Money.of("39.90"))),
                CustomerType.VIP);
        assertThat(total).isEqualTo(Money.of("71.82")); // AssertJ 链式断言
    }

    @Test
    void emptyCartIsZero() {
        assertThat(pricing.total(List.of(), CustomerType.NORMAL))
                .isEqualTo(Money.zero());
    }
}
```

依赖协作对象太多、或协作者未实现（如远端服务）时引入 Mockito：`@ExtendWith(MockitoExtension.class)` + `@Mock` 打桩。**不要为了"测得像真的"而在这里启动 Spring**——装配正确性交给切片测试。

### 第三步：切片测试——只装需要的自动配置

`@WebMvcTest` 只加载 MVC 组件（Controller / advice / 校验器 / Converter / Filter），Service 层用 `@MockitoBean` 隔离：

```java
@WebMvcTest(UserController.class)
class UserControllerSliceTest {

    @Autowired
    MockMvcTester mvc;

    @MockitoBean
    UserService userService;

    @Test
    void getUserReturns200() {
        given(userService.getById(42L))
                .willReturn(new UserResponse(42L, "alice"));

        assertThat(mvc.get().uri("/api/users/42"))
                .hasStatusOk()
                .bodyJson().extractingPath("$.data.name").isEqualTo("alice");
    }
}
```

`@DataJpaTest` 只扫描 `@Entity` 与 Spring Data 仓储，classpath 上有内嵌数据库（H2）时自动替换数据源；测试方法默认在事务中执行、结束自动回滚：

```java
@DataJpaTest
class UserRepositorySliceTest {

    @Autowired
    TestEntityManager entityManager; // 测试专用 EntityManager：persist + flush 更直接

    @Autowired
    UserRepository repository;

    @Test
    void findByEmailReturnsUser() {
        entityManager.persistAndFlush(new User("alice", "alice@example.com"));

        var found = repository.findByEmail("alice@example.com");

        assertThat(found).isPresent();
        assertThat(found.get().getUsername()).isEqualTo("alice");
    }
}
```

`@JsonTest` 只装 JSON 映射器（Jackson 3 的 `JsonMapper` / Gson / Jsonb）与 AssertJ 辅助类，验证 DTO 契约：

```java
@JsonTest
class UserResponseJsonTest {

    @Autowired
    JacksonTester<UserResponse> json;

    @Test
    void serializeOmitsNullEmail() throws Exception {
        var response = new UserResponse(42L, "alice");
        assertThat(json.write(response))
                .extractingJsonPathStringValue("@.name").isEqualTo("alice");
    }

    @Test
    void deserialize() throws Exception {
        String content = """
                {"id": 42, "name": "alice"}
                """;
        assertThat(json.parse(content)).isEqualTo(new UserResponse(42L, "alice"));
    }
}
```

切片无法覆盖的自动配置（如自定义 `JacksonModule`）用 `@Import(MyConfig.class)` 补进上下文；同一个测试类上叠加多个 `@*Test` 注解不受支持，需要第二个切片的能力时用 `@AutoConfigure…` 注解手动补。

### 深入：Testcontainers——连真实数据库的集成测试

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Testcontainers
class UserFlowIT {

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:17");

    @LocalServerPort
    int port;

    @Test
    void createAndFetchUser() {
        // RestClient 打到 RANDOM_PORT，真实建表/落库/查询
        var client = RestClient.builder().baseUrl("http://localhost:" + port).build();
        var created = client.post().uri("/api/users")
                .body(new UserCreateRequest("alice", "alice@example.com", 20))
                .retrieve().body(UserResponse.class);
        assertThat(client.get().uri("/api/users/{id}", created.id())
                .retrieve().body(UserResponse.class).name()).isEqualTo("alice");
    }
}
```

`@ServiceConnection` 让容器连接信息自动生成对应的 `ConnectionDetails` Bean，优先级高于任何连接相关配置属性——不再手写 `@DynamicPropertySource` 样板。`spring-boot-testcontainers` 内置的连接工厂覆盖（摘自官方镜像 `reference/testing/testcontainers.md`）：

| 中间件 | 匹配的容器 |
| --- | --- |
| JDBC 数据库 | `JdbcDatabaseContainer`（PostgreSQL / MySQL / MariaDB / Oracle / MSSQL 等） |
| R2DBC 数据库 | PostgreSQL / MySQL / MariaDB / Oracle / MSSQL / ClickHouse 对应容器 |
| Redis | `RedisContainer` / `RedisStackContainer`，或镜像名为 `redis`、`redis/redis-stack(-server)` 的容器 |
| Kafka | `KafkaContainer` / `ConfluentKafkaContainer` / `RedpandaContainer` |
| MongoDB | `MongoDBContainer` |
| Elasticsearch | `ElasticsearchContainer` |
| RabbitMQ | `RabbitMQContainer`（Stream 需 `type` 属性显式指定） |
| Neo4j / Cassandra / Couchbase | 对应类型容器 |
| OTLP（日志/指标/追踪） | 镜像 `otel/opentelemetry-collector-contrib` 或 `LgtmStackContainer` |

一个容器可以同时产出多组连接细节（如 `PostgreSQLContainer` 同时生成 JDBC 与 R2DBC 两套），只想取子集时用 `@ServiceConnection` 的 `type` 属性收敛。

**容器生命周期与复用**：`@Container` 标注的 static 字段由 JUnit 扩展管理，整个测试类共享一次启停。容器被 Spring 上下文缓存引用时（`@ServiceConnection` 常见），优先把容器声明为 `@TestConfiguration` 里的 `@Bean` 或用 `@ImportTestcontainers` 导入——这样容器生命周期交给 Spring 管理：容器 Bean 先于其它 Bean 启动、最后关闭，避免"上下文还在缓存里、容器已被 JUnit 关掉"的错位。启动耗时的权衡：每次拉起真实容器换最高的可信度，代价是数十秒级冷启动；用真实镜像的集成层只覆盖"拼装正确性"，别把 70% 的单元测试逻辑搬上来跑。

### 深入：MockMvcTester 断言语法

`MockMvcTester` 是 `MockMvc` 的 AssertJ 包装，请求 DSL 与状态/响应体断言串成一条链：

```java
// 状态断言：一句话覆盖多个检查点
assertThat(mvc.get().uri("/api/users/{id}", 42))
        .hasStatusOk()                                    // 2xx
        .hasStatus(HttpStatus.OK);                        // 或精确断言
// 失败路径同样可断言
assertThat(mvc.get().uri("/api/users/999999"))
        .hasStatus(HttpStatus.NOT_FOUND);

// JSON path 断言：bodyJson() + extractingPath
assertThat(mvc.get().uri("/api/users/42"))
        .hasStatusOk()
        .bodyJson().extractingPath("$.data.name").isEqualTo("alice");

// 校验失败（400）的响应体断言
assertThat(mvc.post().uri("/api/users")
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"name": "", "email": "not-an-email"}
                        """))
        .hasStatus(HttpStatus.BAD_REQUEST)
        .bodyJson().extractingPath("$.errors").isArray();
```

纯文本响应用 `hasBodyTextEqualTo(...)`；HTMLUnit / Selenium 驱动的页面级测试不在本文范围。

### 深入：全量集成测试的客户端选型

`@SpringBootTest` + `RANDOM_PORT` 时三种客户端都可用，按断言风格选：

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureTestRestTemplate
class RandomPortTests {

    @Autowired
    TestRestTemplate template;   // 容错：4xx/5xx 不抛异常，从 ResponseEntity 取状态自行断言

    @Test
    void healthIsUp() {
        ResponseEntity<String> response = template.getForEntity("/actuator/health", String.class);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    }
}
```

`TestRestTemplate` 需额外依赖 `spring-boot-restclient` 模块（且会激活 `RestClient.Builder` 自动配置，主代码若使用它请保证该依赖在主 classpath）。想要流式断言就换 `RestTestClient`（加 `@AutoConfigureRestTestClient`），它同样支持 mock 环境与真实端口两种模式。

### 深入：测试配置隔离

**`@TestConfiguration` 的两种用法**：

```java
// 写法 A：嵌套类 —— 追加到主配置之后，只影响本测试类
@SpringBootTest
class WithNestedConfigTests {

    @TestConfiguration(proxyBeanMethods = false)
    static class FixedClockConfig {
        @Bean
        Clock clock() { return Clock.fixed(Instant.parse("2026-01-01T00:00:00Z"), ZoneOffset.UTC); }
    }

    @Autowired Clock clock;
}

// 写法 B：独立类 —— 组件扫描默认不捡，按需 @Import 复用给多个测试类
@SpringBootTest
@Import(FixedClockConfig.class)
class ReusingConfigTests { /* ... */ }
```

嵌套 `@TestConfiguration` 是"主配置 + 附加"，不要写成嵌套 `@Configuration`——后者会**替换**主配置；独立 `@TestConfiguration` 类刻意躲开组件扫描，正好防"只服务某个测试的 Bean 污染全场"。

**Profile 隔离**：`src/test/resources/application-test.yaml` 与主配置同名属性覆盖，再在测试类上声明：

```java
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ProfileIsolatedIT { /* ... */ }
```

```yaml
# src/test/resources/application-test.yaml —— 只在 test profile 生效
spring:
  datasource:
    generate-unique-name: true   # 每个上下文独享内嵌库，避免共享同名库串扰
logging:
  level:
    org.hibernate.SQL: debug     # 测试期打印 SQL，方便定位断言失败
```

### 深入：测试数据策略

| 手段 | 生效方式 | 适合 | 代价 |
| --- | --- | --- | --- |
| `@Transactional`（默认） | 方法结束回滚 | 大多数切片与单测 | `RANDOM_PORT` 下服务端事务独立提交，回滚不生效 |
| `@Sql("/cleanup.sql")` | 方法/类前后执行脚本 | 集成测试重置表、造种子数据 | 脚本与实体结构需人工同步 |
| `@DirtiesContext` | 用后重建上下文 | 改了全局状态的极端用例 | 摧毁上下文缓存，数十秒级代价 |
| TRUNCATE 钩子 | `@AfterEach` 清表 | 共享容器多类串用 | 要自己维护表清单与外键顺序 |

**另两种策略的最小用法**：

```java
// 策略1：事务回滚（切片默认，零代码）
@DataJpaTest
class OrderRepositoryTest {
    @Test
    void saveAndFind() {
        repo.save(new Order("A001"));   // 方法结束自动回滚，用例互不影响
        assertThat(repo.findByCode("A001")).isPresent();
    }
}

// 策略2：@Sql 脚本——方法前造种子数据、方法后清理
@Test
@Sql("/sql/seed-orders.sql")
@Sql(path = "/sql/cleanup.sql", executionPhase = Sql.ExecutionPhase.AFTER_TEST_METHOD)
void reportUsesSeededData() {
    assertThat(orderRepo.countActiveOrders()).isEqualTo(42);
}
// 策略3（TRUNCATE 钩子）见下方 RANDOM_PORT 完整例

```java
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OrderFlowIT {

    @Autowired
    JdbcClient jdbcClient;

    @AfterEach
    void cleanTables() {
        // 共享容器上保证幂等：按外键逆序清理
        jdbcClient.sql("truncate table order_item, orders restart identity").update();
    }
}
```

## 关键注解与配置

**切片注解速查（各切片默认导入的自动配置见官方附录）**：

| 切片注解 | 加载范围 | 典型用途 |
| --- | --- | --- |
| `@WebMvcTest` | MVC：Controller/校验/异常 | 路由与契约测试 |
| `@WebFluxTest` | WebFlux 端点 | 响应式契约 |
| `@DataJpaTest` | JPA：仓储/实体/内嵌库 | 查询逻辑（默认回滚） |
| `@JdbcTest` / `@DataJdbcTest` | DataSource/JdbcClient 或 Spring Data JDBC | SQL 直查 |
| `@RestClientTest` | RestClient/@HttpExchange 客户端 | 远端调用契约（MockRestServiceServer 配套） |
| `@JsonTest` | Jackson 序列化 | DTO 契约 |
| `@DataMongoTest` 等 | 对应 NoSQL | 仓储逻辑 |

**核心注解**：

| 注解 | 作用 | 要点 |
| --- | --- | --- |
| `@SpringBootTest(RANDOM_PORT)` | 全量上下文 + 真实端口 | 集成测试标配；默认 MOCK 环境无真端口 |
| `@LocalServerPort` | 注入随机端口 | 与 RANDOM_PORT 配套 |
| `@MockitoBean` / `@MockitoSpyBean` | 替换/包装容器中的 Bean | 切片隔离 Service 层（Framework 7 注解） |
| `@ServiceConnection` | 容器连接自动配置 | 覆盖清单见上文 Testcontainers 一节 |
| `@Testcontainers` + `@Container` | 容器生命周期 | static 字段全类共享，启停一次 |
| `@ImportTestcontainers` | 导入容器声明接口 | 容器交给 Spring 生命周期管理 |
| `MockMvcTester` / `RestTestClient` | 断言式 MVC / HTTP 测试 | AssertJ 风格链式断言 |

**生产参数基线**：

| 参数 | 默认 | 推荐 |
| --- | --- | --- |
| 测试上下文缓存 | 自动 | 不滥用 `@DirtiesContext`（会摧毁缓存） |
| 容器镜像版本 | 固定 tag | 锁定具体版本（postgres:17），禁 latest |
| 集成测试数据 | 共享库 | 每类独立容器或迁移后清理，防串扰 |

## 避坑指南

- **切片测试改了配置不生效**：同配置切片共享上下文缓存，改了 `application-test.yaml` 后旧的缓存上下文仍在——`mvn test` 全新 JVM 才算数；`@DirtiesContext` 是核武器，按类精准使用。
- **嵌套 `@Configuration` 会顶掉主配置**：测试类里想"追加 Bean"必须用 `@TestConfiguration`；嵌套普通 `@Configuration` 一旦生效，`@SpringBootApplication` 的整棵扫描树都被替换，报错往往是一大片 `NoSuchBeanDefinitionException`。
- **`@Transactional` 回滚在真实端口下失效**：`RANDOM_PORT`/`DEFINED_PORT` 时 HTTP 客户端与服务端在不同线程、不同事务，服务端落库不会回滚——集成层清理交给 `@Sql` 或 TRUNCATE 钩子，不要指望注解回滚。
- **Testcontainers 需要 Docker**：CI 无 Docker 时该层测试直接失败；把集成测试隔离到 `*IT` 命名（Maven Failsafe / Gradle 独立 task），单元与切片先跑、容器层后跑。
- **容器端口不是固定端口**：一律经 `@ServiceConnection` 或容器 `getPort()` 取，写死 5432 只在本机能跑；`GenericContainer` 配 `@ServiceConnection` 还必须用 `name` 属性指明镜像，否则 Boot 不知道生成哪组连接细节。
- **@SpringBootTest 满屏启动日志不是错误**：关注 `Started ... in X seconds` 后的断言结果；上下文反复重建（日志多次 Started）才是要修的信号——通常是测试类间配置漂移。
- **@DataJpaTest 默认回滚且 `show-sql` 打开**：想让数据真的落库（如验证触发器）要 `@Commit` 或 `@Transactional(propagation = NOT_SUPPORTED)`；不想看 SQL 刷屏就设 `@DataJpaTest(showSql = false)`。
- **测试库数据不清理**：共享容器多类共用时，用 `@Sql` 脚本或 TRUNCATE 钩子保证用例幂等，否则执行顺序一变就互相污染。

### 延伸阅读

- 官方镜像：`spring-boot-4.1.1-docs/reference/testing/spring-boot-applications.md`（`@SpringBootTest`、切片、JSON/JPA/MVC 测试全量说明）、`reference/testing/testcontainers.md`（容器生命周期与 Service Connections 清单）
- 官方镜像：`spring-boot-4.1.1-docs/reference/testing/test-utilities.md`（TestRestTemplate 等）、`reference/testing/test-modules.md`（`-test` 模块清单）、`how-to/testing.md`（切片配置拆分建议）
- 官方镜像：`spring-boot-4.1.1-docs/appendix/test-auto-configuration/slices.md`（各切片默认导入的自动配置表）
- 站内：[安全](/advanced/security)（`@WebMvcTest` + Spring Security 测试）｜ [数据访问与事务](/practice/data-access)（`@DataJpaTest` 的仓储写法）｜ [注解速查](/reference/api)
