# 手機二選一

Static Traditional Chinese site. The main flow is a single-elimination tournament (二選一淘汰賽). 自由比較 and 大家最喜歡 stay available as extra tabs. Phone specs live in `data/phones.json`. An in-progress bracket is stored in `localStorage`. Finished brackets are submitted to Supabase when the network is available; the site still runs offline.

## 本機預覽

在倉庫根目錄執行：

```bash
python3 -m http.server 8000
```

然後開啟 <http://localhost:8000>。

公開預覽用 GitHub Pages。工作流程在 `.github/workflows/pages.yml`，會在推上 `main` 時用 `actions/deploy-pages` 發布。倉庫設定要選 Pages → Build and deployment → Source：GitHub Actions。啟用後的網址是 <https://apenguin72.github.io/phone-versus/>。

## 淘汰賽

從 `core: true` 的參賽機型隨機抽出 16、32 或 64 支，沒有重複。目前 91 支全部是參賽機型。「重新抽」會重抽。「開始比賽」用畫面上這一抽。機型不夠時，該規模的按鈕會停用並說明原因。

每場是一張規格比較：左右兩張卡片，中間是晶片、相機、電池、重量、更新率、價格。點選要留下的卡片。連點只會晉級一次。回合名稱是 64強、32強、16強、8強、準決賽、決賽，最後一場是準決賽兩名落敗者的季軍戰。可以回到上一步。重新整理或按瀏覽器上一頁不會清掉進行中的比賽。

窄螢幕（390px 寬）把兩張卡片並排在上方，規格列收在下面，整場比較放在同一個畫面裡。

照片讀 `images/phones/<slug>.webp`（透明背景）。載入失敗時顯示品牌加型號。`image_url` 仍保留遠端來源，給 `scripts/cutout.py` 重新下載。

比賽結束後，瀏覽器會 POST 到 Supabase 的 `submit_game`。送不出去時冠軍頁顯示「尚未連線」，本機名次仍在。

## 自由比較

預設列出參賽機型。每一邊都可以用品牌篩選，再用搜尋框縮小型號。比較畫面跟淘汰賽同一套橫條，只是點卡片不會晉級。

| 列 | 規則 |
| --- | --- |
| 晶片 | SocPK SPEC CPU 2026 INT 單核在 6 W 的分數（`spec26_at_6w`），來自 `data/chip_scores.json`。顯示到小數兩位。條長對照全部手機裡的最高分。`spec26_6w_confidence` 不是 `measured` 時，數字旁標「推定」。晶片名稱以小字顯示。頁面不顯示 Geekbench，也不顯示多核 |
| 相機 | 主鏡頭畫素當條長。小字是後鏡頭組合，以及前鏡頭畫素。資料在 `data/camera_specs.json` |
| 電池 | mAh 較高者條較長 |
| 重量 | 公克較輕者條較長 |
| 更新率 | Hz 較高者條較長 |
| 價格 | 新台幣首發價，較低者條較長。數字像 `NT$29,900`。由當地首發價換算的，數字後面加小字（換算）。資料在 `data/launch_prices.json` |

晶片單核的條長對照全部手機裡最高的 6W 分數。其餘各條是兩邊數值相對較大者的比例。缺資料顯示「待補數據」，並留一條空的淡色軌道。型號名稱和條的顏色是 `accent`（機身主色；抽不到非灰色時用品牌色）。

沒有 `id`。選單、照片檔名、以及送給 Supabase 的手機代號都用品牌加型號產生的 slug：轉成小寫，把 `+` 換成 `plus`，其餘非英數字符併成連字號。例如 `Samsung Galaxy S26+` 是 `samsung-galaxy-s26-plus`。

## 大家最喜歡

這個分頁呼叫 `get_rankings`，依社群淘汰賽的每一場勝敗重算 Elo。前三名放大照片和名字，下面是完整排名。Supabase 連不上時顯示「尚未連線」，其他分頁不受影響。

## 資料

`data/phones.json` 是 91 支參賽手機，全部 `core: true`。規格數值沿用原本的研究資料，這次只留下指定型號、補上 `accent`，並另存晶片分數與相機規格。

格式見 `data/schema.json`。重點：

