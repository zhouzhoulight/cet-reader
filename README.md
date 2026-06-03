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
│   └── 0601.json
└── icons/
    ├── icon-192.svg
    └── icon-512.svg
```

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

## 刷新缓存

如果更新了文件但手机还显示旧版本，打开“设置和数据”，点“刷新应用缓存”。它会注销旧 Service Worker、删除 `cet-reader-cache` 开头的缓存，然后重新加载页面。

## 0530 加载失败排查

- 检查 `data/0530.json` 是否存在。
- 检查 `data/builtin-index.json` 是否存在并引用了 `0530.json`。
- 用本地服务器或 GitHub Pages 打开，不要用 `file://`。
- 点“刷新应用缓存”。
- 必要时清理浏览器缓存后重新打开。
