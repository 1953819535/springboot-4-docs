---
title: "外化配置与多环境"
description: "完整配置优先级、占位符与随机值、多文档 YAML、profiles 与 profile groups、敏感值注入实操与 @ConfigurationProperties/@Value 选型，让同一个 jar 适配所有环境。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/features/external-config.html"
---

# 外化配置与多环境

本章你会学到：Spring Boot 完整的配置覆盖顺序、占位符与随机值的使用、多文档 YAML 的组织方式，以及把密码等敏感值挡在代码库之外的实操手法。

> **上一章**：[REST 接口与分层架构](/guide/rest-api) · **下一章**：[日志体系与运行期调级](/guide/logging)

## 业务场景

同一份应用要跑在开发、测试、生产三套环境：数据库地址、密钥、日志级别各不相同，且密码绝不能进代码库。目标是：jar 一次构建到处运行，环境差异全部由外化配置解决，改配置无需重新打包。

## 极简实现

### 覆盖顺序：谁说了算

一句话先记住：**命令行 > 环境变量 > 配置文件 > 默认值**。完整链条官方定义了 15 个来源，从高到低排列如下（高者覆盖低者）：

| 优先级 | 配置源 | 典型场景 |
| --- | --- | --- |
| 1 | 命令行参数（`--key=value`） | 一次性覆盖、本地调试 |
| 2 | `SPRING_APPLICATION_JSON`（环境变量或系统属性中的内联 JSON） | 容器平台下发结构化配置 |
| 3 | Java 系统属性（`-Dkey=value`） | JVM 级注入 |
| 4 | OS 环境变量 | K8s/容器/Docker 部署 |
| 5 | `random.*` 随机值属性源 | 测试与临时密钥 |
| 6 | 配置数据文件（jar 外 application.yaml 等） | 生产外部覆盖 |
| 7 | 配置数据文件（jar 内 application.yaml 等） | 内置默认值 |
| 8 | `@PropertySource` 注解 | 传统代码级配置 |
| 9 | 默认属性（`SpringApplication.setDefaultProperties`） | 代码内兜底 |
| 10+ | 测试专用源（`@SpringBootTest` properties、`@DynamicPropertySource`、`@TestPropertySource`）与 devtools 全局设置 | 测试场景 |

两点补充：

- **jar 内外再细分**：配置文件内部还有一层顺序——jar 内 `application.yaml` < jar 内 `application-{profile}.yaml` < jar 外 `application.yaml` < jar 外 `application-{profile}.yaml`。也就是说"外部的 profile 专属文件"权力最大，这正对应"内置默认 + 外部覆盖"的标准部署形态。
- **`spring.config.import` 导入的文件**：排在被导入文件（声明 import 的那个文件）之上，导入的值可以覆盖导入者的值；多个导入按声明顺序处理，后面的赢。

```yaml
# application.yaml —— 提供合理默认值
server:
  port: 8080
app:
  upload-dir: /data/upload
```

```bash
# 临时覆盖（一次性，优先级最高）
java -jar app.jar --server.port=9000

# 环境变量覆盖（容器/K8s 常用，点号换下划线、全大写）
export SERVER_PORT=9000
```

```powershell
# 临时覆盖（一次性）：参数语法与 bash 完全一致
java -jar app.jar --server.port=9000

# 环境变量：PowerShell 用 $env: 前缀，只对当前会话生效
$env:SERVER_PORT = "9000"
java -jar app.jar
```

### 配置文件放在哪些地方被找到

不指定任何路径时，Spring Boot 按从低到高依次查找 `application.yaml`：

1. jar 内 classpath 根目录；
2. jar 内 classpath `/config` 包；
3. 运行目录 `./`；
4. 运行目录 `./config/` 及其直接子目录（`config/*/`，K8s 挂载多来源时很有用）。

想换文件名用 `spring.config.name`，想调整位置用 `spring.config.location` 或 `spring.config.additional-location`，它们只能以环境变量/系统属性/命令行参数的形式给出：

```bash
# 追加位置：默认位置仍然生效，自定义位置可以覆盖默认值（更常用；目录以 / 结尾）
# optional: 前缀表示位置不存在时跳过而不报错（不加则缺失即拒绝启动）
java -jar app.jar --spring.config.additional-location=optional:file:/etc/myapp/
```

目录位置以 `/` 结尾；`optional:` 前缀表示位置不存在时跳过而不报错（不加前缀，位置缺失会直接拒绝启动）。一个常用的做法是主配置进代码库，开发个性化配置不进库：

