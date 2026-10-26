# 发布

## 版本号只有一个来源：三处必须一致

发布前同时改：

- `package.json` 的 `version`
- `src-tauri/Cargo.toml` 的 `version`
- `src-tauri/tauri.conf.json` 的 `version`

`Release` 工作流会先校验 tag 和三处版本号，不一致就直接失败，不会产出错版本的安装包。

## 桌面发布

推送 `v*` tag：

```bash
git tag v0.1.0
git push origin v0.1.0
```

随后 `.github/workflows/release.yml` 会：

1. 校验 `v0.1.0` 与三处版本号一致。
2. 构建 macOS Universal、Windows x64、Linux x64。
3. 创建 GitHub Release，并上传 `.dmg`、`.exe` / `.msi`、`.AppImage` / `.deb`。
4. 额外把构建产物上传为 Actions artifact，保留 14 天。

也可以在 Actions 里手动运行 `Release`，输入已存在的 tag 和是否草稿。手动运行会 checkout 该 tag，避免用主分支代码产出错版本的安装包。

当前产物默认**未签名**：

- macOS 首次打开可能被 Gatekeeper 拦截，需要在“系统设置 → 隐私与安全性”放行。
- Windows SmartScreen 可能提示未知发布者。
- 需要正式签名时，再配置 Apple Developer ID / Windows 代码签名证书；不要把证书或密码提交到仓库。

## 移动端构建

`.github/workflows/mobile.yml` 只手动触发，不参与 tag 发布：

- Android：arm64 APK，未签名。
- iOS：Apple Silicon 模拟器 `.ipa`，无签名，不能直接装到真机。

用途是验证移动壳和 Rust 管线能编译，不是应用商店发布。等 Android 签名、iOS 证书和商店资料齐了，再把移动构建接入正式发布。

## 日常检查

`.github/workflows/ci.yml` 在 push 和 PR 上跑：

- 前端：`npm ci`、`typecheck`、`build`
- Rust：`fmt`、`clippy -D warnings`、`test`

发布前本地至少跑一遍：

```bash
npm run typecheck
npm run build
cd src-tauri
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
cargo test
```