- 品牌限 Apple、Samsung、Google、Xiaomi、Huawei、OPPO
- `announce_date` 是全球首發日，須為 2023-11-01 或之後
- 直板機；型號含 Fold、Flip、摺疊、摺屏 會被驗證擋下
- 每個規格欄位都要有 `field_status`（`confirmed`、`inferred`、`unconfirmed`）
- 規格值可以是 null，但只有該欄 `field_status` 為 `unconfirmed` 時才可以
- `official_endurance_hours` 可為 null，不在 `field_status` 裡
- `source_type` 為 `official` 或 `gsmarena`；`regulatory` 仍接受
- `battery_source_url` 與 `battery_source_type`（`filing` 或 `press`）只用於 iPhone，而且必須成對。其他品牌省略這兩個欄位，不要填 null
- `chip_variants` 可省略，可以是字串或字串陣列
- `refresh_note` 可省略或 null
- `image_url` 與 `image_page_url` 可省略或 null，只能是 http(s) 遠端網址。網站顯示的是本地去背圖，不是這個網址
- `accent` 是 `#rrggbb`
- 每筆要有一個 http(s) `source_url`
- `brand` + `model` 不可重複
- `notes` 可省略

其他資料檔：

- `data/chip_scores.json`：晶片字串 → 物件，含 `spec26_at_6w`（6 W 單核）、`spec26_6w_method`、`spec26_6w_confidence`、`spec26_6w_note`。頁面只讀 6 W 單核。晶片字串先做完全比對；對不上時再以去掉空白、轉小寫後的子字串比對，取較長的鍵。沒有分數的手機，單核顯示「待補數據」
- `data/camera_specs.json`：`[brand, model, main_camera_mp, rear_cameras, front_camera_mp]`，來源 GSMArena
- `data/launch_prices.json`：`[brand, model, launch_price_twd, converted]`。`launch_price_twd` 是新台幣首發價。`converted` 為 0 表示台灣官方售價，1 表示由當地首發價換算。缺這列時比較顯示「待補數據」
- `images/phones/<slug>.webp`：600×600 透明圖，最長邊 560px。用 `python3 scripts/cutout.py` 重建（需要 `rembg`、Pillow、NumPy、SciPy）

## Supabase

匿名收集每一場淘汰賽，再用勝敗重算社群 Elo。前端只用 publishable key（`app.js` 的 `SUPABASE_KEY`），不改資料表、不跑 migration。

- 專案：<https://dwlgryypcxgaejkislxx.supabase.co>
- 呼叫方式：`POST {URL}/rest/v1/rpc/<fn>`，header 帶 `apikey`、`Authorization: Bearer <publishable key>`、`Content-Type: application/json`

`submit_game` 在冠軍產生時送出，body 是 `{"p": { ... }}`，沒有時間戳：

| 欄位 | 內容 |
| --- | --- |
| `visitor_id` | 存在 localStorage 的隨機 UUID |
| `bracket_size` | 16、32 或 64 |
| `entrants` | 該場抽中的 slug，長度等於規模、不重複 |
| `matches` | 依出賽順序的 `{round, winner, loser}`。淘汰賽共 `bracket_size - 1` 場，再加一場 `round: "third"`，所以總場數等於 `bracket_size`。決賽的 `round` 是 `"final"` |
| `top1` / `top2` / `top3` | 冠軍、亞軍、季軍，與決賽、季軍戰的勝敗一致 |
| `device` | 寬度 640px 以下為 `mobile`，否則 `desktop` |

`get_rankings` 不帶參數，回傳 `{phone, elo, matches, wins}`，`phone` 是同一套 slug。伺服器依 `matches` 表的勝敗、K=32、起始 1500 重算 Elo。

連線失敗時頁面顯示「尚未連線」。淘汰賽、比較、以及已經存在本機的比賽都還能用。

## 驗證

```bash
python3 scripts/validate_phones.py
python3 scripts/validate_phones.py --self-test
node --test scripts/bracket.test.mjs
```

對不上晶片分數的手機會印出 `unmatched chip:`。對得上但沒有 `spec26_at_6w` 的手機會印出 `missing spec26_at_6w:`。這兩種都不會讓驗證失敗。驗證失敗時請把訊息留在 pull request，不要直接改研究資料的數值。
