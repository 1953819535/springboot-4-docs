---
title: "打包、镜像与部署"
description: "从 [fat jar](/glossary#fat-jar-与-boot-inf) 到分层 Dockerfile 与 Buildpacks 镜像，再到 JVM 容器参数、K8s 探针接入、发布回滚、优雅停机与 systemd 服务，把 Spring Boot 4.1.1 应用安全送上生产环境。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/packaging/container-images/dockerfiles.html"
---

# 打包、镜像与部署

## 本章你会学到

- 把应用打成 fat jar，并用 `jarmode=tools` 解包出对 AOT cache 友好的生产布局；
- 用 Buildpacks（零 Dockerfile）或分层 Dockerfile 构建小而快缓存的容器镜像；
- 按容器限额配置 JVM 内存参数（`MaxRAMPercentage` 等），不再写死 `-Xmx`；
- 把 Actuator liveness/readiness 探针接入 Kubernetes，串起发布、回滚与优雅停机全链路；
- 在裸机上用 systemd 托管应用进程。

上一章：[可观测性与 Actuator 生产参数](/advanced/observability)——本页的探针与健康检查依赖其中接入的 Actuator。

> **上一章**：[可观测性与 Actuator 生产参数](/advanced/observability) · **下一章**：[注解、[Starter](/glossary#starter) 与配置项速查](/reference/api)

## 业务场景

::: tip 术语速览
**fat jar**：把应用类+全部依赖打成一个可执行 jar（依赖在 `BOOT-INF/lib/`）。**镜像层**：容器镜像由多层只读层叠加，依赖层不变就不重建，加速 CI。**Buildpacks**：不写 Dockerfile、由工具链自动生成镜像。更多见 [核心概念速查](/glossary)。
:::


应用开发完成，接下来要回答四个问题：**产物怎么打包**（jar 一次构建，到处运行）、**镜像怎么构建**（本地能跑，容器里也要能跑，且镜像要小、要快）、**进程怎么管理**（开机自启、崩溃自愈、滚动升级不丢请求）、**上线后怎么发版**（探针卡点、发布可回滚）。本页给出从 `java -jar` 到容器、K8s 与 systemd 的最小可用路径。

## 极简实现

### 第一步：构建 fat jar

::: code-group
```xml [Maven pom.xml]
<build>
  <plugins>
    <plugin>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-maven-plugin</artifactId>
      <executions>
        <execution>
          <goals>
            <goal>repackage</goal>
          </goals>
        </execution>
      </executions>
    </plugin>
  </plugins>
</build>
```
```kotlin [Gradle build.gradle.kts]
plugins {
    java
    id("org.springframework.boot") version "4.1.1"
}

// bootJar 任务默认开启，产物在 build/libs/
tasks.bootJar {
    archiveFileName = "app.jar"
}
```
:::

使用 `spring-boot-starter-parent` 时 Maven 侧的 repackage 执行已预配置，只需声明插件。打包并运行：

```bash
./mvnw clean package           # 或 ./gradlew bootJar
java -jar target/app.jar       # Gradle 产物在 build/libs/app.jar
```

::: tip 生产环境建议先解包再运行
fat jar 的嵌套 jar 结构有轻微启动开销。执行 `java -Djarmode=tools -jar app.jar extract` 解包后用 `java -jar app/app.jar` 启动更快，且该布局对 AOT cache（与 CDS）友好。详见本地镜像 `spring-boot-4.1.1-docs/reference/packaging/efficient.md`。
:::

### 第二步：构建容器镜像

**方式 A：Buildpacks（零 Dockerfile）**，一条命令直接产出 OCI 镜像：

::: code-group
```bash [Maven]
./mvnw spring-boot:build-image -Dspring-boot.build-image.imageName=demo/app:1.0
```
```bash [Gradle]
./gradlew bootBuildImage --imageName=demo/app:1.0
```
:::

Buildpacks 自动配好 JRE 与启动参数，产出的镜像可复现、缓存友好；Paketo Spring Boot buildpack 还会读取 `layers.idx`，分层定制在镜像中同样生效。注意 buildpacks 为保证可复现可能改写文件 lastModified 元数据——静态资源若依赖该元数据，用 `spring.web.resources.cache.use-last-modified` 关闭即可（默认 `true`）。

**方式 B：分层 Dockerfile（可控性最强）**，在 builder 阶段用 `jarmode=tools` 提取分层，依赖层与应用层分离——依赖不变时镜像推送/拉取只传应用层：

```dockerfile
# 官方 4.1.1 文档模板（Dockerfile），Gradle 用户把 JAR_FILE 改为 build/libs/*.jar
# 构建阶段：提取分层
FROM bellsoft/liberica-openjre-debian:25-cds AS builder
WORKDIR /builder
ARG JAR_FILE=target/*.jar
COPY ${JAR_FILE} application.jar
RUN java -Djarmode=tools -jar application.jar extract --layers --destination extracted

# 运行阶段：每个 COPY 一层，只有应用层频繁变化
FROM bellsoft/liberica-openjre-debian:25-cds
WORKDIR /application
COPY --from=builder /builder/extracted/dependencies/ ./
COPY --from=builder /builder/extracted/spring-boot-loader/ ./
COPY --from=builder /builder/extracted/snapshot-dependencies/ ./
COPY --from=builder /builder/extracted/application/ ./
ENTRYPOINT ["java", "-jar", "application.jar"]
```

```bash
docker build --build-arg JAR_FILE=path/to/myapp.jar -t demo/app:1.0 .
```

### 第三步：生产启动参数与 JVM 内存

容器内 JVM 会自动感知 cgroup 限额（`UseContainerSupport` 默认开启）：内存按限额百分比算堆，CPU 按配额计算可用处理器数，GC 与内部线程池随之自适应。**不要写死 `-Xmx`**，用百分比与容器限额联动：

```bash
# 生产推荐：初始堆 = 最大堆，避免运行期扩容抖动
java -XX:InitialRAMPercentage=50.0 -XX:MaxRAMPercentage=75.0 \
     -XX:MaxMetaspaceSize=256m \
     -XX:+ExitOnOutOfMemoryError \
     -Duser.timezone=Asia/Shanghai \
     -jar app/app.jar
```

常用参数一览（百分比的"容器内存"指 cgroup 限额而非宿主机物理内存）：

| 参数 | 默认行为 | 生产建议 |
| --- | --- | --- |
| `-XX:MaxRAMPercentage` | 默认按容器内存的 25% 设最大堆（JVM 特性，非 Boot 文档值，以实测为准） | 推荐 50～75：堆给足，同时为非堆留余量 |
| `-XX:InitialRAMPercentage` | 未设置时由 JVM 自行决定初始堆 | 与 Max 设成相同值，消除运行期扩容抖动 |
| `-Xms` / `-Xmx` | 绝对值方式，不受容器感知影响 | 裸机/虚拟机用这对即可；与 RAMPercentage 二选一，混用算不清 |
| `-XX:MaxMetaspaceSize` | 未设置时不设上限，Metaspace 可持续增长 | 显式封顶（如 256m），防止类加载吃穿容器限额 |
| `-XX:+ExitOnOutOfMemoryError` | 默认关闭，OOM 后进程可能僵住 | 容器内开启：OOM 即退出，交给编排层重启 |
| `-XX:+UseZGC` | 默认使用 G1 | 大堆低延迟场景换 ZGC（JDK 25 下为分代 ZGC），一句带过，小容器先压测再决定 |

::: warning 堆占比要给非堆留余量
`MaxRAMPercentage=75` 只约束 Java 堆；Metaspace、线程栈、直接内存、JIT 代码缓存都占容器限额。堆按 75% 打满 + 其他开销 = OOMKilled（退出码 137）。压测验证 RSS 后再定限额，详见下方[避坑指南](#避坑指南)。
:::

### 第四步：注册为 systemd 服务

将 jar 放到 `/var/myapp`，创建 `/etc/systemd/system/myapp.service`：

```ini
[Unit]
# 描述按应用改；网络就绪后再启动
Description=myapp
After=syslog.target network.target

[Service]
# 专用低权限用户运行，禁止 root
User=myapp
Group=myapp
# exec：主进程即 java 进程，PID 与控制台日志由 systemd 托管
Type=exec
ExecStart=/path/to/java/home/bin/java -jar /var/myapp/myapp.jar
WorkingDirectory=/var/myapp
# JVM 收到 SIGTERM 优雅退出时返回 143（128+15），视为正常结束
SuccessExitStatus=143

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable myapp.service   # 开机自启
sudo systemctl start myapp.service
```

运行用户、PID 文件与控制台日志均由 systemd 托管，无需再写 shell 守护脚本；`kill -TERM` 触发的正是上文的优雅停机链路。

## K8s：探针、发布与优雅停机

### 探针接入 Kubernetes

[可观测性章节](/advanced/observability)接入 Actuator 后，4.x 已自动启用 liveness 与 readiness 健康组，路径分别是 `/actuator/health/liveness` 与 `/actuator/health/readiness`，直接配进 Pod：

```yaml
spec:
  containers:
  - name: app
    image: demo/app:1.0
    # 存活探针：失败连续超阈值才重启容器（避免瞬时抖动误杀）
    livenessProbe:
      httpGet:
        path: /actuator/health/liveness
        port: 8080
      periodSeconds: 3
      failureThreshold: 8
    # 就绪探针：不就绪只摘流量、不重启；启动未完成前不接流量
    readinessProbe:
      httpGet:
        path: /actuator/health/readiness
        port: 8080
      periodSeconds: 2
      failureThreshold: 3
```

探针端口写 Actuator 实际暴露的端口：配了 `management.server.port` 独立管理端口就指向该端口。启动慢的应用推荐再加 `startupProbe`（可复用 liveness 路径），避免启动期被 liveness 误杀；另一种做法是把 liveness/readiness 健康组额外挂到主端口（`management.endpoint.health.probes.add-additional-paths=true`，分别暴露在 `/livez`、`/readyz`），解决"管理端口健康但主端口不可用"的探测盲区。

### 发布与回滚流程

一句话定位：**滚动发布**新旧实例共存、逐个替换，省资源但新旧短暂共存；**蓝绿发布**两套完整实例一次切流量，回滚最快（把流量切回旧实例即可）。两者都靠同一条健康检查链卡点：

1. **发版前**：CI 构建镜像 → 推送仓库；镜像 tag 带版本与 commit（不要复用 `latest`）。
2. **接流量**：新实例 readiness 就绪前不接流量——这是滚动发布的安全带；蓝绿则在切流前对全量新实例做 readiness 检查。
3. **观察**：盯 `/actuator/prometheus` 指标与日志中的错误率、耗时分位，异常立即回滚（K8s 滚动：`kubectl rollout undo deployment/<name>`；蓝绿：切回旧实例）。
4. **收尾**：旧版本按保留策略留 1～2 个版本，便于秒级回退。

### 优雅停机完整链路

K8s 删除 Pod 到进程退出，完整走四步：

1. **preStop 钩子**：K8s 先执行 `preStop`（默认没有）。加一个 sleep 等负载均衡摘除流量——这个窗口应不短于最长请求处理时间；
2. **SIGTERM**：钩子结束后 K8s 发送 SIGTERM，Spring Boot 优雅停机开始（`server.shutdown` 默认已是 `graceful`，Jetty/Reactor Netty/Tomcat 三大内嵌服务器在网络层停止接收新请求）；
3. **宽限期**：存量请求在 `spring.lifecycle.timeout-per-shutdown-phase`（默认 `30s`）内完成；到点未完成的请求被放弃；
4. **终止宽限期**：K8s 侧 `terminationGracePeriodSeconds`（默认 30s）一到，仍存活的容器会被 SIGKILL。

```yaml
spec:
  containers:
  - name: app
    lifecycle:
      preStop:
        exec:
          command: ["sh", "-c", "sleep 10"]   # 等待负载均衡摘除流量
  terminationGracePeriodSeconds: 40           # 必须大于 Spring 侧停机宽限期
```

::: warning terminationGracePeriodSeconds 要大于停机宽限期
若把 `spring.lifecycle.timeout-per-shutdown-phase` 调大到 30s 以上，K8s 默认 30s 的终止宽限期一到会直接 SIGKILL，优雅停机形同虚设——Pod YAML 中的 `terminationGracePeriodSeconds` 必须同步调大（上例：preStop 10s + 停机宽限期 30s ≈ 40s）。另外不要只依赖 Spring 的优雅停机：停机期间平台拿不到 liveness 数据，preStop 的摘流窗口仍不可省。
:::

### 深入：构建产物怎么选

| 产物形态 | 一句话适用场景 |
| --- | --- |
| fat jar | `java -jar` 到处能跑，适合演示、测试与脚本化分发；嵌套 jar 有轻微启动开销 |
| 解包布局 | 生产裸机/虚拟机推荐：`extract` 后启动更快，且对 AOT cache（与 CDS）友好 |
| 容器镜像 | K8s 与云环境的默认载体：Buildpacks 省心，分层 Dockerfile 可控，环境一致 |
| Native Image | GraalVM 编译，毫秒级启动、内存小；但构建链路独立、反射受限，属于进阶话题，本入门书不展开 |

JDK 25 环境下的容器镜像还能顺带产出 AOT cache：构建阶段执行一次训练运行（`-XX:AOTCacheOutput=app.aot -Dspring.context.exit=onRefresh -jar application.jar`），运行阶段加 `-XX:AOTCache=app.aot` 显著缩短启动时间。完整模板见本地镜像 `spring-boot-4.1.1-docs/reference/packaging/container-images/dockerfiles.md` 的 AOT cache 一节。

## 关键注解与配置

| 配置项 | 默认值 | 作用与建议 |
| --- | --- | --- |
| `server.shutdown` | `graceful` | 停机方式。4.x 三大内嵌服务器默认已优雅停机；`immediate` 为立即停止 |
| `spring.lifecycle.timeout-per-shutdown-phase` | `30s` | 优雅停机宽限期，存量请求完成后才放行新阶段停止 |
| `server.port` | `8080` | 生产常由环境变量 `SERVER_PORT` 或平台 `$PORT` 注入 |
| `server.forward-headers-strategy` | —（受支持云平台默认 `native`，其余 `none`） | 反向代理后需要取真实客户端 IP/协议时设为 `framework`；仅在可信网络启用 |
| `server.compression.enabled` | `false` | 响应压缩；API 网关已压缩时保持关闭，避免双重压缩 |
| `server.max-http-request-header-size` | `8KB` | 请求头大小上限，网关透传大令牌时按需调大 |
| `server.tomcat.threads.max` | `200` | Tomcat 最大工作线程（开虚拟线程后不生效） |
| `server.tomcat.basedir` | —（临时目录） | 显式指定 Tomcat 工作目录，避免临时目录被清理引发异常 |
| `spring.web.resources.cache.use-last-modified` | `true` | Buildpacks 可能改写文件 lastModified 元数据，静态资源依赖它时需注意 |

## 避坑指南

::: warning 容器内存：限额要覆盖 JVM 全量开销
`MaxRAMPercentage=75` 只约束 Java 堆；Metaspace、线程栈、直接内存、JIT 代码缓存都占容器限额。堆按 75% 打满 + 其他开销 = OOMKilled（退出码 137）。生产建议：堆占比不超过 50%～75% 且预留至少 512MB，压测验证 RSS 后再定限额。
:::

- **优雅停机"没生效"**：先确认发送的是 SIGTERM。`kill -9` 不给停机机会；部分 IDE 的停止按钮不发标准 SIGTERM，表现是"立即退出"（官方文档明确提示此行为）。
- **`immediate` 是谁写的**：从旧版本迁移的项目常带 `server.shutdown=immediate` 的历史配置；4.x 默认值已是 `graceful`，检查是否需要保留。
- **镜像构建失败：找不到 jar**：Dockerfile 模板的 `JAR_FILE` 默认是 Maven 的 `target/*.jar`，Gradle 项目要改成 `build/libs/*.jar`。
- **Buildpacks 构建需要 Docker daemon**：`build-image`/`bootBuildImage` 依赖本地 Docker 服务，CI 无 Docker 时改用分层 Dockerfile 方案。
- **时区不一致**：容器默认 UTC。统一用 `-Duser.timezone=Asia/Shanghai` 或环境变量 `TZ=Asia/Shanghai`，数据库与日志时区一并核对。
- **探针打错端口**：配置独立管理端口后，探针仍写主端口 8080，会探测到不存在的路径；探针端口必须与 Actuator 实际暴露端口一致，或改用 `add-additional-paths` 挂到主端口。
- **liveness 探针不要挂外部依赖**：数据库抖动会让 liveness 失败，K8s 逐个重启所有实例形成级联故障；外部依赖检查放进 readiness 或自定义健康组，见[可观测性章节](/advanced/observability)。

### 延伸阅读

- 官方镜像：`spring-boot-4.1.1-docs/reference/packaging/container-images/dockerfiles.md`（分层 Dockerfile 与 AOT cache/CDS 模板）
- 官方镜像：`spring-boot-4.1.1-docs/reference/packaging/container-images/cloud-native-buildpacks.md`（Buildpacks 与 lastModified 提示）
- 官方镜像：`spring-boot-4.1.1-docs/reference/packaging/efficient.md`（解包部署布局）
- 官方镜像：`spring-boot-4.1.1-docs/reference/web/graceful-shutdown.md`（优雅停机默认值与宽限期键）
- 官方镜像：`spring-boot-4.1.1-docs/reference/actuator/endpoints.md`（K8s 探针健康组与 add-additional-paths）
- 官方镜像：`spring-boot-4.1.1-docs/how-to/deployment/cloud.md`（preStop、terminationGracePeriodSeconds、buildpack 内存参数示例）
- 官方镜像：`spring-boot-4.1.1-docs/how-to/deployment/installing.md`（systemd unit 全文）
- 官方镜像：`spring-boot-4.1.1-docs/appendix/application-properties/index.md`（server.* 与 spring.lifecycle.* 默认值）
- 官方镜像：`spring-boot-4.1.1-docs/maven-plugin/packaging.md`、`spring-boot-4.1.1-docs/gradle-plugin/packaging.md`（repackage 与 bootJar）
- 站内：[可观测性与 Actuator](/advanced/observability) · [常见问题](/faq) · [配置项速查](/reference/api)
