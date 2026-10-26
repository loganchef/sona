# 平台矩阵

## 当前实现

| 能力 | macOS 12+ | Windows 10+ | Linux | Android | iOS |
|---|---|---|---|---|---|
| 主窗口（首页/历史/词典/设置） | ✅ | ✅ | ✅ | ✅ | ✅ |
| 录音（WebView MediaRecorder） | ✅ 需麦克风授权 | ✅ | ✅ | ✅ 需运行时授权 | ✅ 需 `NSMicrophoneUsageDescription` |
| 全局热键 | ✅ Carbon RegisterEventHotKey | ✅ 低级键盘钩子 | ✅ X11/Wayland | — | — |
| 悬浮胶囊 | ✅ 透明置顶窗口 | ✅ | ✅ 需合成器支持 | —（改用应用内面板） | — |
| 写入光标 | ✅ 剪贴板 + AppleScript 粘贴（需辅助功能） | ✅ 剪贴板 + `SendKeys` | ⚠️ 需 `xdotool` / `wtype` / `ydotool` | ⚠️ 仅剪贴板 | ⚠️ 仅剪贴板 |
| 词典 / 历史 / 统计 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 自动更新 | 待接 `tauri-plugin-updater` | 同左 | 同左 | 应用商店 / 自更新 | App Store |

## 平台特有的坑与对策

**macOS**

- 透明窗口需要 `app.macOSPrivateApi = true`（已开）。
- AppleScript 合成粘贴会触发“Sona 想控制 System Events”，需要 `NSAppleEventsUsageDescription`（已写入 `src-tauri/Info.plist`）。
- 辅助功能权限授予后要重启应用才生效——这是系统行为，UI 里要写清楚。

**Windows**

- `SendKeys('^v')` 在管理员权限窗口里会被 UIPI 挡住：此时回退为“已复制，请按 Ctrl+V”。
- NSIS 安装包与 WebView2 运行时依赖需在 CI 里固定。

**Linux**

- X11 用 `xdotool key --clearmodifiers ctrl+v`；Wayland 用 `wtype -M ctrl v -m ctrl`；两者都没有时 `ydotool`。
- 全局热键在纯 Wayland 下可能需要 compositor 支持，失败会出现在 `get_hotkey_status` 的 `failed` 列表里。

**Android**

- 应用内录音需要 `RECORD_AUDIO` 运行时权限，Tauri 侧用 `tauri-plugin-*` 或自定义 command 申请。
- 真正的“任意输入框听写”需要输入法：见 `docs/PLATFORM-MATRIX.md#android-ime`。
- 悬浮球 / 无障碍插入是输入法之外的备选，但权限成本更高。

**iOS**

- 应用内录音可行；跨应用插入需要 **键盘扩展**（`UIInputViewController`），主应用无法直接往别的应用打字。
- 键盘扩展有内存上限（约 60MB），不要在里面加载大模型；只做 UI，把音频交给主应用或直接发云端。

## Android IME（下一步）

Android 输入法通常把语音 / 笔画 / 剪贴板 / 英文做成四个面板，用 `InputConnection.commitText()` 直接落字。Sona 的实现路径：

1. 原生 `InputMethodService` 壳（Kotlin），只做 UI 与 `commitText`。
2. 通过 JNI 调共享 Rust 管线，或让键盘把音频 base64 交给应用内 Tauri 后端（简化但需要切换应用，体验差）。
3. 权限：`BIND_INPUT_METHOD` + 麦克风；光标上下文用 `InputConnection.getTextBeforeCursor`（只读一次，不重试）。

## iOS 键盘（下一步）

1. `Keyboard` target + `RequestsOpenAccess = YES`（需要用户手动开启“完全访问”）。
2. 音频采集在键盘里受限制，建议：键盘只负责插入，录音由主应用完成，再通过 App Group 共享剪贴板/文件。
3. 或者退一步：键盘里只提供“最近一条听写”的插入按钮。
