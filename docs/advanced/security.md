---
title: 安全（Security）
description: Spring Boot 4.1.1 安全实战：默认安全行为、SecurityFilterChain 授权规则、OAuth2 Resource Server JWT 主路线、自有用户表登录与自签 JWT、CORS、方法级授权与安全测试。
official: https://docs.spring.io/spring-boot/4.1.1/reference/web/spring-security.html
---

> **本章你会学到**：引入 starter 后 Spring Boot 默认提供了哪些防护；如何用 `SecurityFilterChain` + lambda DSL 重写授权规则；JWT 资源服务器的三个关键属性（`issuer-uri` / `jwk-set-uri` / `audiences`）与角色映射；没有外部 IdP 时，如何用自有用户表 + 自签 JWT 完成登录闭环；CORS 与 CSRF 各管什么；以及怎么给安全规则本身写测试。

> **下一章**：[测试策略与 Testcontainers](/advanced/testing)
## 业务场景

团队做的是前后端分离的订单系统，前端独立部署，API 需要对接公司统一身份平台（IdP），由 IdP 签发 JWT，后端只做校验——这是典型的**资源服务器**路线，也是本章的主线。

另一类场景是起步团队：暂时没有统一 IdP，用户存在自己的 `user` 表里，需要一个登录接口换取 token。两条路线共用同一套 `SecurityFilterChain` 骨架，本章都会给出从最小到企业级的完整实现。

::: warning 默认行为先知道
引入 security starter 后：所有请求要求登录、自动生成随机密码（启动日志里以 WARN 打印）、带表单登录或 HTTP Basic。这是安全基线而不是绊脚石——本章的配置就是把这三件事按 API 项目的需要重新声明。
:::

## 极简实现

### 第一步：加依赖（Maven 坐标示例）

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
```

### 第二步：什么都不配，先感受默认行为

只要 `spring-security` 在 classpath 上，整个应用（包括 `/error`、actuator 端点）立即进入保护状态。默认提供：

- 一个内存 `UserDetailsService`：用户名 `user`，密码随机生成，启动时以 WARN 级别打印（`Using generated security password: ...`）；
- 表单登录或 HTTP Basic（根据请求的 `Accept` 头协商），覆盖整个应用；
- 一个 `DefaultAuthenticationEventPublisher` 发布认证事件。

```yaml
# 临时用固定账号跑通本地调试
spring:
  security:
    user:
      name: dev
      password: "{noop}dev-only"
```

> 提示：随机密码仅用于开发。若你自定义了日志配置，请保留 `org.springframework.boot.security.autoconfigure` 的 WARN 级别输出，否则随机密码不会打印。

### 第三步：最小自定义授权链

```java
@Configuration(proxyBeanMethods = false)
@EnableWebSecurity
public class MinimalSecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .authorizeHttpRequests(requests -> requests
                .requestMatchers("/api/public/**").permitAll()
                .anyRequest().authenticated())
            .httpBasic(withDefaults());
        return http.build();
    }
}
```

一旦定义了 `SecurityFilterChain` [Bean](/glossary#bean)，默认的整条安全链（含 actuator 的保护策略）就由你接管。`httpBasic(withDefaults())`/`formLogin(withDefaults())` 按需选择。

## 关键注解与配置

下图是无状态 JWT 认证的完整时序——验签全部在本地完成，授权服务器只在启动时被"发现"一次：

![下图是无状态 JWT 认证的完整时序——验签全部在本地完成，授权服务器只在启动时被"发现"一次](/diagrams/jwt-auth-flow.svg)

| 注解 / 属性 | 作用 |
| --- | --- |
| `@EnableWebSecurity` | 显式声明 Web 安全配置类（配合自定义 `SecurityFilterChain`） |
| `@EnableMethodSecurity` | 打开方法级授权（`@PreAuthorize` 等） |
| `spring.security.user.name` / `spring.security.user.password` | 覆盖默认内存用户的账号密码 |
| `spring.security.oauth2.resourceserver.jwt.issuer-uri` | OIDC Issuer 标识，自动发现 JWKS 并校验 |
| `spring.security.oauth2.resourceserver.jwt.jwk-set-uri` | 直接指定 JWK Set 地址（IdP 不支持发现端点时） |
| `spring.security.oauth2.resourceserver.jwt.audiences[0]` | 要求 [JWT](/glossary#jwt--csrf--cors-速记) 的 `aud` claim 匹配指定值 |
| `spring.security.oauth2.resourceserver.jwt.public-key-location` | 指向 PEM 编码 x509 公钥文件（授权服务器无 JWKS 时） |
| `spring.security.oauth2.resourceserver.opaquetoken.*` | 不透明 token 走内省（introspection-uri/client-id/client-secret） |

### 企业级完整例：资源服务器 + 分域授权

```java
@Configuration(proxyBeanMethods = false)
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
            .cors(withDefaults()) // 配合下方 CorsConfigurationSource
            .authorizeHttpRequests(requests -> requests
                // classpath 常见静态资源位置（/css /js /images 等）
                .requestMatchers(PathRequest.toStaticResources().atCommonLocations()).permitAll()
                // actuator：health 放行，其余要 OPS 角色
                .requestMatchers(EndpointRequest.to(HealthEndpoint.class)).permitAll()
                .requestMatchers(EndpointRequest.toAnyEndpoint()).hasRole("OPS")
                // 业务 API
                .requestMatchers("/api/public/**").permitAll()
                .requestMatchers("/api/admin/**").hasRole("ADMIN")
                .requestMatchers("/api/**").authenticated()
                .anyRequest().denyAll())
            .oauth2ResourceServer(oauth2 -> oauth2.jwt(withDefaults()));
        return http.build();
    }
}
```

```yaml
spring:
  security:
    oauth2:
      resourceserver:
        jwt:
          issuer-uri: "https://idp.example.com/realms/app" # 二选一：自动发现
          audiences:
            - "my-api"                                      # 校验 aud，防止别系统 token 串用
