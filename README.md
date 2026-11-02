# 手機二選一

Static Traditional Chinese site. The main flow is a single-elimination tournament (二選一淘汰賽). 自由比較 and 大家最喜歡 stay available as extra tabs. Phone specs live in `data/phones.json`. The current bracket, including a finished result, is stored in `localStorage` under `phone-versus-tournament-v1`. A finished bracket is posted to Supabase; the tournament and the comparison still run when that request fails.

## 本機預覽

在倉庫根目錄執行：

```bash
python3 -m http.server 8000
```

然後開啟 <http://localhost:8000>。

公開預覽用 GitHub Pages。工作流程在 `.github/workflows/pages.yml`，推上 `main` 或手動 `workflow_dispatch` 時用 `actions/deploy-pages` 發布。倉庫設定要選 Pages → Build and deployment → Source：GitHub Actions。啟用後的網址是 <https://apenguin72.github.io/phone-versus/>。

分頁網址是 `#/`（開賽）、`#/play`、`#/compare`、`#/ranking`。

## 淘汰賽

從 `core: true` 的參賽機型隨機抽出 16、32 或 64 支，沒有重複。目前 91 支全部是參賽機型。開賽按鈕的文字是 `16 強`、`32 強`、`64 強`（數字和「強」之間有空格）。「重新抽」會重抽。「開始比賽」用畫面上這一抽。機型不夠時，該規模的按鈕會停用，並顯示「參賽機型只有 N 支，不能進行 32 強。」這種句子（同樣有空格）。

每場是一張規格比較：左右兩張卡片，中間六列是「晶片單核 (6W)」「相機」「電池」「重量」「更新率」「價格」。點選要留下的卡片。連點只會晉級一次。比賽進行中的回合標題是 `64強`、`32強`、`16強`、`8強`、`準決賽`、`決賽`（「強」前面沒有空格）。準決賽兩名落敗者的 `季軍戰` 排在決賽之後，是最後一場。可以回到上一步。重新整理或按瀏覽器上一頁會留下這一場。開賽頁在比賽還沒結束時顯示「繼續比賽」，已經結束時顯示「查看結果」。

寬度在 840px 以內時，淘汰賽和自由比較都把兩張卡片並排在上方，規格列收到下面。寬度在 640px 以內時，兩邊的字級、照片和列距再縮小；淘汰賽頁另外收起 `.footnote`。手機上常見的 390px 寬會同時套用這兩段。

照片讀 `images/phones/<slug>.webp`（透明背景）。載入失敗時顯示品牌加型號。`image_url` 仍保留遠端來源，給 `scripts/cutout.py` 下載。

比賽結束後，瀏覽器會 POST 到 Supabase 的 `submit_game`。送不出去時冠軍頁的狀態列寫「尚未連線」，本機名次仍在。這行的 class 是 `footnote`。寬度在 640px 以內時，淘汰賽頁會把 `.footnote` 藏起來，窄螢幕上看不到這句。

## 自由比較

「只看參賽機型」預設勾選，清單是 `core: true` 的手機。目前 91 支都是參賽機型，所以取消勾選後清單不變。勾選列旁邊的計數寫成「參賽機型 91 支 · 全部 91 支」。標題下另有一行「Apple、Samsung、Google、Xiaomi、Huawei、OPPO · 91 支參賽機型」。每一邊都可以用品牌篩選，再用搜尋框縮小型號。比較畫面跟淘汰賽同一套橫條，點卡片不會晉級。

| 列 | 規則 |
| --- | --- |
| 晶片單核 (6W) | SocPK SPEC CPU 2026 INT 單核在 6 W 的分數（`spec26_at_6w`），來自 `data/chip_scores.json`。顯示到小數兩位。條長對照已載入手機裡的最高分。`spec26_6w_confidence` 不是 `measured`（資料裡還有 `medium`、`low`，或 null）時，數字旁標「推定」。沒有數字時顯示「待補數據」，不標「推定」。晶片名稱以小字顯示。畫面讀的是 6 W 單核；檔案裡的 Geekbench `single_core`、`multi_core` 不畫出來 |
| 相機（小字：主鏡頭） | 主鏡頭畫素當條長，單位 `MP`。小字是後鏡頭組合，以及 `前鏡頭 18MP` 這種寫法（數字和 MP 之間沒有空格）。資料在 `data/camera_specs.json` |
| 電池（小字：容量） | `battery_mAh`，單位 mAh，較高者條較長 |
| 重量（小字：越輕越好） | `weight_g`，單位公克，畫面寫 `g`。較輕者條較長 |
| 更新率（小字：最高） | `refresh_hz`，單位 Hz，較高者條較長 |
| 價格（小字：首發價） | 新台幣首發價，較低者條較長。數字像 `NT$29,900`。由當地首發價換算的，數字後面加小字（換算）。資料在 `data/launch_prices.json` |

