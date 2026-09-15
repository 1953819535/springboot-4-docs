# Spring Boot 企业级快速入门手册（VitePress）

基于 VitePress 的企业级 Spring Boot 4.1.1 快速入门手册，走"分层架构 → REST 规范 → 配置 → 数据访问 → 安全 → 测试 → 部署"的主干路径，按团队协作的企业规范展开。站点为 Spring 品牌绿现代文档风格。

## 环境要求

- Node.js 18+（本机已用 v22 验证）
- 首次使用先执行 `npm install`

## 常用命令

在本目录（桌面 `springboot-docs`）下执行：

| 命令 | 作用 |
| --- | --- |
| `npm install` | 安装依赖（仅首次） |
| `npm run docs:dev` | 本地开发，端口 5273 <http://localhost:5273>，改文件实时热更新 |
| `npm run docs:build` | 构建静态站点，产物在 `docs/.vitepress/dist/` |
| `npm run docs:preview` | 本地预览构建产物 |

## 目录结构

```text
springboot-docs/
├── package.json                    # 依赖与脚本
├── docs/
│   ├── .vitepress/
│   │   ├── config.mts              # 站点配置：导航、侧边栏、搜索
│   │   └── theme/                  # 自定义主题（Spring 品牌绿）
│   ├── index.md                    # 首页（hero + 特性入口）
│   ├── guide/
│   │   ├── getting-started.md      # 开始之前：4.1.1 基线与项目创建
│   │   ├── ioc-di.md               # 核心机制：IoC 与自动配置
│   │   ├── rest-api.md             # REST 接口与分层架构
│   │   └── configuration.md        # 配置管理与多环境
│   ├── advanced/
│   │   ├── data-access.md          # 数据访问与事务
│   │   ├── security.md             # 安全与鉴权
│   │   ├── testing.md              # 测试策略
│   │   └── deployment.md           # 部署与运维
│   ├── reference/api.md            # 注解、Starter 与配置项速查
│   ├── faq.md                      # 常见问题
│   └── changelog.md                # 更新日志
└── README.md
```

## 如何修改 / 续写

| 想做什么 | 改哪里 |
| --- | --- |
| 续写某章内容 | 直接编辑对应 `.md` |
| 新增一篇文档 | 在对应目录新建 `xxx.md`，再到 `config.mts` 的 `sidebar` 加一行 `{ text, link }` |
| 新增一个板块 | 新建目录 + 在 `config.mts` 的 `sidebar` 加一组，如需入导航同步改 `nav` |
| 改顶部导航 | `config.mts` 的 `nav` |
| 改首页标语 / 特性卡 | `docs/index.md` 的 `hero` / `features` |
| 改站点名称 / 描述 | `config.mts` 的 `title` / `description` |
| 调整品牌色 | `docs/.vitepress/theme/custom.css` 的 `--vp-c-brand-*` 变量 |
| 改端口 | `package.json` 里 `--port 5273` |

## 发布

`npm run docs:build` 产物是纯静态文件，GitHub Pages、Vercel、内网 Nginx 均可直接托管；建议把 `docs/` 纳入 git，走 PR 评审维护文档。
