# 示例代码体系设计方案（供讨论，未实施）

> 目标：全书 25 个章节的示例代码组合成一个完整可运行的 Spring Boot 4.1.1 程序；
> 代码为唯一事实源，文档构建时直接引用真实文件，杜绝文档与代码漂移。

## 1. 业务载体：MiniMall 迷你订单系统（推荐）

- 双模块：`customer`（客户）+ `order`（订单），与官方 structuring-your-code 的
  customer/order 示例同构，认知零迁移（与 ioc-di 页"包结构"小节前后呼应）。
- 两个模块足够小（全书不失控）又足够全（CRUD/校验/关联/事件天然存在）。
- 主业务闭环：下单 → 缓存 → 发 Kafka 事件 → Batch CSV 导入 → 夜间 Quartz 报表。
- 备选：若依风格后台管理场景（如用户倾向，需重排章节映射）。

## 2. 章节 → 代码映射

| 章节 | 在示例程序里新增 |
|---|---|
| getting-started | 应用骨架：主类 + /ping |
| ioc-di | @ConfigurationProperties（网关配置）+ 第三方 Bean 装配 + 包结构落地（customer/order） |
| rest-api | customer/order 的 Controller、DTO record、校验、ProblemDetail、分页、文件上传、CORS |
| configuration | application-{dev,prod}.yaml、敏感值环境变量注入 |
| logging | logback-spring.xml、业务日志规范、运行期调级演示 |
| http-clients | RestClient + @HttpExchange（调"汇率服务"模拟远端，WireMock 测试） |
| api-versioning | order 接口 v1/v2 共存（header 策略） |
| virtual-threads | 开关 + IO 密集端点（聚合外呼示例） |
| grpc | OrderQuery gRPC 服务（与 REST 共存）+ in-process 测试 |
| data-access | JPA 实体/仓储 + JdbcClient 报表 + Flyway V1/V2 |
| caching | 订单查询 Caffeine 缓存 + 一致性避坑演示 |
| messaging | 下单 Kafka 事件 + 消费者（手动 ack 演示） |
| batch | orders.csv 导入 Job（chunk + skip/retry） |
| quartz | 夜间报表 Quartz Job（JDBC JobStore） |
| security | JWT 资源服务器保护全部 API + 方法级鉴权 |
| testing | 每层的切片测试 + Testcontainers 集成测试 |
| observability | 自定义订单指标 + Prometheus 暴露 |
| deployment | 分层 Dockerfile + docker-compose.yml |

## 3. 代码组织：单应用 + 章节 tag（推荐）

- 位置：`examples/mini-mall/`（与文档同仓库 monorepo，推荐）。
- master = 最终完整态；每章完成打 tag（ch01-skeleton … ch17-deploy），
  读者 checkout tag 即得"该章进度时的完整可运行状态"。
- 与文档"按模块分包"教学内容自洽。
- 备选 B：Maven 多模块每章一模块（重复引导代码 ×N，不推荐）；备选 C：每章独立仓库（跳转碎）。

## 4. 文档 ↔ 代码同步机制（防漂移关键）

- VitePress 原生语法：正文用 `<<< @/examples/mini-mall/src/…` 直接嵌入真实代码文件，
  构建时读入——代码改动后文档下次构建自动同步，物理上不可能漂移。
- 文件内 `// tag::rest-api[] … // end::rest-api[]` 标记片段区间，每章只嵌自己那部分。
- CI 新增 examples-workflow：push 即 `mvn -q compile test`（JDK 25），
  编译红则文档部署也不放行（workflow 链）。
- 文档页面在每章"极简实现"头部加一行徽标：`本章代码：ch05-rest-api tag`，
  并链接 GitHub 对应 tag 目录。

## 5. 运行依赖分级

- 编译期：全部依赖照常引入，CI 无需 Docker。
- 测试期：Testcontainers 拉 postgres/kafka（GitHub Actions runner 原生支持 Docker）。
- 运行演示：根目录 docker-compose.yml（postgres+kafka+mongo 一键起），
  文档按章标注"演示本章需先启动哪些容器"。
- nosql/batch/quartz 等重依赖能力设计为可选 profile 激活，默认启动不影响主流程。

## 6. 实施顺序（批准后执行）

1. 搭骨架：examples/mini-mall 可启动（ch01）+ CI 编译工作流 + VitePress 嵌入语法验证
2. 按章节顺序逐章实现：每章 = 代码 + tag + 文档改造（嵌入真实片段替换手写代码块）+ 构建
3. 每完成 3 章做一次全站回归（构建 + 死链 + 图片）
4. 全部完成后：master 终态 + 全部 tag 推送 + GitHub Pages 自动部署

## 7. 待确认决策

| # | 决策点 | 推荐 | 备选 |
|---|---|---|---|
| 1 | 业务载体 | MiniMall 订单系统（customer/order） | 若依风格后台管理场景 |
| 2 | 代码组织 | 单应用 + 章节 tag | Maven 多模块每章一模块 |
| 3 | 代码位置 | 与文档同仓库 monorepo | 独立仓库 |

## 8. 前提条件

- 本机需 JDK 25 + Maven（用于编译验证）；若暂无，可先用 GitHub Actions 远程验证、
  本地只写码（标注在实施计划里）。
- 语料核对：每章代码的属性键/坐标已由前几轮事实核验背书，实施时仍逐条对照官方镜像。
