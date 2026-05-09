# local-shuffle-windows

ローカルの動画フォルダをシャッフル再生するための Windows 向け軽量プレイヤー。
macOS 版 [SimpleMoview](../SimpleMoview) の Windows 移植で、操作キーを **YouTube と互換**にしてある。

## 起動

初回:
```
start.bat
```
(自動で `npm install` → `npm start`)

2 回目以降は `start.bat` または `npm start` でそのまま起動。

## 機能

- フォルダ内の動画を一覧して順次再生(サブフォルダも再帰的にスキャン)
- 動画クリックで再生/一時停止、ダブルクリックでフルスクリーン
- シャッフル ON/OFF トグル
- 動画終了時に自動で次へ
- 「前へ」は再生履歴スタックから取り出す(直前に観た動画に戻る)
- 前回開いていたフォルダを起動時に自動復元
- 音量・ミュート・シャッフル状態を永続化

対応拡張子: `.mp4` `.m4v` `.mov` `.mkv` `.webm` `.avi` `.wmv`

## キーボードショートカット (YouTube 互換)

| キー | 動作 |
|---|---|
| `Space` / `K` | 再生/一時停止 |
| `←` / `→` | 5 秒戻る/進む |
| `J` / `L` | 10 秒戻る/進む |
| `0` ~ `9` | 0% ~ 90% 地点へジャンプ |
| `Shift+>` (`Shift+.`) | 次の動画 |
| `Shift+<` (`Shift+,`) | 前の動画(履歴あれば履歴) |
| `N` / `P` | 次/前(YouTube にはないが Mac 版互換) |
| `↑` / `↓` | 音量 +5% / -5% |
| `M` | ミュート |
| `F` | フルスクリーン |
| `Esc` | フルスクリーン解除 |
| `S` | シャッフル切替 |
| `O` | フォルダを開く |

## コーデックについて

再生は Chromium 内蔵デコーダで行うため、対応コーデックには制限がある:

- **問題なく再生**: H.264 (mp4/mov/m4v) / VP9 / AV1 / WebM
- **環境依存**: HEVC (H.265)、MKV 内部のコーデック次第
- **再生不可になりがち**: 古い AVI/WMV(コーデック非対応)

再生できないファイルがあれば MP4 (H.264) に再エンコードしてください。

## ポータブル exe のビルド

```
npm install
npm run build
```

`dist\LocalShuffle-0.1.0-portable.exe` が生成される。これ単体をどこに置いても起動できる(設定は `%APPDATA%\local-shuffle-windows\config.json` に保存される)。
初回ビルド時は electron-builder が Electron バイナリと `app-builder` をダウンロードするため数百 MB かかる点に注意。

## ライセンス

このアプリ自体は [MIT License](LICENSE)。
依存パッケージはすべて MIT / ISC / Apache-2.0 / BSD 系の許諾的ライセンス。
ビルド成果物には Electron が同梱する Chromium (BSD-3-Clause) / FFmpeg (LGPL-2.1-or-later) の通知も自動で含まれる(electron-builder が `LICENSES.chromium.html` 等を生成)。

## ファイル構成

```
main.js              Electron main process (BrowserWindow / IPC / electron-store)
preload.js           contextBridge による IPC ブリッジ
renderer/
  index.html         UI ルート
  renderer.js        Playlist + Player + ShortcutHandler
  style.css          ダーク UI
package.json         electron / electron-store
start.bat            起動ラッパー
```
