---
title: "REST API 开发全规范"
description: "@RestController + record DTO、完整分层链路、文件上传下载、分页排序、ProblemDetail 统一异常与 CORS，一套可上生产的 REST 规范。"
official: "https://docs.spring.io/spring-boot/4.1.1/reference/web/servlet.html"
---

# REST API 开发全规范

本章你会学到：从 Controller→Service→Repository 的完整分层写法，到文件上传下载、分页排序、ProblemDetail 统一异常与 CORS 配置的整套生产级 REST 实践。

> **上一章**：[IoC、依赖注入与配置绑定](/guide/ioc-di) · **下一章**：[配置管理与多环境](/guide/configuration)

## 业务场景

团队要对外提供订单与用户 REST API：JSON 进出、参数必须校验、错误响应格式统一且符合标准、列表接口要分页、文件要能上传下载。要求所有接口风格一致，异常处理集中一处，不再散落 try-catch。

## 极简实现

### 统一响应体

```java
package com.example.api;

public record ApiResponse<T>(int code, String message, T data, long timestamp) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(0, "ok", data, System.currentTimeMillis());
    }

    public static <T> ApiResponse<T> error(int code, String message) {
        return new ApiResponse<>(code, message, null, System.currentTimeMillis());
    }
}
```

### record DTO + 校验注解

```java
package com.example.api;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;

public record CreateOrderRequest(
        @NotBlank String sku,               // JSON "sku" 直接映射 record 组件
        @Min(1) int quantity,
        @Positive BigDecimal price) {
}
```

record 字段即 JSON 字段，Jackson 自动完成序列化/反序列化，不可变且线程安全。对外展示另备一个视图 record：

```java
public record OrderView(Long id, String sku, int quantity, BigDecimal amount) {

    public static OrderView from(Order order) { // 实体 → 视图的唯一转换口
        return new OrderView(order.id(), order.sku(), order.quantity(), order.amount());
    }
}
```

### 控制器（分页排序直接用 Pageable）

```java
package com.example.api;

import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PagedModel;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final OrderService orderService;

    public OrderController(OrderService orderService) {
        this.orderService = orderService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED) // 创建返回 201，是契约的一部分
    public ApiResponse<OrderView> create(@Valid @RequestBody CreateOrderRequest request) {
        return ApiResponse.ok(orderService.create(request));
    }

    @GetMapping("/{id}")
    public ApiResponse<OrderView> get(@PathVariable Long id) {
        return ApiResponse.ok(orderService.get(id));
    }

    @GetMapping
    public ApiResponse<PagedModel<OrderView>> list(Pageable pageable) { // 分页参数自动绑定
        Page<OrderView> page = orderService.page(pageable).map(OrderView::from);
        return ApiResponse.ok(new PagedModel<>(page)); // 输出稳定的 content + page 结构
    }
}
```

`GET /api/orders?page=0&size=20&sort=createdAt,desc` 即完成分页排序，无需手写解析：

| 参数 | 含义 | 缺省 |
| --- | --- | --- |
| `page` | 页码，从 0 开始 | `0` |
| `size` | 每页条数 | `20` |
| `sort` | `字段,asc/desc`，可重复出现多组 | 不排序 |

生产务必设置 `spring.data.web.pageable.max-page-size`（默认 2000）限制 size 上限，防止一次超大分页拖垮数据库。

### 校验依赖

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

## 关键注解与配置

| 注解 | 作用 |
| --- | --- |
| `@RestController` | `@Controller` + `@ResponseBody`，返回值直接写为 JSON |
| `@GetMapping` / `@PostMapping` / `@PutMapping` / `@DeleteMapping` | 映射 HTTP 方法与路径 |
| `@PathVariable` / `@RequestParam` / `@RequestBody` | 绑定路径、查询参数与请求体 |
| `@Valid` / `@Validated` | 触发 jakarta.validation 校验，失败抛 `MethodArgumentNotValidException` |
| `@ResponseStatus` | 标注成功响应状态码 |
| `@RestControllerAdvice` + `@ExceptionHandler` | 集中处理全局异常 |
| `Pageable` / `PagedModel` | 分页参数绑定与稳定结构的分页序列化 |
| `@CrossOrigin` | 控制器/方法级 CORS 配置 |
| `MultipartFile` | 接收 multipart/form-data 上传文件 |