```

`EndpointRequest` 依据 `management.endpoints.web.base-path` 生成匹配器；`oauth2ResourceServer` 的 [JWT](/glossary#jwt--csrf--cors-速记) 解码器由 Boot 根据上述属性自动装配。若 IdP 连 JWKS 都不提供，改用 `public-key-location` 指向 PEM 公钥文件即可。

### 深入：角色映射 Converter（claim → ROLE）

资源服务器默认把 JWT 的 `scope` claim 映射成 `SCOPE_xxx` 权限。如果你的 IdP 把角色放在自定义 claim（比如 `roles`），需要一个 `Converter` 翻译成带 `ROLE_` 前缀的权限，才能配合 `hasRole` 使用：

```java
@Bean
public Converter<Jwt, ? extends AbstractAuthenticationToken> roleConverter() {
    return jwt -> {
        // claim 名按 IdP 实际返回调整；空值兜底，避免 NPE 导致 500
        List<String> roles = jwt.getClaimAsStringList("roles");
        if (roles == null) {
            roles = List.of();
        }
        List<SimpleGrantedAuthority> authorities = roles.stream()
            .map(role -> role.startsWith("ROLE_") ? role : "ROLE_" + role) // 统一前缀
            .map(SimpleGrantedAuthority::new)
            .toList();
        return new JwtAuthenticationToken(jwt, authorities);
    };
}

// 接线：把转换器交给 JWT 配置
// http.oauth2ResourceServer(oauth2 -> oauth2.jwt(jwt ->
//     jwt.jwtAuthenticationConverter(roleConverter())));
```

### 深入：自有用户表 + 登录端点 + 自签 JWT

没有 IdP 时的完整闭环：用户表存 BCrypt 哈希 → 登录接口用 `AuthenticationManager` 校验 → 签发 JWT → 同一套资源服务器配置校验后续请求。

```java
// 1) 数据层：密码只存哈希
@Entity
public class AppUser {
    @Id
    @GeneratedValue
    Long id;
    String username;
    String password; // BCrypt 哈希
    String roles;    // 逗号分隔，如 "ADMIN,USER"
}

// 2) 安全装配三件套
@Configuration(proxyBeanMethods = false)
public class AuthConfig {

