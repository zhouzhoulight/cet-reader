# 四六级朗读学习器 / CET Reader

纯前端 PWA 四六级朗读学习产品，适合手机端打开、添加到主屏幕和部署到 GitHub Pages。项目保留内置每日词库、用户 txt/csv 导入、朗读队列、拼写、中文释义、构词法、随机播放、自动连续播放、收藏、错词/不熟、已移出复习、本地备份和缓存刷新。

当前版本新增 `0611 每日词汇整理`，并修复了 GitHub Pages 资源路径、词库索引加载、PWA 缓存刷新和本地 mp3 优先播放策略。

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
│   ├── 0604.json
│   └── 0611.json
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
    ├── validate-data.js
    ├── validate-audio.js
    └── generate-audio.py
```

## 本地运行

在 `cet-reader` 目录运行：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080/`。不推荐用 `file://` 做正式测试，因为 Service Worker、PWA 安装、离线缓存和部分音频权限需要 HTTP/HTTPS 环境。

## GitHub Pages 部署

上传 `cet-reader` 下所有标准文件和目录到仓库，然后在 `Settings` -> `Pages` 中选择主分支和对应目录。必须保持 `index.html`、`style.css`、`app.js`、`manifest.json`、`sw.js`、`data/`、`icons/`、`assets/`、`audio/`、`scripts/` 这套结构。不要上传或引用 `app(8).js`、`0604(2).json`、`index(5).html` 这类带括号的部署文件名，也不要把 `data/*.json` 摊到根目录。

## 手机添加到主屏幕

iPhone：用 Safari 打开 GitHub Pages 链接，点分享按钮，选择“添加到主屏幕”。

Android：用 Chrome 打开链接，打开菜单，选择“添加到主屏幕”或“安装应用”。

## 内置词库

内置词库统一由 `data/builtin-index.json` 管理，再按其中的 `file` 字段加载 `data/*.json`。当前包含：

- `0529.json`
- `0530.json`
- `0601.json`
- `0602.json`
- `0603.json`
- `0604.json`：32 条
- `0611.json`：21 条，默认作为最新词库推荐

首页“最新词库”入口不在 `app.js` 硬编码 0611，而是读取索引中最后一个内置词库。后续新增词库时，继续更新 `data/builtin-index.json` 和对应 `data/*.json` 即可。

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

## 高质量本地音频生成

先创建环境并安装依赖：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install edge-tts
```

测试生成 0611 前 5 个：

```bash
python3 scripts/generate-audio.py --library 0611.json --limit 5
```

生成某个词库全部：

```bash
python3 scripts/generate-audio.py --library 0611.json
```

生成全部词库：

```bash
python3 scripts/generate-audio.py --all
```

可指定声音和覆盖已有音频：

```bash
python3 scripts/generate-audio.py --library 0611.json --en-voice en-US-AriaNeural --zh-voice zh-CN-XiaoxiaoNeural --overwrite
```

校验音频引用：

```bash
node scripts/validate-audio.js
```

本地预览：

```bash
python3 -m http.server 8080
```

生成脚本会读取 `data/*.json`，跳过 `data/builtin-index.json`，生成：

- `audio/en/{safe_id}.mp3`
- `audio/zh/{safe_id}.mp3`

并把路径写回词条：

```json
"audio": {
  "en": "./audio/en/xxx.mp3",
  "zh": "./audio/zh/xxx.mp3"
}
```

第一版只生成英文 term 和中文 meaning，不默认生成 example 音频。0611 的 `audio` 可以先保持 `{}`，后续再用 `generate-audio.py` 生成。写回 JSON 前会生成 `.bak` 备份；单条 TTS 失败不会中断整批，错误会写入 `logs/audio-errors.json`。

GitHub Pages 部署音频版本时必须上传：

- `data/`
- `audio/en/`
- `audio/zh/`
- `audio/example/`
- `scripts/`
- `sw.js`
- `app.js`

App 会优先播放 JSON 中 `audio.en / audio.zh` 指向的本地 mp3。如果本地 mp3 不存在或加载失败，会自动回退到浏览器 `speechSynthesis`。第一次播放 mp3 时会下载，之后由 Service Worker 使用 `cet-reader-audio-cache-v1` 运行时缓存。不建议把所有 mp3 加入 `CORE_ASSETS`，因为音频文件多，会拖慢首次安装。

## 浏览器兼容

页面会检测 Safari、Chrome、Edge、百度浏览器、微信内置浏览器和 QQ 内置浏览器。微信/QQ 内置浏览器可能限制朗读、离线缓存或 PWA 安装，页面只提示，不阻止学习。Service Worker 不可用时，核心学习功能仍可打开。

## 缓存刷新

当前版本：

```text
pwa-2026-06-11
```

对应 Service Worker 缓存：

```text
cet-reader-cache-v2026-06-11
```

如果手机仍显示旧版本，进入“词库与设置”，点击右上角刷新按钮。它会注销旧 Service Worker、删除 `cet-reader-cache` 开头的缓存并重新加载。

## 数据校验

运行：

```bash
node --check app.js
node --check sw.js
node --check scripts/validate-data.js
node --check scripts/validate-audio.js
node scripts/validate-data.js
node scripts/validate-audio.js
```

校验脚本会检查内置词库索引、0604 的 32 个指定词、0611 的 21 个指定词、索引 count、entry 字段、核心图标、关键 assets 和已声明的音频路径是否存在。`audio: {}` 会被音频校验跳过。

## 仍是占位

真正 AI 跟读评测仍是后续增强，只做了明确的 UI 占位。点击“跟读评测”或“开始跟读”时，页面会提示当前版本仅支持朗读播放与词汇复习。当前版本已支持用 `scripts/generate-audio.py` 生成本地 mp3，并由词条 `audio` 字段优先播放；未生成的词条仍会回退到系统语音。
