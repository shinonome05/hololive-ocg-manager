# Hololive OCG Manager

私人用的 hololive 官方卡牌遊戲收藏 / 牌組管理工具。
純前端，零後端，零 build step，資料只存在你自己的瀏覽器。

## 功能

- **收藏 tab** — 篩選 / 搜尋所有卡牌，`+` / `-` 調整持有數量
  - 篩選軸：顏色 / 類型 / Bloom / HP 範圍 / 稀有度 / 補充包 / 標籤 / 持有狀態 / 關鍵字
- **牌組 tab** — 建多個牌組，自動驗證 50/20 與同名卡 4 張上限，紅色標記缺少的卡，產生「購物清單」
- **掃描 tab** — 用相機拍整張卡，靠卡圖感知雜湊 (dHash) 比對，列出最相似的前 6 張，點選正確的加入收藏
- 匯出 / 匯入 JSON 備份

## 跑起來

需要 Python 3.10+ 和瀏覽器。

```bash
# 1. 安裝依賴
pip install requests beautifulsoup4 Pillow

# 2. 爬一次官方卡表 (~15-30 分鐘，會快取所以可隨時中斷續跑)
python scrape.py
#  → 產生 cards.json

# 3. 計算每張卡的卡圖雜湊 (掃描功能用，會下載卡圖並快取)
python compute_hashes.py
#  → 產生 hashes.json

# 4. 產生卡圖縮圖 (牌組匯出圖片用；官網 CDN 擋跨網域 canvas，所以要同源小圖)
python make_thumbs.py
#  → 產生 card-img/（WebP，約 50MB）

# 5. 啟動本地伺服器 (相機 API 需要 https 或 localhost)
python -m http.server 8000

# 6. 瀏覽器打開 http://localhost:8000
```

### 更新新卡（出新補充包後）

一行搞定，只抓新卡、不重爬已有的，並自動更新雜湊與縮圖：

```bash
python scrape.py update
```

`update` 會：重新讀取官網列表 → 只抓 `cards.json` 裡沒有的卡 → 合併進 `cards.json` → 自動跑 `compute_hashes.py`＋`make_thumbs.py` 補新卡的雜湊與縮圖 → 補上 `talents.json` 的新卡名（成員卡自動＝卡名）→ 把新卡追加到 `code-order.json`（凍結引繼碼的 index 順序）。已擁有的卡不會重抓。

> 有新藝人的話，記得再開 `tag-talents.html` 分類、匯出 `talent-categories.json`，新藝人才會出現在下拉。
> 非卡片項目（如「デッキ構築ルール」規則橫幅）會自動過濾掉。
> 想整個重建（含既有卡的更正）才需要 `python scrape.py`（完整爬取）。

## 部署到網路

整個資料夾全是靜態檔案，直接丟：
- GitHub Pages
- Netlify drop
- Vercel
- 任何靜態 host

要放的檔：`index.html`、`style.css`、`app.js`、`cards.json`、`hashes.json`、`talents.json`、`talent-categories.json`、`code-order.json`，以及 **`card-img/`（牌組匯出圖片要用；約 50MB）**。不要放 `tag-talents.html`、`scrape-cache/`。

> **`code-order.json` 一定要一起部署**：引繼碼（牌組碼／備份碼）用「卡片在此清單的位置」編碼。缺這檔會退回每次重新排序，改版新增卡片就會讓既有引繼碼解出錯卡。`update` 只會把新卡追加到尾端、不重排。

> **線上匯出圖片**：牌組匯出圖片是把卡圖畫到 canvas 再輸出 PNG，但官網 CDN 擋跨網域 canvas 匯出，所以改用同源的 `card-img/` 縮圖。**沒有部署 `card-img/` 的話，線上匯出的圖會變成文字佔位而非真卡圖。** 改快取版本時把 `index.html` 裡的 `?v=N` 加一號。

每個使用者的收藏存在他們自己的瀏覽器 localStorage，不需要後端。

## 檔案

```
hololive TCG Manager/
├── index.html         ← UI
├── style.css          ← 樣式
├── app.js             ← 全部邏輯（含 dHash 比對）
├── cards.json         ← 卡牌資料庫 (scrape.py 產生)
├── hashes.json        ← 卡圖雜湊 (compute_hashes.py 產生，掃描功能用)
├── talents.json          ← 藝人標記 (卡名→[藝人])
├── talent-categories.json← 藝人下拉的分類/清單 (分類→[藝人])
├── code-order.json       ← 引繼碼 index 凍結順序 (scrape.py update 維護，只追加)
├── card-img/          ← 卡圖縮圖 WebP (make_thumbs.py 產生，牌組匯出圖片用)
├── make_thumbs.py     ← 一次性縮圖產生 (需 Pillow)
├── tag-talents.html   ← 站長專用藝人標記+分類工具（不要部署給玩家）
├── scrape.py          ← 一次性爬蟲
├── compute_hashes.py  ← 一次性卡圖雜湊計算
└── scrape-cache/      ← HTTP / 卡圖快取 (重跑時省流量)
```

部署上線時放 `cards.json`、`hashes.json`、`talents.json`、`talent-categories.json`、`code-order.json`（純靜態檔，全使用者共用）。
`tag-talents.html` 是站長標記工具，**不需要也不建議部署給玩家**。

## 藝人標記與分類

主程式的「藝人」篩選對玩家唯讀，由兩個站長維護的檔案驅動：

- **`talents.json`**（卡名 → 藝人陣列）：哪張卡屬於哪些藝人。成員卡自動以卡名為藝人；組合/特殊/Support 卡需手動標。一張卡可標複數藝人（例：SorAZ → ［ときのそら, AZKi］）。
- **`talent-categories.json`**（分類 → 藝人陣列）：決定下拉選單的**分組**與**哪些藝人會出現**。只列在這裡的藝人才會出現在下拉（沒列＝從下拉移除）。初版已依卡片世代標籤自動分好（JP 各期生／holoX／DEV_IS／EN 各組／ID 各期）。

兩者都用 `tag-talents.html` 編輯（站長專用，**勿部署給玩家**）：
1. 本機 `python -m http.server` → 開 `localhost:8000/tag-talents.html`
2. **「卡片→藝人」模式**：替卡指派藝人 → 匯出 `talents.json`
3. **「藝人→分類」模式**：替每個藝人選分類；清空分類＝從下拉移除該藝人 → 匯出 `talent-categories.json`
4. 把下載的檔覆蓋專案裡的同名檔，再上線

> 兩個檔都是單純的 JSON（`{ 鍵: [字串...] }`），也可以直接用文字編輯器手改。

## 掃描原理 (卡圖感知雜湊)

每張卡的卡圖先在 `compute_hashes.py` 算成 64-bit dHash 存進 `hashes.json`（全部約 100 KB）。掃描時相機畫面即時算同樣的 dHash，跟資料庫所有卡算漢明距離，列出最相近的 6 張。

- 比 OCR 卡號可靠：卡號在實體卡上太小、相機難對焦；卡圖大且 dHash 對模糊/光線/小角度都魯棒。
- 純前端、無外部函式庫、不需網路（hashes.json 載入後）。
- 距離參考：≤10 信心高、≤16 中等。即使最佳匹配不是正解，正解幾乎都在前 6 名內，點一下即可。

`app.js` 的 `dhashFromSource()` 與 `compute_hashes.py` 的 `dhash()` 必須維持相同的裁切比例與位元順序，改一邊要同步改另一邊（已實測同圖兩端差異僅 ~8 bits，不影響檢索 rank #1）。

相機 API **必須在 https 或 localhost 下執行**。直接 file:// 開啟相機會失敗。