    @Bean
    public UserDetailsService userDetailsService(UserRepository users) {
        return username -> users.findByUsername(username)
            .map(user -> User.withUsername(user.getUsername())
                .password(user.getPassword())
                .roles(user.getRoles().split(",")) // 自动加 ROLE_ 前缀
                .build())
            .orElseThrow(() -> new UsernameNotFoundException(username));
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }
}
```

```java
// 3) 登录端点：校验成功后自签 JWT
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthenticationManager authenticationManager;
    private final JwtEncoder jwtEncoder;

    public AuthController(AuthenticationManager authenticationManager, JwtEncoder jwtEncoder) {
        this.authenticationManager = authenticationManager;
        this.jwtEncoder = jwtEncoder;
    }

    @PostMapping("/login")
    public Map<String, String> login(@RequestBody LoginRequest request) {
        Authentication authentication = authenticationManager.authenticate(
            UsernamePasswordAuthenticationToken.unauthenticated(request.username(), request.password()));
        List<String> roles = authentication.getAuthorities().stream()
            .map(GrantedAuthority::getAuthority)
            .toList();
        Instant now = Instant.now();
        JwtClaimsSet claims = JwtClaimsSet.builder()
            .issuer("my-app")
            .subject(authentication.getName())
            .issuedAt(now)
            .expiresAt(now.plus(1, ChronoUnit.HOURS))
            .claim("roles", roles)
            .build();
        JWSHeader header = JWSHeader.builder(JWSAlgorithm.RS256).build();
        String token = jwtEncoder.encode(JwtEncoderParameters.from(header, claims)).getTokenValue();
        return Map.of("token", token);
    }
}
```

```java
// 4) 签发与校验共用一对 RSA 密钥（JwtEncoder 来自 spring-security-oauth2-jose，随资源服务器依赖传入）
// 依赖坐标按团队选型调整，此处仅示例
@Bean
public JwtEncoder jwtEncoder(JwtKeyProperties props) throws Exception {
    // 密钥经环境变量/密管注入；以下 PEM 解析仅示意，生产勿硬编码
    RSAPublicKey publicKey = props.readPublicKey();
    RSAPrivateKey privateKey = props.readPrivateKey();
    RSAKey jwk = new RSAKey.Builder(publicKey).privateKey(privateKey).keyID("app-key").build();
    return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(jwk)));
}

@Bean
public JwtDecoder jwtDecoder(JwtKeyProperties props) throws Exception {
    return NimbusJwtDecoder.withPublicKey(props.readPublicKey()).build();
}
```

单体内部署、签发与校验在同一个进程时，也可以用对称的 HS256：密钥就是一个字符串（或 `SecretKeySpec`），签发与校验共用。

```java
// HS256（对称密钥）变体：单体应用的最简选型，签发侧按团队选型
@Bean
public JwtEncoder jwtEncoderHS256(@Value("${jwt.secret}") String secret) {
    // jwt.secret 走环境变量注入；长度必须满足 HS256 要求（至少 256 位）
    SecretKeySpec key = new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HMACSHA256");
    JWK jwk = new OctetSequenceKey.Builder(key).keyID("hs256-key").build();
    return new NimbusJwtEncoder(new ImmutableJWKSet<>(new JWKSet(jwk)));
}

