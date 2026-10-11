# dsh-remote

A remote-control plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): scan a QR code on your phone and drive your agent from anywhere.

[中文文档](README.md) · [Usage](docs/USAGE.zh-CN.md) · [Notes & Security](docs/NOTES.zh-CN.md)

## Features

- View all sessions and live status (subagents marked) on your phone
- Read conversations with Markdown / table / code-block rendering and paginated history
- Send messages (queued while the agent is busy), cancel runs, create sessions
- Upload images and files from the phone — images are transcoded on-device; the agent reads them through its vision tool
- Three connectivity options: LAN, IPv6 direct, or Cloudflare quick tunnel (works from any network)
- Token authentication, pairing page restricted to localhost, tunnel-source isolation

Phone side needs nothing but a browser (iOS Safari works; no app install, no public IP).

## Install

```bash
pnpm pack          # produces dsh-remote-1.0.0.tgz
dsh plugin --profile desktop add "D:\path\to\dsh-remote-1.0.0.tgz"
```

Restart DeepSeek Harness, then open `http://127.0.0.1:4666/` and scan the QR code with your phone.

For remote access over the internet, enable the **Cloudflare tunnel** toggle in the plugin settings and place `cloudflared` at `~/.dsh/bin/cloudflared` (or set `cloudflaredPath`).

## How it works

The plugin runs inside the DSH Host and lazily resolves the `sessionController` service via `ctx.get()`. It serves its own HTTP server (default port 4666) with token auth, isolated from DSH's own web surface. Uploads land in `~/.dsh/dsh-remote-uploads/`.

See [docs](docs/) for full configuration, usage, and security notes.

## License

MIT. Bundled QR library: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) © Kazuhiko Arase, MIT.
