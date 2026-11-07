# 视频发布台

基于 Tauri 2、React 19 和 `social-auto-upload` CLI 的本地桌面工作台。Windows 安装包只提供桌面界面；发布引擎仍是本仓库的 Python 项目。

项目主页：[ytton/video-poster](https://github.com/ytton/video-poster)。

## 使用

1. 按上游 [`docs/install.md`](../docs/install.md) 安装仓库主线 CLI，确保项目目录内存在 `.venv/Scripts/sau.exe`、`.venv/Scripts/python.exe` 和 `conf.py`。
2. 启动桌面程序。如果 CLI 项目不在本机的开发目录，在标题栏“设置”中选择实际的仓库目录。
3. 在“账号”页添加账号别名并登录。B站登录会打开独立终端显示二维码。账号会话仍保存在项目 `cookies/` 中。
4. 在“发布”页将视频拖入接收框，或点击接收框选择文件；右侧可切换平台预览并播放本地视频。选账号、补齐平台必填项后加入队列。任务页可查看输出和结果，其他 CLI 动作在“全部命令”页。

桌面端逐项执行任务，避免同一登录会话被并发任务争用。账号别名及任务记录存在应用的 IndexedDB 中，不复制 Cookie。关闭程序会结束正在运行的 CLI 任务；若发布途中退出，请到平台核对最终状态。

## 开发与打包

需要 Node.js、pnpm、Rust、Windows WebView2 和已安装的主项目 CLI。在本目录运行：

```powershell
pnpm install
pnpm tauri dev
pnpm tauri build
```

`pnpm build` 检查 TypeScript 并构建前端。Windows 安装包位于 `src-tauri/target/release/bundle/nsis/`。

## 设计边界

- 桌面端直接启动当前仓库的 `sau`，平台上传与登录仍由原项目维护；CLI 帮助文档中的全部平台和动作会在“全部命令”页动态展示。
- `social-auto-upload` 的 TikTok 入口目前不在统一 `sau` CLI 中，因此桌面端也没有独立 TikTok 命令。
- 打包程序不附带 Python 运行时和浏览器驱动，须先安装主项目。账号登录与真实发布需要对应平台账号和网络环境；构建验收不会代替真实平台发布验收。
- 原项目采用 MIT License。本桌面端沿用同一许可；保留原作者及上游项目署名。