```yaml
# application.yaml
spring:
  application:
    name: order-service
  config:
    import: "optional:file:./dev.yaml"  # optional：文件不存在也能启动
```

### SPRING_APPLICATION_JSON：一个变量带一整块配置

环境变量往往不允许出现点号，嵌套属性很难塞。`SPRING_APPLICATION_JSON` 让你用一个变量携带一整块结构化配置：

```bash
export SPRING_APPLICATION_JSON='{"server":{"port":9000},"logging":{"level":{"root":"warn"}}}'
java -jar app.jar
```

```powershell
# PowerShell 单引号字符串内双引号原样保留，JSON 体可直接粘贴
$env:SPRING_APPLICATION_JSON = '{"server":{"port":9000},"logging":{"level":{"root":"warn"}}}'
java -jar app.jar
```

等价于同时设置 `server.port=9000` 与 `logging.level.root=warn`。同样的 JSON 也可以通过系统属性 `-Dspring.application.json=...` 或命令行参数 `--spring.application.json=...` 提供。

### profiles 多环境

```yaml
# application-prod.yaml —— 仅 prod 激活时生效
spring:
  datasource:
    url: jdbc:postgresql://db.prod.internal:5432/app
    username: app
    password: ${DB_PASSWORD}   # 敏感值从环境变量注入
  threads:
    virtual:
      enabled: true
```

```bash
java -jar app.jar --spring.profiles.active=prod
```

规则要点：