@Bean
public JwtDecoder jwtDecoderHS256(@Value("${jwt.secret}") String secret) {
    return NimbusJwtDecoder.withSecretKey(
            new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HMACSHA256")).build();
}
```

两种算法取舍：HS256 简单但**签发方与校验方必须共享同一个秘密**，多服务架构里秘密扩散面大；RS256 私钥只在签发方手里，公钥可随 JWKS 公开分发，微服务/外部接入场景优先。Spring Security 自带的 `JwtEncoder`/`JwtDecoder` 覆盖两条路线，通常无需再引入第三方 [JWT](/glossary#jwt--csrf--cors-速记) 库；若团队已选定 jjwt 或 java-jwt 之类自行编解码，依赖坐标属签发侧团队选型，本文不指定。

::: tip 密码哈希的默认行为
`UserDetailsServiceAutoConfiguration` 装配的默认 `PasswordEncoder` 是 `PasswordEncoderFactories.createDelegatingPasswordEncoder()`：存储值带 `{bcrypt}`/`{noop}` 等 id 前缀，校验时按前缀分派、登录成功后自动把旧格式升级重存。自己在 `AuthConfig` 里显式声明 `PasswordEncoder` [Bean](/glossary#bean) 时，行为以你的实现为准——不指定 id 前缀的裸哈希将无法通过 `DelegatingPasswordEncoder` 校验。
:::

::: tip 认证事件日志
Boot 默认注册 `DefaultAuthenticationEventPublisher`，认证成功/失败都会以 `AuthenticationSuccessEvent` / `AbstractAuthenticationFailureEvent` 发布——监听失败事件即可接入风控日志（如连续失败锁定），本页不展开，监听写法见 Spring Security 参考手册的 Events 一节。
:::

注意：自定义 `JwtDecoder` Bean 后，`spring.security.oauth2.resourceserver.jwt.*` 属性配置即让位，两者不要混用。另外，引入 `spring-security-oauth2-resource-server`、`spring-security-oauth2-client`、`spring-security-saml2-service-provider` 任一模块后，默认内存用户会自动回退（不再生成随机密码）——如果你仍需要它，请显式声明 `InMemoryUserDetailsManager` Bean。

### 深入：CORS 完整一节

CORS 是浏览器端的跨域机制，与 CSRF、授权互相独立。三种配置写法按部署形态取舍：

**写法一：`SecurityFilterChain` 里 `cors(withDefaults())`**——安全链自动寻找 `CorsConfigurationSource` Bean，CORS 预检在安全过滤链中处理，不依赖 MVC 顺序：

```java
@Bean
public CorsConfigurationSource corsConfigurationSource() {
    CorsConfiguration config = new CorsConfiguration();
    config.setAllowedOriginPatterns(List.of("https://app.example.com")); // 前端域名，精确到源头
    config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
    config.setAllowedHeaders(List.of("*"));
    config.setAllowCredentials(true); // 携带 cookie 时必须，且不能用 "*" 通配 origin
    config.setMaxAge(3600L);          // 预检结果缓存 1 小时，减少 OPTIONS 请求
    UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
    source.registerCorsConfiguration("/**", config);
    return source;
}
```

**写法二：`WebMvcConfigurer` 全局配置**——不经过安全链，由 MVC 层处理：

```java
@Configuration
public class WebCorsConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("https://app.example.com")
                .allowedMethods("GET", "POST", "PUT", "DELETE")
                .maxAge(3600);
    }
}
```

**取舍**：走 Spring Security（写法一）时预检请求同样要过安全链——如果安全链在 MVC 之前就拒绝了无 token 的 OPTIONS 预检，MVC 层的 CORS 配置（写法二）根本没机会生效。因此**前后端分离 + [JWT](/glossary#jwt--csrf--cors-速记)** 场景选写法一（或写法三）让 CORS 在安全链内先处理；纯服务端渲染、无安全链拦截 OPTIONS 的简单应用，写法二就够。两者只选其一，叠加配置容易产生"预检通过但响应头重复"类怪象。

::: tip 预检请求也是请求
`OPTIONS` 预检不会携带 `Authorization` 头。它在安全链里的放行由 `cors(withDefaults())` + `CorsConfigurationSource` 自动保证；自己写授权规则时，别把预检路径无意间挡在 `authenticated()` 之后。
:::

若跨域流量已被网关统一处理，后端也可以不开 CORS，只保留网关一层配置，避免双重放行。

### 深入：方法级注解全集

`@EnableMethodSecurity` 打开后，以下注解可用在类或方法上（SpEL）：

| 注解 | 时机 | 示例 |
| --- | --- | --- |
| `@PreAuthorize` | 方法调用前校验 | `@PreAuthorize("hasRole('ADMIN')")` |
| `@PostAuthorize` | 方法返回后校验 | `@PostAuthorize("returnObject.owner == authentication.name")` |
| `@PreFilter` | 过滤集合入参 | `@PreFilter("filterObject.amount > 0")` |
| `@PostFilter` | 过滤集合返回值 | `@PostFilter("hasRole('ADMIN') or filterObject.owner == authentication.name")` |

```java
@Service
public class OrderService {

    @PreAuthorize("hasRole('ADMIN') or #username == authentication.name")
    public List<Order> listOrders(String username) {
        return orderRepository.findByOwner(username);
    }

    @PostAuthorize("returnObject.owner == authentication.name")
    public Order getOrder(long id) {
        return orderRepository.findById(id).orElseThrow();
    }
}
```

URL 级规则负责"圈地"，方法级注解负责"点名"，两者叠加时任何一层拒绝都会拒绝。

### 深入：安全测试

`@WebMvcTest` 在 classpath 上有 Spring Security 时会一并加载安全配置，用 Spring Security 的测试支持注入身份即可，不要为绕开安全而禁用它：

```java
@WebMvcTest(AdminController.class)
@Import(SecurityConfig.class) // 让真实的授权规则参与测试
class AdminControllerSecurityTests {

