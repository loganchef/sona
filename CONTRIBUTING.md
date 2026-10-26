# 参与 Sona

Sona 是 MIT 许可的开源项目。欢迎 issue、设计讨论和 pull request。

## 开发环境

- Node.js 22+
- Rust stable
- macOS：Xcode Command Line Tools
- Linux：WebKitGTK 4.1、`libappindicator3`、`librsvg2`、`patchelf` 等 Tauri 系统依赖
- Windows：WebView2 Runtime（Windows 10/11 通常已自带）

```bash
npm install
npm run dev          # 浏览器 + mock 后端，不需要 Rust
npm run tauri:dev    # 真实桌面应用
```

## 提交前

```bash
npm run typecheck
npm run build
cd src-tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

CI 会跑同样的检查。`cargo` 命令要在 `src-tauri/` 里执行，因为 `Cargo.toml` 不在仓库根目录。

## 代码约定

- Rust 分层：`commands → service → dao → model`。命令层只搬参数和状态，业务放在 service。
- 错误用 `code: detail` 字符串码；前端在 `src/lib/errors.ts` 映射到翻译键，不把英文底层报错直接丢给用户。
- 注释解释「为什么」，不复述代码在做什么。
- 中文与英文文案必须同键同量；新增文案同时改 `src/locales/zh-CN.json` 和 `src/locales/en.json`。
- 破坏性确认统一用 `src/components/common/ConfirmDialog.tsx`，默认焦点在「取消」。
- 不引入 AGPL 代码或运行时；第三方代码不得直接复制，只吸收可独立实现的思路。
- 桌面专属能力加 `#[cfg(not(any(target_os = "android", target_os = "ios")))]` 门控，保证移动端能编译。

## 隐私红线

提交前确认没有把下面这些东西带进仓库或日志：

- 真实 API key、token、cookie、私有接口地址；
- 用户录音、听写正文、历史记录、词典内容；
- `settings.json`、钥匙串导出、诊断包原文。

Sona 的录音只在内存里，不落盘；失败重试的音频也只留到进程退出。不要把调试用的真实音频加进 fixture。

## Pull request

- 一个 PR 只做一件事，说明「改了什么、为什么、怎么验证」。
- UI 改动附截图；桌面和 390px 宽各一张。
- 行为改动补测试；不能补测试的，写清手动验证步骤。
- 不要顺手格式化无关文件，保持 diff 可读。

## 许可

提交即表示你同意以 MIT 许可贡献代码，并保留 `LICENSE` 中的原始版权声明。