- 未激活任何 profile 时使用 `default` profile（对应 `application-default.yaml`），可用 `spring.profiles.default` 改名；
- 多个 profile 用逗号分隔：`--spring.profiles.active=prod,live`，**后者优先**（last-wins）；
- `spring.profiles.include` 是"追加"而非替换，且被追加的 profile 在 active 之前生效；
- **profile groups** 把一组细粒度 profile 打包成一个逻辑名：`spring.profiles.group.production=proddb,prodmq` 之后，`--spring.profiles.active=production` 一发激活全部；
- [Bean](/glossary#bean) 级隔离用 `@Profile("prod")` 标在 `@Configuration`/`@Component` 上。

## 关键注解与配置

下图按优先级从低到高排列配置来源——后加载者覆盖先加载者：

![下图按优先级从低到高排列配置来源——后加载者覆盖先加载者](/diagrams/config-precedence.svg)

| 配置/注解 | 作用 |
| --- | --- |
| `spring.profiles.active` | 激活 profile，命令行可覆盖文件配置 |
| `spring.profiles.include` | 追加激活 profile（在 active 之前生效） |
| `spring.profiles.group` | profile 组：一个逻辑名激活一组 profile |
| `spring.config.import` | 导入额外配置文件，支持 `optional:` 前缀 |
| `spring.config.activate.on-profile` | 多文档 YAML 中按 profile 生效的文档块 |
| `spring.config.activate.on-cloud-platform` | 按检测到的云平台（如 kubernetes）生效 |
| `@Profile("prod")` | Bean 仅在该 profile 激活时创建 |
| `@ConfigurationProperties` + `@Validated` | 绑定并校验配置，错误在启动期暴露 |

### 属性引用：${key} 占位符

配置值里可以用 `${key}` 引用其他已定义的属性，支持 `${key:默认值}` 兜底写法：

```yaml
app:
  name: order-service
  description: "${app.name} 是一个 Spring Boot 应用，运行在 ${user.timezone:Asia/Shanghai}"
  api:
    base-url: "https://${app.name}.example.com"   # 引用同文件的 app.name
```

引用键名请统一写 **kebab-case 规范形式**（如 `${demo.item-price}`）：它能同时匹配 `demo.item-price`、`demo.itemPrice` 与环境变量 `DEMO_ITEMPRICE`；写成 `${demo.itemPrice}` 就匹配不到 `demo.item-price` 形式的定义了。

### 松散绑定：属性名怎么写都能对上

绑定到 `@ConfigurationProperties` 时，属性名不需要精确匹配，以下写法全部绑到同一个字段（以 `my.main-project.person.first-name` 为例）：

| 写法 | 形式 | 适用来源 |
| --- | --- | --- |
| `my.main-project.person.first-name` | kebab-case | properties/YAML（**推荐**） |
| `my.main-project.person.firstName` | camelCase | properties/YAML |
| `my.main-project.person.first_name` | 下划线 | properties/YAML |
| `MY_MAINPROJECT_PERSON_FIRSTNAME` | 大写下划线 | 环境变量（**推荐**） |

唯一的硬约束：注解上的**前缀**必须是小写 kebab-case（`@ConfigurationProperties("my.main-project.person")`）。绑定 Map 时，键里含特殊字符要用 `[]` 包裹：YAML 写 `"[/key1]": "value1"`，否则 `/` 等字符会被吞掉。

### Duration / DataSize：带单位的配置值

配置里的时长与体积可以直接写带单位的值，绑定到 `Duration`/`DataSize` 类型：`30s`、`PT30S`、`30`（配 `@DurationUnit(SECONDS)` 时）都表示 30 秒；`10MB`、`10`（配 `@DataSizeUnit(MEGABYTES)` 时）都表示 10 兆字节。构造器绑定写法：

```java
@ConfigurationProperties("my.service")
public record ServiceProperties(
        @DurationUnit(ChronoUnit.SECONDS) @DefaultValue("30s") Duration sessionTimeout,
        @DefaultValue("1000ms") Duration readTimeout,          // 不标单位，默认毫秒
        @DataSizeUnit(DataUnit.MEGABYTES) @DefaultValue("2MB") DataSize bufferSize) {}
```

时长支持 `ns/us/ms/s/m/h/d`，体积支持 `B/KB/MB/GB/TB`。`Period` 同理（`1y3d`），默认单位是天。不写单位时靠 `@DurationUnit`/`@DataSizeUnit` 显式声明，避免"数字 30 到底是多少"的歧义。

### 随机值占位符 random.*

`random.*` 是一个内置属性源，适合生成测试数据、开发期临时密钥：

```yaml
my:
  secret: "${random.value}"          # 随机字符串
  number: "${random.int}"            # 随机 int
  uuid: "${random.uuid}"             # 随机 UUID
  less-than-ten: "${random.int(10)}"     # [0,10) 的 int
  in-range: "${random.int[1024,65536]}"  # [1024,65536) 的 int
```

注意：`random.*` 的优先级高于配置文件，但低于环境变量与命令行——所以你可以用环境变量覆盖掉文件里的随机值。

### 多文档 YAML：一个文件当多个用

`---` 把一个物理 YAML 文件拆成多个逻辑文档，文档自上而下处理，后面的覆盖前面的。配合 `spring.config.activate.on-profile`，让每个文档只在对应 profile 激活时生效：

```yaml
spring:
  application:
    name: order-service          # 所有环境共享的基础配置
---
spring:
  config:
    activate:
      on-profile: "dev"          # 仅 dev 激活
logging:
  level:
    root: debug
---
spring:
  config:
    activate:
      on-profile: "prod"         # 仅 prod 激活，还能叠加平台条件
      on-cloud-platform: "kubernetes"
logging:
  level:
    root: warn
```

`.properties` 文件用 `#---`（顶格、正好三个连字符）做同样的分隔。

### List 与 Map 的合并规则

跨来源合并时，**List 整体替换，Map 按 key 合并**——这是最容易想当然的地方。以 profile 文档覆盖基础文档为例：

```yaml
# 基础文档
my:
  list:
    - name: "第一个"
      description: "基础描述"
  map:
    key1:
      name: "共享键"
---
spring:
  config:
    activate:
      on-profile: "dev"
my:
  list:
    - name: "dev 覆盖项"      # 整个 list 被替换，"第一个"消失，description 变 null
  map:
    key1:
      name: "dev 改名"        # key1 按键合并：name 被覆盖，其他字段保留
    key2:
      name: "dev 新增"        # 新增键直接进 map
```

dev 激活后的结果：`list` 只剩 1 个元素（name 为 "dev 覆盖项"、description 为 null）；`map` 有两个键，`key1` 的 name 是 "dev 改名"。这条规则适用于所有属性源之间的覆盖，不只是 profile 文档。

### 敏感配置：环境变量注入实操

Spring Boot 不提供内置的配置加密——这是设计决定，官方推荐的路径是**敏感值不落盘、经环境注入**。按部署形态三选一：

**形态一：裸机/虚机，环境变量直注**

```bash
# 代码与配置文件里只留占位符
# application-prod.yaml:  spring.datasource.password: ${DB_PASSWORD}
export DB_PASSWORD='真实密码'
java -jar app.jar --spring.profiles.active=prod
```

```powershell
$env:DB_PASSWORD = "你的真实密码"
java -jar app.jar --spring.profiles.active=prod
```

relaxed binding 会自动把大写下划线环境变量映射到点号小写属性：`SPRING_DATASOURCE_PASSWORD` 直接等价于 `spring.datasource.password`，连占位符都可以不写。

**形态二：K8s/Docker，Secret 挂载成配置树**

```yaml
spring:
  config:
    import: "optional:configtree:/run/secrets/"   # Docker Swarm secret 挂载点
```

挂载目录下的每个文件名变成属性名、文件内容变成值：`/run/secrets/db/password` 文件 → 属性 `db.password`。密钥不进环境变量列表，`ps`、崩溃日志里都看不到。

**形态三：企业级密钥管理**

需要集中管理、轮换、审计时，用 Spring Cloud Vault 对接 HashiCorp Vault；需要在加载前自定义解密逻辑时，用 `EnvironmentPostProcessor` 钩子在应用启动前处理 Environment。

### @ConfigurationProperties 与 @Value 怎么选

两者能力不同，官方给出的能力对照：

| 特性 | `@ConfigurationProperties` | `@Value` |
| --- | --- | --- |
| 松散绑定（kebab/camel/环境变量大写互认） | 支持 | 有限 |
| IDE 配置元数据补全 | 支持 | 不支持 |
| SpEL 表达式 | 不支持 | 支持 |

选型口诀：**成组、结构化、要校验的配置 → `@ConfigurationProperties`；零散单值、需要 SpEL 的 → `@Value`**。给自有组件定义一批配置键时，官方明确建议聚合成 `@ConfigurationProperties` POJO/record，而不是把一堆 `@Value` 散落在类里。用 `@Value` 时键名同样写 kebab-case 规范形式。

::: tip 启动时核对配置
"配置到底生效没有"最快的核对方式：引入 actuator 后访问 `env` 与 `configprops` 端点，能看到每个属性的最终取值与来源；不引入 actuator 时，启动加 `--debug` 看条件评估报告。更多生产端点实践见[可观测性](/advanced/observability)一章。
:::

## 避坑指南

::: warning 三条最容易踩的顺序陷阱
1. **`spring.profiles.active` 不能写在 profile 专属文件里**：`application-prod.yaml` 内再写 `spring.profiles.active=xxx` 会启动报错；active/include/group 只能出现在非 profile 专属文档。
2. **`spring.config.name`/`spring.config.location` 生效极早**：只能通过环境变量、系统属性或命令行参数提供，写进 application.yaml 无效。
3. **List 整体替换**：profile 文档里改 List 的某一项，结果是整个列表被替换，不会与基础文档合并；Map 则按 key 合并、同 key 高优先级赢。
:::

- **环境变量命名规则**：点号→下划线、去横线、全大写（`spring.main.log-startup-info` → `SPRING_MAIN_LOGSTARTUPINFO`）；List 下标用下划线包裹（`my.service[0].x` → `MY_SERVICE_0_X`）。
- **properties 与 YAML 混放**：同位置同时存在两种格式时 `.properties` 优先，建议全项目统一一种格式。
- **占位符引用默认值属性取不到**：`@DefaultValue` 给 record 组件设的默认值不会写入 Environment，`@Value("${order.max-retry:3}")` 这类引用必须自带 `:默认值`。
- **`null` 覆盖无效**：`SPRING_APPLICATION_JSON` 中的 null 值被视为缺失，无法用它把低优先级来源的值"清空"。
- **profile 命名字符受限**：仅允许字母数字与 `-_.+@`，且首尾必须是字母数字（可用 `spring.profiles.validate=false` 放宽，不建议）。
- **`@PropertySource` 读不了 YAML 与多文档 properties**：它只支持普通 properties 文件，YAML 请走 `spring.config.import` 或标准 application.yaml。
- **`logging.*`、`spring.main.*` 等早期属性别放 `@PropertySource`**：这类属性在上下文刷新前就被读取，`@PropertySource` 注册太晚，不生效。

### 延伸阅读

官方镜像（本地 `spring-boot-4.1.1-docs/` 目录）：

- `reference/features/external-config.md` —— 15 源优先级、配置文件位置、占位符、随机值、多文档、configtree、构造器绑定与校验
- `reference/features/profiles.md` —— active/include/group、默认 profile、命名限制
- `appendix/application-properties/index.md` —— 全量配置属性速查
- `specification/configuration-metadata/annotation-processor.md` —— 自有配置键的 IDE 元数据

官网对应页：<https://docs.spring.io/spring-boot/4.1.1/reference/features/external-config.html>

站内相关页：[[IoC](/glossary#ioc-容器与-ioc-容器) 与依赖注入](/guide/ioc-di) · [REST API 开发全规范](/guide/rest-api) · [可观测性](/advanced/observability)
