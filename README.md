# Sona 声落

> 说一句，落一行。

跨桌面与移动端的开源语音输入：按住说一句，识别 → 整理 → 直接落到光标处。
模型任你接（OpenAI 兼容即可），也可以只用一个 key 跑完全程；Sona 本身没有账号、没有中转服务器。模型入口（可选）：[BINRC Desk](https://desk.binrc.com)，一个 key 接入多家语音与整理模型。

Tauri 2 + React 19 + TypeScript + Tailwind 4，Rust 后端分层（commands → service → dao → model）。

![Sona 首页](docs/screenshots/dashboard.png)

---

## 现在能跑什么

| 能力 | 状态 |
|---|---|
| 桌面录音 → 云端 ASR → LLM 整理 → 写入光标 | ✅ 已实现 |
| 静音自动结束 + 10 秒无声放弃（VAD） | ✅ 已实现 |
| 空话/字幕幻觉过滤、全大写英文还原、Markdown 清理 | ✅ 已实现 |
| 悬浮胶囊（全局热键唤起、波形、Esc 取消、自动隐藏） | ✅ 已实现 |
| 按住说话 / 按一下开始（新装默认按住，可在设置切换） | ✅ 已实现 |
| 词典（正确写法 + “常被识别成”反向映射 + 术语表注入） | ✅ 已实现 |
| 历史（原文 / 结果 / 时延 / 只复制标记）+ 今日统计 | ✅ 已实现 |
| 历史手改 + 一键“学词”进词典 | ✅ 已实现 |
| 片段：说「周报模板」，落下一整段（润色后原样替换） | ✅ 已实现 |
| 听写失败保留音频，一键重试（只在内存，退出即丢） | ✅ 已实现 |
| 自定义整理要求（附加提示词） | ✅ 已实现 |
| 风格包：内置日常 / 会议 / 邮件 / 逐字，支持自建、导入导出、保存当前设置、轮换范围与顺序、热键轮换 | ✅ 已实现 |
| 破坏性操作二次确认；风格包表单有未保存修改时，关闭前先问一句 | ✅ 已实现 |
| 近 14 天活跃条 · 语速 · 连续天数 | ✅ 已实现 |
| 改写 / 翻译选中文字（第二快捷键，原地替换） | ✅ 已实现 |
| 菜单栏常驻：开始听写 / 打开 / 历史 / 设置 / 退出 | ✅ 已实现 |
| 快捷键录制控件（按下组合键即写入） | ✅ 已实现 |
| 开关提示音、诊断包导出（不含密钥与正文） | ✅ 已实现 |
| 服务商配置（ASR / 润色各一套；测试连接真的发请求、用屏幕草稿、返回模型数；空 key 不会显示“已就绪”） | ✅ 已实现 |
| API key 优先存系统钥匙串（macOS Keychain / Windows 凭据管理器 / Linux Secret Service） | ✅ 已实现 |
| 首次引导（识别 → 整理 → 快捷键与试一句，可跳过、可重跑） | ✅ 已实现 |
| 单实例：重复启动只聚焦已有窗口，不再抢热键 | ✅ 已实现 |
| 开机自启：登录后静默进菜单栏，快捷键直接可用 | ✅ 已实现 |
| 本机 ASR 服务：开关 + 模型列表探测 + 连通性测试 | ✅ 已实现 |
| 四种整理方式、翻译输出、光标上下文 | ✅ 已实现 |
| 桌面（macOS / Windows / Linux） | ✅ 可构建 |
| Android / iOS 应用壳 | ✅ 同一套 UI，插入走剪贴板回退 |
| Android 输入法、iOS 键盘扩展 | 🚧 见 `docs/PLATFORM-MATRIX.md` |
| 本机模型（sherpa-onnx / Qwen3-ASR） | 🚧 接口已留，未接运行时 |

## 快速开始

```bash
npm install
npm run dev          # 浏览器里跑，用内置 mock 后端（不需要 Rust）
npm run tauri:dev    # 真实桌面应用
npm run typecheck
npm run build
cd src-tauri && cargo test   # 单测 74 个 + 本地 HTTP 契约测试 6 个（起假服务器，不联网）
npm run tauri:build     # macOS .app / Windows .msi / Linux deb·AppImage
```

已构建产物示例：`src-tauri/target/release/bundle/macos/Sona.app`（14.5 MB）。

首次打开会进入引导，按顺序选一遍：

1. **识别**：云端（如硅基流动 SenseVoice、Groq Whisper）或本机 OpenAI 兼容服务；没填 key 的预设会明确显示「未配置」。
2. **整理**：可选 AI 润色（如 DeepSeek），关掉也能听写。
3. **快捷键与试一句**：录一个组合键，在试句框里真的走一遍麦克风，成功后才算完成。

跳过也没关系，之后在 **设置 → 首次设置** 可以随时重跑。完成后按 **开始 / 结束** 键（默认 `Alt+Space`）说一句，文字落到光标；失败时留在剪贴板。

> macOS 的合成粘贴需要给 Sona 开 **辅助功能** 权限；Linux 需要 `xdotool`（X11）或 `wtype`（Wayland）。

## 架构一览

```
React UI（main + capsule 两个窗口）
        │  invoke("run_dictation", { request })
        ▼
commands.rs        薄封装，只做参数与状态搬运
        ▼
service/
  pipeline.rs      解码 → ASR → 文本体检 → 词典改写 → 润色 → 清洗 → 片段展开 → 插入 → 历史
  sanitize.rs      幻觉/空话过滤 · 全大写英文还原 · 模型输出清理
  asr.rs           OpenAI 兼容 /audio/transcriptions
  polish.rs        提示词构建 + /chat/completions（含防“回答用户”护栏）
  dictionary.rs    最长优先、ASCII 大小写不敏感的整词改写
  insert.rs        剪贴板 + 平台合成粘贴，失败自动回退
  hotkey.rs        全局快捷键（桌面），移动端为空实现
  stats.rs         今日 / 累计 / 节省时间 / 连击
        ▼
dao/               settings.json（0600，不含 key）· dictionary.json · snippets.json · history.json
service/secrets.rs 系统钥匙串；不可用时退回 0600 文件并在界面提示
```

界面默认使用实色面板（`solid`），玻璃材质是设置里的可选项，不是默认观感。桌面端一行固定导航，移动端底部标签栏；`首页` 把录音、最近结果、四项今日读数与 14 天活跃条收进同一工作区 · `历史` 原文/结果对照 · `词典` 反向映射与片段 · `风格` 内置与自建风格包 · `服务商` 双通道配置与真实连通性测试 · `设置` 模式、热键、界面语言与当前风格；删除、清空和恢复默认都走应用内确认，不弹系统框。

详见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

## 跨端策略

同一套 React UI + 同一套 Rust 管线，差异只落在三个 Adapter 上：

| 平台 | 录音 | 热键 | 写入光标 |
|---|---|---|---|
| macOS / Windows / Linux | WebView `MediaRecorder` | `tauri-plugin-global-shortcut` | 剪贴板 + 合成粘贴 |
| Android / iOS | 同上（需麦克风权限） | 无（应用内按钮 / 未来输入法） | 剪贴板，用户手动粘贴 |
| 浏览器（开发） | 同上 | 无 | mock |

## 参与

- 开发环境、测试与提交约定：[`CONTRIBUTING.md`](CONTRIBUTING.md)
- 隐私边界与数据流向：[`PRIVACY.md`](PRIVACY.md)
- 安全漏洞报告：[`SECURITY.md`](SECURITY.md)

## 许可

MIT，保留 Sona 贡献者的版权声明。第三方模型与接口归各自厂商所有。
