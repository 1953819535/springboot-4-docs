# 示例代码体系设计 v3（定稿）— 文档自包含方案

> 用户决策：示例代码在教程文档内自包含；各章示例组合起来 = 一个完整可运行程序；
> 与代码仓库**不强制关联**（终态整理成仓库为可选增值项）。

## 1. 载体：MiniMall 迷你订单系统（已确认）

双模块 customer + order（与官方 structuring-your-code 示例同构）。
主业务闭环：下单 → 缓存 → 发 RabbitMQ 事件 → Batch CSV 导入 → 夜间 Quartz 报表。

## 2. 章节 → 示例代码增量映射（最终版）

| 章节 | 本章新增代码（累计 = 完整程序） |
|---|---|
| getting-started | 主类 + /ping + 标准目录树（MiniMall 实际结构，customer/order 模块式） |
| ioc-di | customer/order 包结构落地 + GatewayProperties + 第三方 Bean 装配 |
| rest-api | 双模块 REST：DTO/校验/ProblemDetail/分页/文件上传/CORS |
| configuration | dev/prod profiles + 敏感值环境变量注入 |
| logging | logback-spring.xml + 业务日志规范 |
| virtual-threads | 开关 + IO 密集端点 |
| data-access | JPA 实体(MySQL) + JdbcClient 报表 + Flyway V1/V2 |
| caching | Caffeine + Redis 真连（docker-compose 里的 redis） |
| http-clients | RestClient + @HttpExchange 汇率客户端 |
| api-versioning | order 接口 v1/v2 共存 |
| messaging | 下单 RabbitMQ 事件 + 监听（手动 ack） |
| security | JWT 资源服务器 + 方法级鉴权 |
| testing | 切片测试 + Testcontainers(MySQL) 集成测试 |
| observability | 自定义订单指标 + Prometheus 暴露 |
| batch | orders.csv 导入 Job（MySQL 元数据表） |
| quartz | 夜间报表 Job（JDBC JobStore） |
| deployment | 分层 Dockerfile + 完整 docker-compose.yml（mysql/rabbitmq/redis） |

## 3. Docker 服务进文档

- deployment 章给出完整 docker-compose.yml：mysql:8.0 / rabbitmq:management / redis:7-alpine，
  参考 Desktop\dockers 三份现有 compose（端口 3306/5672+15672/6379）。
- 各章头部加一行"本章演示需要启动的服务"标注。

## 4. 一致性保障：设计账本（写作纪律，非基础设施）

重写各章示例时维护账本（.cluster/sbvite/ledger.md）：
- 每个类/配置键/依赖坐标的首引章节、当前累积状态
- 每章代码只引用账本中已引入的类与键，绝不引用未出现的内容
- 每章完成后更新账本

## 5. 质检（可选内部手段，与文档无关联）

全部章节改完后，把文档内代码按章节顺序拼进临时工程，本机 JDK 25 + Maven 编译一遍，
验证"组合即可运行"承诺。拼完即弃，不发布。

## 6. 可选增值项（最后做，不影响文档）

终态代码整理为 springboot-4-examples 仓库（master + 章节 tag），供不想手敲的读者下载。
文档仅"延伸阅读"提一句链接，无强制关联。

## 7. 实施顺序

1. 建账本 + 样例：重写 ch01/ch02/ch03 示例（用户过目确认风格）
2. 铺开全书剩余章节逐章重写示例（每章完成更新账本）
3. deployment 章补 docker-compose.yml + 各章中间件标注
4. 拼装编译质检（临时工程）
5. 红线/导航/构建回归 + 提交推送
