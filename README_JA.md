# AILab Note 2.0 (AIN2)

[English README is available here (README.md)](./README.md)

**AILab Note 2.0 (AIN2)** は、放射光イメージング・X線CT・各種実験研究の現場向けに設計された、軽量かつ拡張性の高いデスクトップ型電子実験ノート（ELN）です。

**Python + FastAPI + pywebview** をベースにローカル環境で軽快に動作し、HTML形式の日次実験ログ、**ImageJ / Fiji** とのシームレスな画像連携、エディタ内インライン計算、さらにプラグイン（`Addins/`）による現場メモ連携やローカルLLM/RAG実験補佐機能を備えています。

---

## ✨ 主な機能

- **日次実験ログ＆自動バックアップ:** HTML形式の実験ノート。編集中の `.tmp` / `.bak` 保護に加え、アプリ終了時に指定フォルダへ自動差分バックアップを実行できます。
- **ImageJ / Fiji 連携:** ノート上の画像と ImageJ / Fiji を双方向にやり取りし、解析結果や処理画像を即座に実験ノートへ記録できます。
- **画像上への手書き描画＆インライン計算:** 貼り付けた画像への直接描画（`ain_canvas.js`）、エディタ内での数式計算、独立した共通メモ（Memorandum）・電卓サブウィンドウを搭載しています。
- **放射光ビームライン支援ツール:** リング電流値のOCR取得およびステータス監視の標準プリセット（`SAGA-LS`, `PF`, `PF AR`, `SPring-8`）を備えています。
- **日英バイリンガルUI:** 画面上のボタン1つで日本語・英語表示をリアルタイムに切り替えられます。
- **完全独立プラグイン機構 (`Addins/`):** 本体のコードを変更せず、フォルダ単位で機能の追加・差し替えが可能です。
  - `01_links`: ビームラインや解析ツール等のブックマーク集
  - `02_protocol_manager`: 定型実験プロトコルのテンプレート管理
  - `03_cop_telegram`: Telegram Bot を通じた実験室からの現場メモ・写真取り込み
  - `04_eli_assistant`: ローカルLLM・RAGと連携したAI実験補佐アシスタント「Eli」

---

## 📁 ディレクトリ構成

```text
AIN2/
├── main.py                  # アプリ起動・pywebviewウィンドウ管理・終了時バックアップ
├── AIN2_Manual_JP.pdf       # 総合マニュアル & アドイン開発ガイド（日本語）
├── AIN2_Manual_en.pdf       # 総合マニュアル & アドイン開発ガイド（英語）
├── core/                    # コア基盤（設定管理・ウィンドウ座標永続化・アドインローダー）
├── routers/                 # 本体専用APIルーター（ログ管理・ImageJ連携・OCRツール）
├── templates/               # 画面テンプレート（メインノート・共通メモ・電卓）
├── static/                  # スタイルシート・アイコン・フロントエンドJSエンジン
├── Addins/                  # 独立プラグイン群（差し替え・追加可能）
├── install_mac.sh           # macOS用全自動インストーラ
├── install_win.bat          # Windows用全自動インストーラ
└── requirements.txt         # Python依存パッケージ一覧
```

---

## 🚀 インストールと起動方法

### 動作環境
- Python 3.10 または 3.11（Miniforge / Miniconda 推奨。未導入の場合はインストーラが自動導入します）
- *(任意)* [Fiji / ImageJ](https://fiji.sc/)（画像解析連携を利用する場合）
- *(任意)* Tesseract OCR（蓄積リング電流値のOCR取得を利用する場合）

### macOS の場合
1. リポジトリをクローンします：
   ```bash
   git clone https://github.com/SAGALS-IMG/AIN2.git
   cd AIN2
   ```
2. 自動インストーラを実行します（仮想環境 `ain2` とデスクトップショートカットを作成します）：
   ```bash
   bash install_mac.sh
   ```
   または手動でパッケージを導入して起動します：
   ```bash
   pip install -r requirements.txt
   python main.py
   ```

### Windows 11 の場合
1. リポジトリをクローンします：
   ```bash
   git clone https://github.com/SAGALS-IMG/AIN2.git
   cd AIN2
   ```
2. `install_win.bat` をダブルクリック（またはコマンドプロンプトから実行）して環境構築とショートカット作成を行うか、手動で起動します：
   ```bash
   pip install -r requirements.txt
   python main.py
   ```

---

## 📖 マニュアル・カスタマイズ

- **日本語マニュアル:** [`AIN2_Manual_JP.pdf`](./AIN2_Manual_JP.pdf)（アプリ内の「About / Option」メニューからも開けます）
- **英語マニュアル:** [`AIN2_Manual_en.pdf`](./AIN2_Manual_en.pdf)
- **アドインの拡張:** `Addins/` 配下の各フォルダにある `manifest.json`・`router.py`・`window.html` を参考に、独自の実験装置連携や解析ツールを自由に組み込むことができます（詳細はマニュアル第6章を参照）。

---
## フィードバック・貢献について

本ソフトウェアに関するご感想、ご質問、不具合のご報告などは、**GitHub Issues** よりお気軽にお寄せください。今後の開発の参考にさせていただきます。

なお、本リポジトリは作者個人の開発方針および保守体制の都合上、**外部からの Pull Request（コード修正の受け入れ）は行っておりません**。あらかじめご了承ください。ご自身での改修やカスタマイズについては、Apache License 2.0 の範囲内で自由に行っていただけます。
---
## 📄 ライセンス

本ソフトウェアは **Apache License 2.0** のもとで公開されています。詳細は [LICENSE](./LICENSE) をご覧ください。

Copyright (c) 2026 **九州シンクロトロン光研究センター (SAGA-LS)**  
開発: **米山 明男**（九州シンクロトロン光研究センター / SAGA-LS）


### What's New / 主な更新内容
- **Multi-Protocol Ring Current Acquisition / 蓄積リング電流取得の高度化**:
  - Added support for arbitrary facility additions alongside the fixed `SAGA-LS` default (`SAGA-LS` 基準固定 ＋ 任意施設の無制限追加に対応).
  - Supported direct JSON/text parsing (e.g., `NanoTerasu` `datafile.json`) in addition to image-based OCR (`NanoTerasu` 等のJSON/テキスト形式のデータ取得と画像OCRの自動判別に対応).
- **3-System Color Palettes / 3系統カラーパレットの実装**:
  - Added customizable color palettes and real-time toolbar indicators for Text (`A`), Highlight (`🖊`), and Callout Box (`▭`) borders/backgrounds (文字色・マーカー・ボックス色のカラーパレットとカーソル連動インジケーターを追加).
- **Account Avatar Badge / アカウント識別バッジ**:
  - Replaced the generic user icon with a color-coded initial badge for quick profile identification (アカウント頭文字と自動配色によるアバターバッジを導入).
- **Documentation / マニュアル更新**:
  - Updated JP/EN manuals to Version 2.3.1 (日英マニュアルを v2.3.1 に更新).