    @Autowired
    MockMvc mvc;

    @Test
    void anonymousIsUnauthorized() throws Exception {
        mvc.perform(get("/api/admin/stats"))
            .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(roles = "USER")
    void normalUserIsForbidden() throws Exception {
        mvc.perform(get("/api/admin/stats"))
            .andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void adminCanRead() throws Exception {
        mvc.perform(get("/api/admin/stats"))
            .andExpect(status().isOk());
    }

    @Test
    @WithMockUser(roles = "ADMIN")
    void postNeedsCsrfToken() throws Exception {
        // CSRF 默认开启：不带 token 的 POST 会被 403
        mvc.perform(post("/api/admin/stats"))
            .andExpect(status().isForbidden());
        mvc.perform(post("/api/admin/stats").with(csrf()))
            .andExpect(status().isOk());
    }
}
```

资源服务器（[JWT](/glossary#jwt--csrf--cors-速记)）场景下，`SecurityMockMvcRequestPostProcessors.jwt()` 可以直接注入一个已验证的 `Jwt`，无需真实 IdP：

```java
@WebMvcTest(AdminController.class)
@Import(SecurityConfig.class)
class ResourceServerSecurityTests {

    @Autowired
    MockMvc mvc;

    @Test
    void validJwtGrantsAccess() throws Exception {
        mvc.perform(get("/api/admin/stats").with(jwt().authorities(new SimpleGrantedAuthority("ROLE_ADMIN"))))
            .andExpect(status().isOk());
    }
}
```

完整的端到端验证（真实端口 + `@ServiceConnection` 签发方容器）可叠加在 `@SpringBootTest` 集成测试上，见[测试策略](/advanced/testing)一章。

## 避坑指南

1. **CSRF 何时开**：浏览器 cookie/表单会话场景保持默认开启；纯 Bearer token、不依赖 cookie 的 API 才可关。关之前确认没有"cookie 登录 + token API"混用，否则等于给 CSRF 留门。
2. **aud 不能省**：只配 `issuer-uri` 不配 `audiences` 时，同一个 IdP 签给其他系统的 token 也能调用你的服务。`aud` 是"这个 token 是发给谁的"的凭证，生产必配。
3. **密钥必须走环境变量或密管**：`application.yaml` 里只放占位符（`${JWT_PRIVATE_KEY}`），私钥一旦进仓库就等于公开。轮换密钥时保留旧公钥做验证过渡。
4. **随机密码只是脚手架**：看到启动日志里的 `Using generated security password` 就说明还没配置真实认证来源，仅限开发环境；生产必须显式提供 `UserDetailsService` / `AuthenticationProvider` / `AuthenticationManager` 或 IdP 配置。
5. **Role 前缀要对齐**：`hasRole("ADMIN")` 隐含检查 `ROLE_ADMIN`。自定义 Converter 输出不带 `ROLE_` 前缀时全部 403，此时应统一前缀或改用 `hasAuthority`。注册用户时用 `PasswordEncoder` 生成哈希，明文入库是最严重的安全事故。
6. **@PreAuthorize 要实测拒绝路径**：只测"管理员能访问"不测"普通用户被拒绝"，规则退化后不会被发现。每个授权规则至少一条拒绝用例；URL 级规则同样要在 `RANDOM_PORT` 集成测试里真实打一遍。

### 延伸阅读

- 官方镜像：[Web Security](https://docs.spring.io/spring-boot/4.1.1/reference/web/spring-security.html) ｜ [OAuth2](https://docs.spring.io/spring-boot/4.1.1/reference/security/oauth2.html)
- Spring Security 文档：[方法级授权](https://docs.spring.io/spring-security/reference/7.1/servlet/authorization/method-security.html) ｜ [资源服务器](https://docs.spring.io/spring-security/reference/7.1/servlet/oauth2/resource-server/index.html)
- 站内：[测试](/advanced/testing) ｜ [可观测性](/advanced/observability) ｜ [API 参考](/reference/api)
