# 四六级朗读学习器 / CET Reader

纯前端 PWA 四六级朗读学习产品，适合手机端打开、添加到主屏幕和部署到 GitHub Pages。项目保留内置每日词库、用户 txt/csv 导入、朗读队列、拼写、中文释义、构词法、随机播放、自动连续播放、收藏、错词/不熟、已移出复习、本地备份和缓存刷新。

本版本重点补齐了品牌 Logo、App Icon、功能图标、引导插画、空状态插画、成就徽章和首页装饰资源，并统一为绿色系 App 质感。

## 文件结构

```text
cet-reader/
├── index.html
├── style.css
├── app.js
├── manifest.json
├── sw.js
├── README.md
├── data/
│   ├── builtin-index.json
│   ├── 0529.json
│   ├── 0530.json
│   ├── 0601.json
│   ├── 0602.json
│   ├── 0603.json
│   └── 0604.json
├── icons/
│   ├── icon.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── apple-touch-icon.png
│   ├── logo-mark.svg
│   └── logo-horizontal.svg
├── assets/
│   ├── onboarding/
│   ├── empty/
│   ├── badges/
│   ├── ui/
│   └── icons/
├── audio/
│   ├── en/
│   ├── zh/
│   └── example/
└── scripts/
    └── validate-data.js
```

## 本地运行

在 `cet-reader` 目录运行：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080/`。不推荐用 `file://` 做正式测试，因为 Service Worker、PWA 安装、离线缓存和部分音频权限需要 HTTP/HTTPS 环境。

## GitHub Pages 部署

上传 `cet-reader` 下所有文件和目录到仓库，然后在 `Settings` -> `Pages` 中选择主分支和对应目录。必须上传 `data/`、`icons/`、`assets/`、`audio/`、`scripts/`。不要上传或引用 `app(8).js`、`0604(2).json`、`index(5).html` 这类带括号的部署文件名。

## 手机添加到主屏幕

iPhone：用 Safari 打开 GitHub Pages 链接，点分享按钮，选择“添加到主屏幕”。

Android：用 Chrome 打开链接，打开菜单，选择“添加到主屏幕”或“安装应用”。

## 0604 词库

`data/0604.json` 已加入，共 32 个词汇/短语。它已经出现在学习首页的 `06/04 核心词库` 入口、词库选择、`data/builtin-index.json`、Service Worker 缓存和 `scripts/validate-data.js` 校验中。

## 视觉资源

App Icon 和 Logo：

- `icons/icon.svg`
- `icons/icon-192.png`
- `icons/icon-512.png`
- `icons/apple-touch-icon.png`
- `icons/logo-mark.svg`
- `icons/logo-horizontal.svg`

引导插画：

- `assets/onboarding/onboarding-1.svg`
- `assets/onboarding/onboarding-2.svg`
- `assets/onboarding/onboarding-3.svg`

空状态插画：

- `assets/empty/empty-learning.svg`
- `assets/empty/empty-favorites.svg`
- `assets/empty/empty-plan.svg`
- `assets/empty/empty-data.svg`

成就徽章：

- `assets/badges/streak-7.svg`
- `assets/badges/streak-30.svg`
- `assets/badges/learn-100.svg`
- `assets/badges/favorite-master.svg`
- `assets/badges/review-pro.svg`
- `assets/badges/persistence.svg`

功能图标位于 `assets/icons/`，包括首页、学习、词库、播放、暂停、上一条、下一条、重播、收藏、错词、移出、设置、搜索、筛选、导入、备份等。

## 音频策略

播放器按以下顺序工作：

1. 先尝试 `entry.audio.en / zh / example` 引用的本地 mp3。
2. 内置音频缺失或加载失败时，回退浏览器 `speechSynthesis`。
3. `speechSynthesis` 不可用时，在页面显示提示。

设置页有三种发音来源：自动、仅系统语音、静音模式。当前版本没有伪造真人 mp3，也没有接入在线 TTS API 或 API Key。

## 浏览器兼容

页面会检测 Safari、Chrome、Edge、百度浏览器、微信内置浏览器和 QQ 内置浏览器。微信/QQ 内置浏览器可能限制朗读、离线缓存或 PWA 安装，页面只提示，不阻止学习。Service Worker 不可用时，核心学习功能仍可打开。

## 缓存刷新

当前版本：

```text
pwa-2026-06-06-redesign-assets-1
```

对应 Service Worker 缓存：

```text
cet-reader-cache-v2026-06-06-redesign-assets-1
```

如果手机仍显示旧版本，进入“词库与设置”，点击右上角刷新按钮。它会注销旧 Service Worker、删除 `cet-reader-cache` 开头的缓存并重新加载。

## 数据校验

运行：

```bash
node --check app.js
node --check sw.js
node --check scripts/validate-data.js
node scripts/validate-data.js
```

校验脚本会检查内置词库、0604 的 32 个指定词、索引 count、entry 字段、核心图标和关键 assets 是否存在。

## 仍是占位

真正 AI 跟读评测仍是后续增强，只做了明确的 UI 占位。真实真人音频也需要后续把 mp3 放入 `audio/en`、`audio/zh`、`audio/example` 并在词条 `audio` 字段里引用；当前版本只提供本地音频优先和系统语音兜底架构。
