# 手機二選一

Static Traditional Chinese site. The main flow is a single-elimination tournament (二選一淘汰賽). 自由比較 stays available as a second tab. Data lives in `data/phones.json`. There is no backend; an in-progress bracket is stored in `localStorage`.

## 本機預覽

在倉庫根目錄執行：

```bash
python3 -m http.server 8000
```

然後開啟 <http://localhost:8000>。

公開預覽用 GitHub Pages。工作流程在 `.github/workflows/pages.yml`，會在推上 `main` 時用 `actions/deploy-pages` 發布。倉庫設定要選 Pages → Build and deployment → Source：GitHub Actions。啟用後的網址是 <https://apenguin72.github.io/phone-versus/>。

## 淘汰賽

從 `core: true` 的主力機型隨機抽出 16、32 或 64 支，沒有重複。「重新抽」會重抽。「開始比賽」用畫面上這一抽。主力機型不夠時，該規模的按鈕會停用並說明原因。

每場兩張卡片，點選要留下的一支。連點只會晉級一次。回合名稱是 64強、32強、16強、8強、準決賽、決賽，最後一場是準決賽兩名落敗者的季軍戰。可以回到上一步。重新整理或按瀏覽器上一頁不會清掉進行中的比賽。

照片只讀遠端 `image_url`。沒有網址或載入失敗時，顯示品牌加型號的色塊。不要把圖片檔放進這個倉庫。

## 自由比較

預設只列出 `core: true` 的主力機型。關掉「只看主力機型」會看到全部機型。每一邊都可以用品牌篩選，再用搜尋框縮小型號。

比較列：

| 列 | 規則 |
| --- | --- |
| 晶片 | 只顯示。若有 `chip_variants`（字串或陣列），以較小字顯示在主晶片下方 |
| 電池容量 | mAh 較高者標「較優」。官方續航時數若有，只顯示在下面，不參與比較。若有 `battery_source_url`，在容量旁加小連結：`filing` 顯示「申報」，`press` 顯示「報導」 |
| 重量 | 公克較低者標「較優」 |
| 螢幕 | 尺寸與解析度一起顯示，不比較優劣 |
| 刷新率 | 以 `refresh_hz`（一般最高值）比較，較高者標「較優」。`refresh_note` 顯示在數字下方，例如遊戲模式才到 144 Hz |
| 作業系統 | 只顯示發表時的系統 |

`field_status` 為 `unconfirmed` 的欄位會標「未確認」。數值是 null 時只顯示「未確認」；有數值時仍顯示數字，並加上「未確認」。任一邊未確認時，該列不標「較優」。`inferred` 會在數值旁標「推定」，仍可比較。

來源列會顯示 `source_type`（官方、GSMArena；`regulatory` 仍保留相容）以及規格連結。`notes` 有內容時會出現在備註列。

沒有 `id`。選單用品牌加型號產生穩定 slug：轉成小寫，把 `+` 換成 `plus`，其餘非英數字符併成連字號。例如 `Samsung Galaxy S26+` 是 `samsung-galaxy-s26-plus`。

## 資料

`data/phones.json` 是研究同事提供的清單，請不要為了通過畫面而改裡面的數值。

格式見 `data/schema.json`。重點：

- 品牌限 Apple、Samsung、Google、Xiaomi、Huawei、OPPO
- `announce_date` 是全球首發日，須為 2023-11-01 或之後
- 直板機；型號含 Fold、Flip、摺疊、摺屏 會被驗證擋下
- 每個規格欄位都要有 `field_status`（`confirmed`、`inferred`、`unconfirmed`）
- 規格值可以是 null，但只有該欄 `field_status` 為 `unconfirmed` 時才可以
- `official_endurance_hours` 可為 null，不在 `field_status` 裡
- `source_type` 為 `official` 或 `gsmarena`；`regulatory` 仍接受
- `battery_source_url` 與 `battery_source_type`（`filing` 或 `press`）可省略，或成對出現，也可同為 null
- `chip_variants` 可省略，可以是字串或字串陣列
- `refresh_note` 可省略或 null
- `image_url` 與 `image_page_url` 可省略或 null，只能是 http(s) 遠端網址。`image_note` 與 `image_source` 是選填文字。不要提交圖片檔
- 每筆要有一個 http(s) `source_url`
- `brand` + `model` 不可重複
- `notes` 可省略

## 驗證

```bash
python3 scripts/validate_phones.py
python3 scripts/validate_phones.py --self-test
node --test scripts/bracket.test.mjs
```

驗證失敗時請把訊息留在 pull request，不要直接改研究資料的數值。
