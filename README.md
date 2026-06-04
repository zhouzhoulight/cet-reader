# 四六级朗读学习器

一个不依赖后端的本地 PWA 四六级朗读学习器。它可以加载内置词库，也可以导入自己的 txt/csv 资料，支持朗读、拼写、中文释义、构词法开关、随机播放、背诵模式、已学/不熟/已移除管理、本地备份和恢复。

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
│   └── 0603.json
└── icons/
    ├── icon-192.svg
    └── icon-512.svg
```

## 内置词库

- 0529 每日词汇构词法
- 0530 每日词汇构词法
- 0601 每日词汇整理
- 0602 每日词汇构词法
- 0603 每日词汇整理

## 本地运行

在 `cet-reader` 目录里运行：

```bash
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`。不要用 `file://` 直接打开做正式测试，因为 Service Worker、缓存和部分音频权限需要 HTTP/HTTPS 环境。

## GitHub Pages 部署

1. 新建一个 GitHub 仓库。
2. 上传 `cet-reader` 里的所有文件和文件夹。
3. 进入仓库 `Settings` -> `Pages`。
4. Source 选择 `Deploy from branch`。
5. 选择主分支和根目录或对应目录。
6. 等 Pages 生成链接后，用浏览器打开。

## iPhone 使用

1. 用 Safari 打开 GitHub Pages 链接。
2. 点分享按钮。
3. 选择“添加到主屏幕”。
4. 从主屏幕图标打开。

## Android 使用

1. 用 Chrome 打开链接。
2. 打开浏览器菜单。
3. 选择“添加到主屏幕”或“安装应用”。
4. 从桌面图标打开。

## 内置浏览器说明

百度、微信、QQ 等内置浏览器可以临时打开页面，但不推荐正式学习使用。PWA 安装、离线缓存和音频权限在这些浏览器里可能不稳定，优先使用 Safari 或 Chrome。

## 锁屏播放限制

当前项目已做能力范围内的自动连续播放和 Media Session 支持，但 iOS Safari/PWA 可能限制后台 JavaScript 和系统 TTS。不能保证锁屏后 100% 连续播放。最稳定的后台播放需要原生 iOS App。

## 导入词库

推荐导入 txt 或 csv。CSV 建议列顺序为 `term, meaning, morph, example, type`。Word 文档建议先另存为 txt/csv；docx 暂不作为这个 PWA 版本的核心能力。

导入后会先出现预览表，可以编辑英文、中文、构词法、例句和类型。疑似错误行会标红，确认后会保存为用户词库。

## 备份和恢复

点“导出备份”会下载 `cet-reader-backup-YYYY-MM-DD.json`，其中包含学习进度、编辑内容、不熟/已移除状态、设置和用户导入词库。

点“导入备份”选择之前导出的 JSON，会合并恢复数据。它不会导出或导入浏览器 Service Worker 缓存。

学习进度按词库单独保存。重新打开页面会恢复上次词库和该词库上次所在条目；切换词库时也会保存旧词库位置，再恢复新词库自己的位置。

## 语音诊断

设置面板里有“测试英文发音”和“测试中文发音”。诊断区域会显示：

- 当前浏览器是否支持 `speechSynthesis`。
- 可用系统 voices 数量。
- 当前英文 voice 和中文 voice。
- 最近一次朗读错误。
- 最近一次朗读超时。

如果没声音，优先尝试 Safari / Chrome / Edge，检查系统 TTS 语音包。微信、QQ、百度等内置浏览器的语音权限和 PWA 能力不稳定。

## 刷新缓存

如果更新了文件但手机还显示旧版本，打开“设置和数据”，点“刷新应用缓存”。它会注销旧 Service Worker、删除 `cet-reader-cache` 开头的缓存，然后重新加载页面。

如果部署到 GitHub Pages，请确认 `data/` 和 `icons/` 文件夹都已上传。页面启动时会检查核心资源路径；如果缺文件，会在页面上显示错误提示。

新增内置词库时需要同步更新：

- `data/xxx.json`
- `data/builtin-index.json`
- `sw.js` 的 `CORE_ASSETS`
- `app.js` 的核心资源检查列表
- `README.md`

GitHub Pages 部署时不要只上传 `index.html`，必须上传 `data/` 和 `icons/` 文件夹。手机显示旧版本时，先点“刷新应用缓存”。

## 0530 加载失败排查

- 检查 `data/0530.json` 是否存在。
- 检查 `data/builtin-index.json` 是否存在并引用了 `0530.json`。
- 用本地服务器或 GitHub Pages 打开，不要用 `file://`。
- 点“刷新应用缓存”。
- 必要时清理浏览器缓存后重新打开。