相機、電池、更新率的條長是兩邊較大者的比例。重量和價格是較小者較長。晶片單核的比例見上表。缺資料顯示「待補數據」，並留一條空的淡色軌道。`chip_scores.json`、`camera_specs.json` 或 `launch_prices.json` 整檔讀取失敗時，手機清單仍會出來，對應的列顯示「待補數據」。只有 `data/phones.json` 讀不到時，頁面停在「手機資料無法讀取。請確認 data/phones.json 可以從這個網站載入。」

畫面上的「推定」只看晶片分數的 `spec26_6w_confidence`。`field_status` 的 `confirmed`、`inferred`、`unconfirmed` 用來驗證資料，比較畫面不另作標記。型號名稱和條的顏色是 `accent`（機身主色；抽不到非灰色時用品牌色）。

比較只畫上面六列。`screen_inch`、`resolution`、`os_at_launch`、`official_endurance_hours`、`refresh_note`、`chip_variants`、`notes` 留在 `phones.json`。

沒有 `id`。選單、照片檔名、以及送給 Supabase 的手機代號都用品牌加型號產生的 slug：轉成小寫，把 `+` 和全形 `＋` 換成 `plus`，去掉組合附加符號，其餘非英數字符併成連字號。例如 `Samsung Galaxy S26+` 是 `samsung-galaxy-s26-plus`，`Huawei Mate 70 Pro+` 是 `huawei-mate-70-pro-plus`。

## 大家最喜歡

這個分頁呼叫 `get_rankings`，依社群淘汰賽的每一場勝敗重算 Elo。前三名是放大的卡片；滿三名時由左到右是第 2 名、第 1 名、第 3 名。卡片上有照片、名字、Elo（一位小數）、場次與勝場。下面是完整排名，欄位相同。名單是空的時候顯示「還沒有排名」。Supabase 連不上時顯示「尚未連線」，其他分頁不受影響。slug 對得到手機才放照片；對不到時名字用 slug。

## 資料

`data/phones.json` 是 91 支參賽手機，全部 `core: true`。機身色在 `accent`。6 W 晶片分數、相機與新台幣首發價分別在 `data/chip_scores.json`、`data/camera_specs.json`、`data/launch_prices.json`。

格式見 `data/schema.json`。重點：

- 品牌限 Apple、Samsung、Google、Xiaomi、Huawei、OPPO
- `announce_date` 是全球首發日，須為 2023-11-01 或之後
- `year` 須與 `announce_date` 的年份相同
- `checked_date` 是核對來源的日期，不可早於 `announce_date`
- 直板機。驗證器用字邊界比對 Fold、Flip（不分大小寫），`Galaxy Z Fold` 會擋，`Fold6` 這種數字緊接在後面的寫法不會；型號含「摺疊」或「摺屏」會擋
- `field_status` 涵蓋 `chip`、`battery_mAh`、`weight_g`、`screen_inch`、`resolution`、`refresh_hz`、`os_at_launch`，值是 `confirmed`、`inferred`、`unconfirmed`
- 規格值可以是 null，但只有該欄 `field_status` 為 `unconfirmed` 時才可以
- `official_endurance_hours` 可為 null，不在 `field_status` 裡，比較畫面不顯示
- `os_at_launch` 仍是必填（華為機型預期為 HarmonyOS，可含版本）。比較列已是首發價
- `screen_inch`（吋）與 `resolution`（例如 `2868x1320`）必填，比較畫面不顯示
- `source_type` 為 `official` 或 `gsmarena`；`regulatory` 仍接受。`gsmarena.com` 的 `source_url` 必須搭配 `source_type` `gsmarena`，`gsmarena` 也必須指向 `gsmarena.com`
- `battery_source_url` 與 `battery_source_type`（`filing` 或 `press`）只用於 iPhone，而且必須成對。其他品牌省略這兩個欄位，不要填 null
- `chip_variants` 可省略，可以是字串、字串陣列，或空陣列（空陣列表示沒有其他版本）。比較畫面不顯示
- `refresh_note` 可省略或 null。比較畫面不顯示，也不參與比較
- `image_url` 與 `image_page_url` 可省略或 null，只能是 http(s) 遠端網址。網站顯示的是本地去背圖，不是這個網址
- `image_note` 與 `image_source` 可省略或 null，是文字，不是網址。網站不顯示
- `accent` 是 `#rrggbb`。驗證器要求每支都有
- 每筆要有一個 http(s) `source_url`
- `brand` + `model` 不可重複（不分大小寫，前後空白會被擋下）
- `notes` 可省略。比較畫面不顯示

其他資料檔：

