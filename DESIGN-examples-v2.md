# 示例代码体系设计方案 v2（已按三项决策修订）

> 决策已确认：① 载体 MiniMall 订单系统 ✓ ② 单应用 + 章节 tag ✓ ③ 代码独立仓库 ✓
> 本机 Docker 中间件栈：MySQL 8.0 / RabbitMQ / Redis 7（Desktop\dockers 下各有 compose）——
> 本版设计以"复用本机已有中间件"为第一原则，不再要求 Postgres/Kafka。

## 1. 独立仓库结构调整（对比 v1 的变化）

```
springboot-4-examples/            # 独立仓库
├── mini-mall/                    # 单应用（章节 tag 打在此仓库）
│   ├── pom.xml
│   └── src/...
├── docker/                       # 仓库内只放"本项目专属"的 compose 增量
│   └── docker-compose.yml        # 如需额外中间件（如 gRPC 不需要、Redis 复用本机）
├── .github/workflows/ci.yml      # 编译+测试（JDK 25，Testcontainers 由 CI 自带 Docker）
└── README.md                     # 章节索引：每章 → tag → 运行说明
```

与文档仓库的关系：
- 文档仓库（springboot-4-docs）"延伸阅读/本章代码"链接指向 examples 仓库的 tag 页
  （GitHub 格式：https://github.com/<user>/springboot-4-examples/tree/ch03-rest-api）。
- VitePress `<<< @/examples/...` 嵌入语法**只能引用同仓库文件**——独立仓库改为：
  CI 定期同步或发布时通过脚本把 examples 的关键片段同步到 docs 仓库的 `snippets/` 目录，
  再由文档嵌入（同步脚本以 tag 为源，保证一致性）。

## 2. 技术栈映射修正（复用本机 Docker）

| 能力 | v1 设计 | v2 修正（本机栈） |
|---|---|---|
| 数据访问 | PostgreSQL + JPA | **MySQL 8.0**（复用 dockers/mysql，新建 mini_mall 库）+ JPA + JdbcClient |
| 消息 | Kafka | **RabbitMQ**（复用 dockers/RabbitMQ，管理台可直接看队列） |
| 缓存 | Caffeine + Redis 概念 | Caffeine + **Redis 真连演示**（复用 dockers/redis） |
| 测试 | Testcontainers（postgres/kafka） | Testcontainers（**mysql**）+ RabbitMQ 用 Testcontainers 或本地 |
| batch/quartz | — | 同 v1（MySQL 元数据表） |
| grpc/nosql | — | 不需新中间件；nosql 保持可选 profile（MongoDB 仍走 Testcontainers，仅 CI） |

## 3. 章节映射（v2 最终版）

| 章节 | tag | 代码内容 |
|---|---|---|
| getting-started | ch01-skeleton | 主类 + /ping + application.yaml |
| ioc-di | ch02-ioc-di | customer/order 包结构落地 + GatewayProperties + 第三方 Bean |
| rest-api | ch03-rest-api | 双模块 REST（DTO/校验/ProblemDetail/分页/上传/CORS） |
| configuration | ch04-config | dev/prod profiles + 敏感值环境变量注入 |
| logging | ch05-logging | logback-spring.xml + 业务日志 |
| virtual-threads | ch06-vt | spring.threads.virtual.enabled=true + IO 密集端点 |
| data-access | ch07-data | JPA 实体（MySQL）+ JdbcClient 报表 + Flyway |
| caching | ch08-cache | Caffeine + Redis 双缓存（真连本机 Redis） |
| http-clients | ch09-clients | RestClient + @HttpExchange 汇率客户端 |
| api-versioning | ch10-versioning | order 接口 v1/v2 |
| messaging | ch11-messaging | 下单 RabbitMQ 事件 + 监听（手动 ack） |
| security | ch12-security | JWT 资源服务器 + 方法级鉴权 |
| testing | ch13-testing | 切片测试 + Testcontainers(MySQL) 集成测试 |
| observability | ch14-observability | 自定义指标 + Prometheus 暴露 |
| batch | ch15-batch | orders.csv 导入 Job（MySQL 元数据表） |
| quartz | ch16-quartz | 夜间报表 Job（JDBC JobStore） |
| deployment | ch17-deploy | 分层 Dockerfile + compose（对接本机中间件） |

## 4. 文档侧调整

1. 相关章节"延伸阅读/本章代码"改为指向 examples 仓库 tag 链接。
2. 数据访问/缓存/消息三章的示例代码改写为 MySQL/RabbitMQ 版本（与文档正文同步修改，
   保持"文档示例 = 仓库代码"一致）。
3. getting-started 增加"启动本章依赖的中间件"说明（指向 Desktop\dockers 对应 compose）。
4. 文档构建的代码嵌入：CI 同步 snippets 方案（v1 §4 调整为跨仓库脚本同步）。

## 5. 实施顺序

1. 创建 springboot-4-examples 仓库 + mini-mall 骨架（ch01）+ CI（JDK 25 编译）
2. 按 ch02→ch17 顺序逐章：代码 + tag + 文档对应章节改造
3. 每 3 章一次回归（构建 + 死链 + 线上核验）
4. 完成后：master 终态 + 全 tag + Pages 自动部署

## 6. 待确认（仅一项）

- 本机 JDK 25 + Maven 是否已装？（决定编译验证走本地还是纯 Actions 远程）