### 完整分层链路：一个用户模块走通

把 Controller → Service → Repository → [DTO](/glossary#dto) 转换整条链走通，之后每个模块照此复制：

::: code-group

```java [实体 User.java]
package com.example.user;

import java.time.Instant;

public class User {
    private Long id;
    private String username;
    private String email;
    private Instant createdAt;
    // getter/setter 供持久层框架按 JavaBean 约定读写
    public Long id() { return id; }
    public void id(Long id) { this.id = id; }
    public String username() { return username; }
    public void username(String username) { this.username = username; }
    public String email() { return email; }
    public void email(String email) { this.email = email; }
    public Instant createdAt() { return createdAt; }
    public void createdAt(Instant createdAt) { this.createdAt = createdAt; }
}
```

```java [仓储 UserRepository.java]
package com.example.user;

import org.springframework.data.repository.CrudRepository;

public interface UserRepository extends CrudRepository<User, Long> {

    // 派生查询：按用户名查找，方法名即查询语义
    User findByUsername(String username);
}
```

```java [服务 UserService.java]
package com.example.user;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

@Service
public class UserService {

    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    public UserView create(CreateUserRequest request) {
        // 业务规则先行：重复用户名视为冲突（映射为 409，见全局异常）
        if (userRepository.findByUsername(request.username()) != null) {
            throw new IllegalStateException("用户名已存在：" + request.username());
        }
        User user = new User();
        user.username(request.username());
        user.email(request.email());
        return UserView.from(userRepository.save(user));
    }

    public UserView get(Long id) {
        return UserView.from(userRepository.findById(id)
                .orElseThrow(() -> new UserNotFoundException(id))); // 映射为 404
    }

    public Page<UserView> page(Pageable pageable) {
        return userRepository.findAll(pageable).map(UserView::from);
    }
}
```

```java [控制器 UserController.java]
package com.example.user;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.web.PagedModel;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import com.example.api.ApiResponse;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public ApiResponse<UserView> create(@Valid @RequestBody CreateUserRequest request) {
        return ApiResponse.ok(userService.create(request));
    }

    @GetMapping("/{id}")
    public ApiResponse<UserView> get(@PathVariable Long id) {
        return ApiResponse.ok(userService.get(id));
    }

    @GetMapping
    public ApiResponse<PagedModel<UserView>> list(Pageable pageable) {
        Page<UserView> page = userService.page(pageable);
        return ApiResponse.ok(new PagedModel<>(page));
    }
}
```

```java [入参与视图 DTO]
public record CreateUserRequest(@NotBlank String username, @Email String email) {}

public record UserView(Long id, String username, String email, java.time.Instant createdAt) {

    public static UserView from(User user) { // 实体不出服务层，出口只有视图
        return new UserView(user.id(), user.username(), user.email(), user.createdAt());
    }
}
```

:::

一次 `POST /api/users` 的完整旅程：JSON 请求体 → Jackson 反序列化为 `CreateUserRequest` → `@Valid` 校验 → Service 执行业务规则 → Repository 落库 → `UserView.from` 转视图 → Jackson 序列化回 JSON。**实体始终不出服务层**，控制器进出的只有 DTO。

### 文件上传与下载

上传默认限制很小（单文件 1MB / 整请求 10MB），先放开限制：

```yaml
spring:
  servlet:
    multipart:
      max-file-size: 20MB       # 单个文件上限
      max-request-size: 100MB   # 整个 multipart 请求上限
```

```java
package com.example.file;

import java.io.IOException;
import java.net.MalformedURLException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/files")
public class FileController {

    private final Path storageDir = Paths.get("/data/upload"); // 生产环境该路径应可配置

    @PostMapping
    public ResponseEntity<String> upload(@RequestParam MultipartFile file) throws IOException {
        Path target = storageDir.resolve(file.getOriginalFilename()); // 生产应改用生成的文件名，防路径穿越
        try (var in = file.getInputStream()) {
            Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING); // 流式落盘，不整块进内存
        }
        return ResponseEntity.ok("已保存：" + target.getFileName());
    }

    @GetMapping("/{name}")
    public ResponseEntity<Resource> download(@PathVariable String name) throws MalformedURLException {
        Resource resource = new UrlResource(storageDir.resolve(name).toUri());
        if (!resource.exists() || !resource.isReadable()) {
            return ResponseEntity.notFound().build();
        }
        // MediaTypeFactory 按文件名推断 Content-Type，推断不出给二进制流
        MediaType type = MediaTypeFactory.getMediaType(resource)
                .orElse(MediaType.APPLICATION_OCTET_STREAM);
        return ResponseEntity.ok()
                .contentType(type)
                .header("Content-Disposition", "attachment; filename=\"" + name + "\"")
                .body(resource); // Resource 由底层流式写出，大文件不会整体驻留内存
    }
}
```

### ProblemDetail 统一异常处理（RFC 9457）

先开启支持：

```yaml
spring:
  mvc:
    problemdetails:
      enabled: true
```

```java
package com.example.api;

import java.net.URI;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

    /** 业务 404：资源不存在 */
    @ExceptionHandler(UserNotFoundException.class)
    ProblemDetail handleNotFound(UserNotFoundException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
        pd.setType(URI.create("https://api.example.com/problems/user-not-found"));
        pd.setTitle("资源不存在");
        pd.setProperty("userId", ex.getUserId()); // 扩展字段自由添加
        return pd;
    }

    /** 业务 409：状态冲突 */
    @ExceptionHandler(IllegalStateException.class)
    ProblemDetail handleConflict(IllegalStateException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        pd.setType(URI.create("https://api.example.com/problems/conflict"));
        pd.setTitle("业务状态冲突");
        return pd;
    }

    /** 校验 400：逐字段给出原因 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "请求参数不合法");
        pd.setType(URI.create("https://api.example.com/problems/validation"));
        pd.setTitle("参数校验失败");
        pd.setProperty("errors", ex.getBindingResult().getFieldErrors().stream()
                .map(fe -> fe.getField() + ": " + fe.getDefaultMessage()).toList());
        return pd;
    }

    /** 兜底 500：内部细节不外泄 */
    @ExceptionHandler(Exception.class)
    ProblemDetail handleUnknown(Exception ex) {
        ProblemDetail pd = ProblemDetail.forStatusAndDetail(
                HttpStatus.INTERNAL_SERVER_ERROR, "服务内部错误，请稍后重试");
        pd.setType(URI.create("https://api.example.com/problems/internal"));
        pd.setTitle("服务内部错误");
        return pd;
    }
}
```

`404` 的响应为 `application/problem+json`：

```json
{
  "type": "https://api.example.com/problems/user-not-found",
  "title": "资源不存在",
  "status": 404,
  "detail": "user 42 not found",
  "userId": 42
}
```

四个 handler 按异常类型精确匹配，覆盖了校验 400、业务 404/409、兜底 500 三类；`detail` 与 `title` 全部中文，`type` URI 指向团队内部的问题类型文档。

### CORS 跨域：全局与注解两种

前后端分离部署时，浏览器同源策略会拦下跨域请求。两种配法按粒度选用：

**全局配置**（`WebMvcConfigurer` Bean，适合整组 API 统一放行）：

```java
@Configuration(proxyBeanMethods = false)
public class CorsConfiguration {

    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**")                 // 生效路径
                        .allowedOrigins("https://www.example.com") // 明确白名单，不要生产用 *
                        .allowedMethods("GET", "POST", "PUT", "DELETE");
            }
        };
    }
}
```

**注解配置**（细粒度，作用于单个控制器或方法）：

```java
@RestController
@CrossOrigin(origins = "https://www.example.com") // 整个控制器跨域放行
@RequestMapping("/api/public")
public class PublicController {
    // ...
}
```

方法上的 `@CrossOrigin` 覆盖类级配置；两种方式可并存，注解与全局规则取并集。

### 深入：一个请求在 Spring MVC 中的旅程（使用者视角）

不进入源码，只凭可观察的行为理解 MVC 的处理管线，排查问题时按图索骥：

1. **路由**：DispatcherServlet 按方法+路径选中唯一的 `@RequestMapping`；斜杠尾缀不宽容，`/api/users` 与 `/api/users/` 是两个路径。
2. **参数解析**：路径变量、查询参数、请求体分别由对应解析器绑定；请求体到对象靠 HttpMessageConverters（Jackson 负责 JSON，默认 UTF-8），自定义 JSON 行为是通过转换器定制而非改注解。
3. **校验**：`@Valid` 在参数绑定后触发；不标 `@Valid` 校验静默跳过——这是"约束不生效"的头号原因。
4. **返回值**：返回 record/对象 → 序列化为 JSON；返回 `ResponseEntity` → 完全掌控状态码与响应头；返回 `ProblemDetail` → `application/problem+json`。
5. **异常**：控制器抛出的异常先找 `@RestControllerAdvice`；没接住的走进内建 `/error` 机制，机器客户端拿到 JSON、浏览器拿到错误页。

### API Versioning 一句话预告

Spring MVC 内建 API 版本能力：`@GetMapping(version = "1.1")` 按 `spring.mvc.apiversion.use.header`（如 `X-Version`）等策略路由到不同版本的同路径方法——详见 [API 版本管理](/guide/api-versioning)专章。

::: tip 统一响应体与 ProblemDetail 的取舍
`ApiResponse<T>` 面向业务端点（成功也带壳）；ProblemDetail 面向错误（HTTP 语义标准）。也可以全站只用 ProblemDetail 表达错误，让 `ApiResponse` 仅包装成功数据——两种风格选一种并写进团队规范，比混用更重要。
:::

## 避坑指南

::: warning 生产接口的四条底线
1. **写操作别裸返回 200**：创建用 201（`@ResponseStatus(HttpStatus.CREATED)`），无返回体删除用 204；状态码是 API 契约的一部分。
2. **DTO 与实体分离**：`@RequestBody` 用 record DTO 接收，不要把数据库实体直接暴露给 JSON 层，否则字段泄漏与级联更新防不住。
3. **分页参数设上限**：默认 `page=0,size=20`；通过 `spring.data.web.pageable.max-page-size` 限制 size，防止一次请求拖垮数据库。
4. **校验必须 `@Valid` 才生效**：`@RequestBody` 参数漏标 `@Valid` 时，所有约束注解静默失效，不会报错。
:::

- **PagedModel 替代裸 Page**：直接序列化 `Page` 会暴露 `pageable` 等易变结构（且告警），`new PagedModel<>(page)` 输出稳定的 `content` + `page` 结构。
- **@RestControllerAdvice 的作用域**：默认全局生效，可用 `basePackageClasses` 缩小到指定包，避免与网关层异常处理重复。- **路径斜杠尾缀**：默认斜杠尾缀匹配已收紧，`/api/orders` 与 `/api/orders/` 不再视为等价，客户端保持一致。
- **上传文件名不可直接信任**：`getOriginalFilename()` 来自客户端，直接拼路径存在穿越风险；落盘文件名用服务端生成值（UUID 等），扩展名做白名单校验。
- **multipart 限制要主动调**：默认单文件 1MB，超出直接 413/异常；`spring.servlet.multipart.max-file-size` 与 `max-request-size` 要一起调，只调前者时大请求仍会被请求级上限拦下。
- **CORS 是浏览器行为**：curl/服务间调用不存在跨域问题；配了 CORS 仍报错时，检查是否走了网关或在白名单里漏了实际来源；引入安全 starter 后预检请求还要在安全配置中放行。
- **接口调外部服务**：用 `RestClient`（`spring-boot-starter-restclient`）同步调用，超时与连接池在 `RestClient.Builder` 上集中配置，见 [HTTP 客户端](/guide/http-clients)。

### 延伸阅读

官方镜像（本地 `spring-boot-4.1.1-docs/` 目录）：

- `reference/web/servlet.md` —— Spring MVC 起步、HttpMessageConverters、Error Handling 与 ProblemDetail、CORS、API Versioning 各节
- `appendix/application-properties/index.md` —— `spring.servlet.multipart.*`、`spring.data.web.pageable.*`、`spring.mvc.problemdetails.*` 属性速查
- `reference/io/rest-client.md` —— RestClient 外呼与 API 版本联动

官网对应页：<https://docs.spring.io/spring-boot/4.1.1/reference/web/servlet.html>

站内相关页：[HTTP 客户端](/guide/http-clients) · [API 版本管理](/guide/api-versioning) · [数据访问](/practice/data-access) · [安全](/advanced/security)