- `data/chip_scores.json`：晶片字串 → 物件。頁面只讀 `spec26_at_6w` 與 `spec26_6w_confidence`。驗證器還要求每筆有 `spec26_6w_method`、`spec26_6w_note`。同一筆裡可以另有 Geekbench 的 `single_core`、`multi_core` 等研究欄位。晶片字串先做完全比對；對不上時再以去掉空白、轉小寫後的子字串比對，取較長的鍵。沒有分數的手機，單核顯示「待補數據」
- `data/camera_specs.json`：`[brand, model, main_camera_mp, rear_cameras, front_camera_mp]`，來源 GSMArena。`main_camera_mp` 與 `front_camera_mp` 是數字，`rear_cameras` 是字串（例如 `48+48+48MP`）
- `data/launch_prices.json`：`[brand, model, launch_price_twd, converted]`。`launch_price_twd` 是新台幣首發價整數。`converted` 為 0 表示台灣官方售價，1 表示由當地首發價換算。缺這列時比較顯示「待補數據」
- `images/phones/<slug>.webp`：600×600 透明圖，手機最長邊 560px。`python3 scripts/cutout.py` 依 `image_url` 下載並寫出 webp，再把抽出的 `accent` 寫回 `data/phones.json`。圖檔已經存在、而且該支已有 `accent` 時會保留原圖；要重做既有圖用 `python3 scripts/cutout.py --force`。需要 `rembg`、Pillow、NumPy、SciPy

## Supabase

匿名收集每一場淘汰賽，再用勝敗重算社群 Elo。前端只用 publishable key（`app.js` 的 `SUPABASE_KEY`），不改資料表、不跑 migration。

每次載入頁面呼叫一次 `record_visit`（切換站內的三個分頁不會再送）。body 是 `{"p_visitor":"<uuid>"}`，用來累計造訪次數並記下這位訪客一次。這組匿名 UUID 存在 `phone-versus-visitor-id`，請求裡沒有時間戳、也沒有 IP。`localhost`、`127.0.0.1` 與網址帶 `?test` 時不送。同一組 ID 寫進 `submit_game` 的 `visitor_id`。

- 專案：<https://dwlgryypcxgaejkislxx.supabase.co>
- 呼叫方式：`POST {URL}/rest/v1/rpc/<fn>`，header 帶 `apikey`、`Authorization: Bearer <publishable key>`、`Content-Type: application/json`

`submit_game` 在冠軍產生時送出，body 是 `{"p": { ... }}`，沒有時間戳：

| 欄位 | 內容 |
| --- | --- |
| `visitor_id` | 存在 localStorage 的隨機 UUID |
| `bracket_size` | 16、32 或 64 |
| `entrants` | 該場抽中的 slug，長度等於規模、不重複 |
| `matches` | 依出賽順序的 `{round, winner, loser}`。`round` 是人數字串：`"64"`、`"32"`、`"16"`、`"8"`、`"4"`（畫面上的準決賽）、`"final"`（決賽）、`"third"`（季軍戰）。規模 16 只會有 `"16"`、`"8"`、`"4"`、`"final"`、`"third"`。淘汰賽共 `bracket_size - 1` 場，再加一場 `"third"`，所以總場數等於 `bracket_size` |
| `top1` / `top2` / `top3` | 冠軍、亞軍、季軍，與決賽、季軍戰的勝敗一致 |
| `device` | 寬度在 640px 以內（含）為 `mobile`，否則 `desktop`。判斷是 `matchMedia("(max-width: 640px)")` |

`get_rankings` 的 body 是 `{}`，回傳 `{phone, elo, matches, wins}`，`phone` 是同一套 slug。伺服器依 `matches` 表的勝敗、K=32、起始 1500 重算 Elo。

連線失敗時，排名頁顯示「尚未連線」。冠軍頁也會寫上同一句，不過寬度在 640px 以內時那一行跟其他 `.footnote` 一起被藏起來。淘汰賽、比較、以及已經存在本機的比賽都還能用。

## 驗證

在倉庫根目錄執行：

```bash
python3 scripts/validate_phones.py
python3 scripts/validate_phones.py --self-test
node --test scripts/bracket.test.mjs
```

`.github/workflows/validate.yml` 在 push 與 pull request 時跑後面兩條（`--self-test` 與 `node --test`）。

對不上晶片分數的手機會印出 `unmatched chip:`。對得上但沒有 `spec26_at_6w` 的手機會印出 `missing spec26_at_6w:`。這兩種都不會讓驗證失敗。手機數不是 91、有人不是 `core: true`、少了去背圖、相機列或價格列，會失敗。驗證失敗時請把訊息留在 pull request，不要直接改研究資料的數值。

手動試造訪計數時，`?test` 要放在 hash 前面，例如 `index.html?test#/compare`，因為 `#/compare?test` 偵測不到。
