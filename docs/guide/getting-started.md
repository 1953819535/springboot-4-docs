---
title: "快速开始：跑起第一个应用"
description: "从环境基线、标准目录、构建骨架到可执行 jar 与启动排查，用 Spring Boot 4.1.1 + JDK 25 完整跑通第一个 Web 应用。"
official: "https://docs.spring.io/spring-boot/4.1.1/tutorial/first-application/index.html"
---

# 快速开始：跑起第一个应用

本章你会学到：从检查环境、生成项目、认识标准目录，到打包可执行 jar 与排查启动失败的完整流程。上一站：[站点首页](/)。

> **下一章**：[IoC、依赖注入与配置绑定](/guide/ioc-di)


::: tip 术语速览 · 先懂三个词
**[Bean](/glossary#bean)**：交给 Spring 容器管理的对象（你声明要什么，容器负责造好递来）。**IoC/依赖注入（DI）**：创建对象的控制权交给容器，依赖作为构造器参数注入，不再自己 new。**[Starter](/glossary#starter)**：一组功能全家桶依赖坐标，引一个 = 声明我要做这类事。更多概念随时查 [核心概念速查](/glossary)。
:::

## 业务场景

新项目立项，技术栈锁定 Spring Boot 4.1.1（Spring Framework 7 / Jakarta EE 11 / JDK 25）。你要在最短时间内搭出可运行的 Web 服务骨架，并确认 JDK 版本、构建工具与打包方式全部符合 4.x 要求，为后续模块开发铺路。

## 极简实现

### 1. 确认环境基线

先在终端里确认三件事：Java、Maven/Gradle 的版本。

```bash
java -version   # 期望 25.x（最低 17，最高 26）
mvn -v          # 期望 3.9.x（最低 3.6.3）
gradle --version  # 期望 8.14+ 或 9.x
```

| 项目 | 要求 |
| --- | --- |
| Java | 最低 17，最高 26，**推荐 JDK 25 LTS** |
| Spring Framework | 7.0.9+ |
| Maven | 3.6.3+ |
| Gradle | 8.14+（8.x）或 9.x |
| 内嵌 Servlet 容器 | Tomcat 11.0.x / Jetty 12.1.x（Servlet 6.1） |

::: tip 为什么推荐 JDK 25
17 只是准入门槛。[虚拟线程](/glossary#虚拟线程-vs-平台线程)、record 模式匹配、未命名变量 `_` 等现代语法的完整收益要在 21+ 才能拿到，25 是当前推荐的生产 LTS；GraalVM 原生镜像同样要求 GraalVM 25+。
:::

### 2. 生成项目

打开 [start.spring.io](https://start.spring.io)，选择 Maven 或 Gradle、Java 25，添加依赖 **Spring Web MVC**（`spring-boot-starter-webmvc`）与 **Spring Boot DevTools**（`spring-boot-devtools`），下载解压即可获得完整项目结构。

也可以直接命令行生成：

```bash
curl -G https://start.spring.io/starter.zip \
  -d dependencies=webmvc,devtools \
  -d type=maven-project -d language=java -d javaVersion=25 \
  -d groupId=com.example -d artifactId=demo -o demo.zip
```

### 3. 认识标准目录结构

解压后的项目遵循 Maven/Gradle 标准布局，每个目录都有固定含义：

```
demo/
├── pom.xml（或 build.gradle）        # 构建脚本：依赖、插件、版本全在这
├── src/
│   ├── main/
│   │   ├── java/
│   │   │   └── com/example/demo/     # 应用代码根包，主类必须在这里
│   │   │       ├── DemoApplication.java
│   │   │       ├── web/              # 控制器（@RestController）
│   │   │       ├── service/          # 业务逻辑（@Service）
│   │   │       └── config/           # 配置类（@Configuration）
│   │   └── resources/
│   │       ├── application.yaml      # 外化配置（数据库、端口等）
│   │       ├── static/               # 静态资源：css/js/图片，直接按路径访问
│   │       └── templates/            # 服务端模板（Thymeleaf 等）
│   └── test/
│       └── java/
│           └── com/example/demo/     # 测试代码，包结构镜像 main
│               └── DemoApplicationTests.java
└── target/（Maven）或 build/（Gradle） # 构建产物，打包后才出现
```

两条铁律：

- **主类放根包**：组件扫描从主类所在包向下递归，主类挪进子包会导致外围代码扫不到；
- **测试与被测代码同包**：测试类可以访问包级可见的类与方法，`@SpringBootTest` 也能自动找到主类。

### 4. 主类与第一个接口

```java
package com.example.demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class DemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}
```

```java
package com.example.demo.web;

import java.time.Instant;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class PingController {

    @GetMapping("/ping")
    Map<String, Object> ping() {
        return Map.of("status", "UP", "ts", Instant.now().toEpochMilli()); // 直接序列化为 JSON
    }
}
```

### 5. 启动验证

::: code-group

```bash [Maven]
mvn spring-boot:run
```

```bash [Gradle]
gradle bootRun
```

:::

启动成功时日志最后一行是：

```
Started DemoApplication in 0.906 seconds (process running for 6.514)
```

访问 `http://localhost:8080/ping`，返回 `{"status":"UP","ts":...}` 即成功。devtools 会在 classpath 变更时自动快速重启，改完代码无需手动重启。

## 关键注解与配置

### @SpringBootApplication 做了什么

它是三个注解的组合：

- `@SpringBootConfiguration`：声明本类为配置类；
- `@EnableAutoConfiguration`：按 classpath 依赖自动装配（引入 `spring-boot-starter-webmvc` 即自动配好 Spring MVC 与 Tomcat）；
- `@ComponentScan`：隐式扫描主类所在包及子包，`@Component`/`@Service`/`@Repository`/`@RestController` 全部注册为 Bean。

因此**主类必须放在根包**，否则组件扫描会漏掉你的代码。整个项目只需要一处 `@SpringBootApplication`。

### 手写构建骨架（不用 start.spring.io 时）

::: code-group

```xml [pom.xml]
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>4.1.1</version>
    <relativePath/>
  </parent>
  <groupId>com.example</groupId>
  <artifactId>demo</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <properties>
    <java.version>25</java.version>
  </properties>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-webmvc</artifactId> <!-- Web MVC + Tomcat -->
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-devtools</artifactId>
      <scope>runtime</scope>
      <optional>true</optional> <!-- 不向依赖本模块的工程传递 -->
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId> <!-- 提供 repackage 与 run -->
      </plugin>
    </plugins>
  </build>
</project>
```

```groovy [build.gradle]
plugins {
  id 'java'
  id 'org.springframework.boot' version '4.1.1'
  id 'io.spring.dependency-management' version '1.1.7'
}

group = 'com.example'
version = '0.0.1-SNAPSHOT'

java {
  toolchain {
    languageVersion = JavaLanguageVersion.of(25) // 锁定编译/运行 JDK
  }
}

repositories {
  mavenCentral()
}

dependencies {
  implementation 'org.springframework.boot:spring-boot-starter-webmvc'
  developmentOnly 'org.springframework.boot:spring-boot-devtools' // 不打进 jar，也不传递
  testImplementation 'org.springframework.boot:spring-boot-starter-test'
}
```

:::

使用 `spring-boot-starter-parent`（或 Boot Gradle 插件）后，依赖版本由 BOM 统一管理，`-parameters` 编译参数也已自动开启，不要自己再写版本号。

### 打包生产 jar

::: code-group

```bash [Maven]
mvn package
java -jar target/demo-0.0.1-SNAPSHOT.jar
```

```bash [Gradle]
gradle bootJar
java -jar build/libs/demo-0.0.1-SNAPSHOT.jar
```

:::

产出的是自包含的可执行 fat jar（约 18 MB，内嵌 Tomcat），直接 `java -jar` 运行即可部署。Maven 的 `target` 下还会多一个 `.original` 文件，那是 repackage 前的原始瘦 jar，属正常现象。

### jar 里到底有什么：认识 BOOT-INF

可执行 jar 不是把所有类揉成一团的传统 uber jar，而是**嵌套 jar**结构：你的应用类放在 `BOOT-INF/classes/`，全部第三方依赖按原样嵌在 `BOOT-INF/lib/*.jar` 里，manifest 的 `Main-Class` 指向 Spring Boot 的 `JarLauncher`——由它在启动时把这些嵌套 jar 加载进类路径。Java 标准类加载器并不认识"jar 套 jar"，所以 fat jar 不能被 `java -cp` 当普通类路径引用，运行方式就是 `java -jar`。日常开发不需要深究 BOOT-INF，把它理解为"fat jar 的内部目录布局"即可。

### devtools：开发期加速器

`spring-boot-devtools` 是只在开发期生效的工具模块，提供三类行为：

1. **自动重启**：classpath 上的类文件变更并重新编译后快速重启。实现上是两个类加载器——第三方 jar 走"基类加载器"不动，你开发的类走"重启类加载器"，重启时只重建后者，所以远快于冷启动。触发方式取决于 IDE：IntelliJ 用 Build Project，Maven/Gradle 则是 `mvn compile` / `gradle build`。
2. **开发期默认属性**：自动关闭各类缓存（如模板引擎缓存置为 `false`）、打开 H2 控制台、错误信息全量展示等，让你改完立刻能看到效果。
3. **LiveReload（已废弃）**：内嵌的 LiveReload 服务器自 4.1.0 起标记废弃，无替代方案，不建议再围绕它做工具链。

什么时候该禁用 devtools：

- **多模块工程出现类加载冲突**（`ClassCastException`、注解读不到）：先关掉重启验证是否是双类加载器导致，再用 `META-INF/spring-devtools.properties` 的 `restart.include`/`restart.exclude` 精细调整；
- **只想彻底关掉重启**：在 `main` 里 `SpringApplication.run` 之前设置 `System.setProperty("spring.devtools.restart.enabled", "false")`；
- **持续编译的 IDE 想手动控制节奏**：配置 `spring.devtools.restart.trigger-file` 指定触发文件，只有它被更新时才检查重启。

打包后 devtools 自动失效（`java -jar` 被视为生产运行），repackage 默认也不包含它，生产环境无需任何处理。

### 深入：自动配置到底做了什么（使用者视角）

自动配置解决的是"引入 starter 之后要手写一大堆 Bean"的问题。它的工作方式可以从两条判断依据完整推出，不需要关心任何实现细节：

1. **classpath 上有什么**：引入 `spring-boot-starter-webmvc`，Tomcat 与 Spring MVC 就出现在类路径上，于是 DispatcherServlet、JSON 转换器、内嵌 Web 服务器被自动装配好；引入 JDBC 依赖但没配数据库，就自动给你一个内存数据库兜底。
2. **你自己定义了什么**：只要你自己声明了同类型的 Bean，自动配置的同款就退位。自动配置永远是"兜底默认值"，不会覆盖你的显式配置。

想看清"到底生效了什么"，两个手段：

- 启动加 `--debug`，控制台打印条件评估报告：每个自动配置类是匹配还是未匹配、原因是什么；
- 不想要的自动配置用 `@SpringBootApplication(exclude = XxxAutoConfiguration.class)` 排除，或配置 `spring.autoconfigure.exclude` 属性。

一句话总结：自动配置没有魔法，所有行为都能用"依赖在不在、你有没有自己定义"这两条解释。

### 启动失败排查表

启动抛异常时，绝大多数情况落在下面三类。先按现象定位类别，再按处理方式操作：

| 类别 | 典型现象 | 原因 | 处理 |
| --- | --- | --- | --- |
| 端口占用 | `Web server failed to start. Port 8080 was already in use` | 8080 被其他进程（或上一个没关干净的实例）占用 | 关闭占用进程；临时换端口 `--server.port=9000`；或改 `server.port` 配置 |
| 版本不匹配 | `Unsupported class file major version`、插件报 `requires Java 17` 类似字样 | JDK 低于 17，或 Maven/Gradle 版本过旧、IDE 与命令行版本不一致 | 升级到 JDK 25 LTS；Maven ≥ 3.6.3、Gradle 8.14+/9.x；统一 IDE、CI、命令行三处的 JDK |
| 版本不匹配 | Gradle 构建通过但 `bootRun` 行为异常 | toolchain 用 25 编译，守护进程却跑在旧 JVM 上 | 检查 `gradle --version` 输出中的 JVM 版本，与 toolchain 对齐 |
| 依赖缺失 | 启动即 `ClassNotFoundException` / `NoClassDefFoundError` | 依赖没进 classpath：坐标写错、scope 写成 test/runtime、或把 fat jar 拆开运行 | 核对依赖声明；fat jar 必须整体用 `java -jar` 运行，不要手动展开 |
| 依赖缺失 | `NoSuchMethodError` / `LinkageError` 等链接错误 | 自己显式引入的第三方库版本与 Boot BOM 管理的版本冲突 | 删掉手写版本号交给 BOM；用 `mvn dependency:tree`（或 `gradle dependencies`）定位冲突来源 |

## 避坑指南

::: warning Java 版本是最常见的翻车点
1. **JDK 超范围**：低于 17 直接无法启动，高于 26 不受支持；JDK 25 是推荐版本，团队 IDE、CI、构建工具链要统一到同一个版本。
2. **构建工具过旧**：Maven 必须不低于 3.6.3，Gradle 必须是 8.14+ 或 9.x，旧版本会报插件不兼容。
3. **toolchain 与运行 JVM 不一致**：Gradle 构建用 toolchain 锁定 25，但 `bootRun` 用的是守护进程 JVM，确认 `gradle --version` 里的 JVM 也是 25。
:::

- **devtools 打包后自动失效**：`java -jar` 运行时 devtools 被自动禁用，这是设计行为，生产无需手动排除；反过来不要在生产用系统属性强行打开它，那是安全风险。
- **fat jar 无法被 `java -cp` 加载**：Spring Boot 的嵌套 jar 结构不兼容普通类路径加载，外部依赖请通过打包前声明或分层 jar 处理。
- **端口占用**：默认 8080，临时换端口用 `java -jar demo.jar --server.port=9000`，持久配置见[外化配置与多环境](/guide/configuration)。
- **devtools 双类加载器在多模块下易出问题**：现象是类型强转失败或注解丢失；先用关闭重启的方式做鉴别，再按官方镜像 devtools.md 的"诊断类加载问题"一节调整类加载归属。
- **`@SpringBootApplication` 全项目只出现一次**：重复声明等于重复扫描与自动配置，启动行为不可预测。
- **Maven 的 `.original` 文件别删也别部署**：它是 repackage 前的原始瘦 jar，真正可执行的是不带后缀的那个。

### 延伸阅读

官方镜像（本地 `spring-boot-4.1.1-docs/` 目录）：

- `tutorial/first-application/index.md` —— 本页主线教程（Maven/Gradle 双版本）
- `system-requirements.md` —— Java/构建工具/Servlet 容器/GraalVM 版本矩阵
- `reference/using/devtools.md` —— devtools 自动重启、触发文件、类加载诊断
- `specification/executable-jar/index.md` —— 可执行 jar 与嵌套 jar 结构规范

官网对应页：<https://docs.spring.io/spring-boot/4.1.1/tutorial/first-application/index.html>

站内相关页：[[IoC](/glossary#ioc-容器与-ioc-容器) 与依赖注入](/guide/ioc-di) · [外化配置与多环境](/guide/configuration) · [REST API 开发全规范](/guide/rest-api)
