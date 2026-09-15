import { defineConfig } from 'vitepress'

// 《现代 Spring Boot 4.1.1 企业开发快速入门》站点配置
// 基准: Spring Boot 4.1.1 · Spring Framework 7 · JDK 25 LTS · Jakarta EE 11
// 文档参考：https://vitepress.dev/zh/reference/site-config
export default defineConfig({
  lang: 'zh-CN',
  title: '现代 Spring Boot 快速入门',
  description: '面向新手的现代 Spring Boot 4.1.1 企业实战手册：JDK 25 虚拟线程、声明式 HTTP 客户端、API 版本控制、gRPC、生产级安全与可观测性',

  // GitHub Pages 项目站点子路径（仓库名）——本地 docs:dev 预览不受影响
  base: '/springboot-4-docs/',

  // 教程正文里的 localhost 示例链接不做死链检查
  ignoreDeadLinks: [/^https?:\/\/localhost/],

  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/springboot-4-docs/leaf.svg' }]],

  themeConfig: {
    // 顶部导航栏
    nav: [
      { text: '快速入门', link: '/guide/getting-started', activeMatch: '/guide/' },
      { text: '现代实战', link: '/practice/virtual-threads', activeMatch: '/practice/' },
      { text: '生产进阶', link: '/advanced/security', activeMatch: '/advanced/' },
      { text: '参考', link: '/reference/api', activeMatch: '/reference/' }
    ],

    // 左侧边栏：四区知识树
    sidebar: [
      {
        text: '快速入门',
        items: [
          { text: '开始之前：环境与项目创建', link: '/guide/getting-started' },
          { text: 'IoC、依赖注入与配置绑定', link: '/guide/ioc-di' },
          { text: 'REST 接口与分层架构', link: '/guide/rest-api' },
          { text: '配置管理与多环境', link: '/guide/configuration' },
          { text: '日志体系与运行期调级', link: '/guide/logging' }
        ]
      },
      {
        text: '现代实战',
        items: [
          { text: '虚拟线程深度实践', link: '/practice/virtual-threads' },
          { text: 'HTTP 客户端三件套：RestClient 与声明式 @HttpExchange', link: '/guide/http-clients' },
          { text: '内置 API 版本控制', link: '/guide/api-versioning' },
          { text: 'Spring gRPC 服务', link: '/practice/grpc' },
          { text: '消息：Kafka、AMQP 与 JMS', link: '/practice/messaging' },
          { text: '数据访问与事务', link: '/practice/data-access' },
          { text: '缓存：Caffeine 与 Redis', link: '/practice/caching' },
          { text: 'NoSQL：MongoDB 与更多', link: '/practice/nosql' },
          { text: '批处理：Spring Batch', link: '/practice/batch' },
          { text: '任务调度：Quartz', link: '/practice/quartz' }
        ]
      },
      {
        text: '生产进阶',
        items: [
          { text: '安全与鉴权（Spring Security 7）', link: '/advanced/security' },
          { text: '测试策略与 Testcontainers', link: '/advanced/testing' },
          { text: '可观测性与 Actuator 生产参数', link: '/advanced/observability' },
          { text: '打包、镜像与部署', link: '/advanced/deployment' }
        ]
      },
      {
        text: '参考',
        items: [
          { text: '注解、Starter 与配置项速查', link: '/reference/api' },
          { text: '废弃项清理与变更对照清单', link: '/reference/cleanup' }
        ]
      },
      {
        text: '更多',
        items: [
          { text: '核心概念速查（术语表）', link: '/glossary' },
          { text: '常见问题', link: '/faq' },
          { text: '更新日志', link: '/changelog' }
        ]
      }
    ],

    // 内置本地全文搜索（公网站点可换成 Algolia DocSearch）
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            noResultsText: '未找到相关结果',
            resetButtonTitle: '清除查询条件',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' }
          }
        }
      }
    },

    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '最后更新于' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',

    socialLinks: [
      { icon: 'github', link: 'https://github.com/spring-projects/spring-boot' }
    ]
  },

  lastUpdated: true
})
