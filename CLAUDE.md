# CLAUDE.md — Hololive OCG Manager

> 給 AI 助手的專案速覽。這是一個 **hololive 官方卡牌遊戲 (Hololive Official Card Game / OCG, Bushiroad 發行)** 的個人收藏 + 牌組管理工具。純前端靜態網頁，零後端、零 build step、無框架（vanilla JS）。UI 用繁體中文，卡牌資料是日文。

## 一句話架構
打開 `index.html` 就能用的單頁應用：三個分頁（收藏 / 牌組 / 掃描），資料存使用者瀏覽器的 `localStorage`，卡牌資料庫等是靜態 JSON。部署＝把資料夾丟靜態 host（GitHub Pages / Netlify / Vercel）。

## 檔案結構
```
index.html              ← UI 骨架；3 分頁 + 多個 <dialog>（聲明/關於/備份碼/卡片詳細）
style.css               ← 暗色主題，含 RWD（手機版篩選改抽屜、掃描改直向堆疊）
app.js                  ← 全部前端邏輯（vanilla JS，<script defer>）
cards.json              ← 卡牌資料庫，2446 張（scrape.py 產生）
hashes.json             ← 每張卡的 64-bit dHash，掃描比對用（compute_hashes.py 產生）
talents.json            ← 卡名 → [藝人正規名]（藝人篩選的「卡片歸屬」）
talent-categories.json  ← 分類 → [藝人標籤]（驅動藝人下拉選單的分組與清單）
scrape.py               ← 一次性爬蟲（官網），含 selftest
compute_hashes.py       ← 一次性 dHash 計算（需 Pillow），含 selftest
tag-talents.html        ← 【站長專用】藝人標記+分類工具，勿部署給玩家
README.md               ← 執行/部署說明
scrape-cache/           ← 爬蟲 HTTP 快取 + 卡圖快取（重跑省流量）
.claude/launch.json     ← 預覽伺服器設定（python -m http.server 8765）
```

## 怎麼跑
```bash
pip install requests beautifulsoup4 Pillow
python scrape.py            # → cards.json（讀快取，可中斷續跑）
python compute_hashes.py    # → hashes.json（會下載卡圖到 scrape-cache/images/）
python -m http.server 8000  # 開 http://localhost:8000
```
相機 API 需 **https 或 localhost**。部署時放 `cards.json`、`hashes.json`、`talents.json`、`talent-categories.json`；**不要部署 `tag-talents.html`**。

## 資料來源 / 爬蟲
- 官網 `https://hololive-official-cardgame.com/cardlist/`，分頁靠 `cardsearch_ex` AJAX。
- 卡片 `id` = 圖檔名主幹（如 `hSD01-001_OSR`，唯一）；`card_number` = `hSD01-001`（同卡不同稀有度共用）。`set` 由 card_number 前綴推導。
- 卡片 `type` 5 種：`Oshi` / `Holomem` / `BuzzHolomem` / `Support` / `Cheer`。
- `skills[].icons` 會抓技能圖示的 alt（如 `コラボエフェクト`）。

## localStorage 結構（使用者資料）
- `collection`: `{cardId: 數量}`
- `decks`: `[{name, oshi: id, main: {id:count}, cheer: {id:count}}]`
- `filters`: 篩選狀態（含 `fold`、`talent` 等，持久化）
- `collapsedGroups`: 收合的篩選分組鍵陣列
- `disclaimer_seen`: **sessionStorage**（每 session 顯示一次聲明）
- ⚠️ `talents.json` / `talent-categories.json` 是站長維護的靜態檔，**不在** localStorage、玩家無法改。

## 三大功能與「非顯而易見」的設計

### 收藏分頁
- 篩選軸：顏色 / 類型 / Bloom / HP 範圍 / 稀有度 / 補充包 / 標籤 / **藝人（分組下拉）** / 持有狀態 / 關鍵字 / 排序。
- **篩選分組可摺疊**：點 `<h4>` 收合，狀態存 `collapsedGroups`；預設先收起 Bloom/稀有度/補充包/標籤。手機版整個篩選面板是滑入抽屜。
- **摺疊同號卡 (fold)**：相同 `card_number` 的不同稀有度/加工（圖片看不出差別）摺成一張代表卡；primary = 最低稀有度；數量徽章顯示全版本合計 +「N 版本」；點 ▾N 展開各稀有度小卡。2446 張 → 1228 摺疊格。狀態列有「摺疊同號卡」開關。
- **互動**：點卡圖 = +1 收藏；左上角 🔍 = 開卡片詳細。展開的小卡同理（點圖 +1、🔍 詳細）。
- 卡片詳細 modal：屬性、技能（含 icon 徽章）、「其他版本」可點切換、藝人膠囊（唯讀，點了會跳去篩選）。點黑色背景可關閉。

### 牌組分頁
- 規則：1 推し + 50 主 + 20 應援，同名卡上限 4（加入時擋）。
- 每個牌段的挑卡面板有**和收藏一樣的完整篩選**（可摺疊）。
- 缺卡計算 → 購物清單。
- 單一牌組匯出：**牌組碼**（可分享）+ JSON；可貼牌組碼/JSON 匯入。

### 掃描分頁（用感知雜湊，不是 OCR）
- 相機 → 拍攝 → 取卡圖區算 **dHash** → 跟 `hashes.json` 算漢明距離 → 列前 6 候選 → 點選加入。
- **關鍵不變式**：`compute_hashes.py` 的 `dhash()` 與 `app.js` 的 `dhashFromSource()` 必須用**完全相同**的裁切比例 `ART_CROP = {x:0.06, y:0.10, w:0.88, h:0.52}` 與位元順序，改一邊要同步改另一邊。
- **準確率關鍵修正**：取景框用 `getBoundingClientRect` 映射回影片像素（處理 `object-fit:contain` 的信箱黑邊）；`layoutGuide()` 把框擺進可見影像內。另有 7 點 multi-crop jitter 容忍歪斜。
- 點候選（非連續模式）→ +1 並跳到收藏頁、閃爍高亮該卡；連續模式留在掃描頁連拍。
- 同卡號的雜湊碰撞無害（會摺疊在一起）；已驗證跨卡碰撞為 0。

### 匯出 / 備份（都是「可逆編碼」，不是單向 HASH）
- 頂部：全部備份(JSON) / 還原(JSON) / **備份碼** 對話框。
- `HOCG1-` = **牌組碼**：以 card_number 的 16-bit 索引編碼，整副約 130 字元，給分享單一牌組。
- `HOCGX1-` = **全部備份碼**：以印刷 id 的 16-bit 索引編碼收藏+牌組，較長但可貼。
- 使用者常稱「HASH」，但實作是**可逆編碼**（才能匯入還原）。

### 藝人系統（對玩家唯讀，站長預先設定）
- `talents.json`：卡名 → [藝人正規名]。成員卡自動 = [卡名]；組合/Support 卡需站長標。**支援複數藝人**（SorAZ → [ときのそら, AZKi]）。
- `talent-categories.json`：分類 → [藝人標籤]，**驅動下拉選單的分組與「有哪些藝人」**（沒列在這＝下拉看不到＝移除機制）。已依卡片世代標籤自動分成 17 類（JP 各期生/ゲーマーズ/holoX、DEV_IS ReGLOSS/FLOW GLOW、EN Myth/Promise/Advent/Justice、ID 各期）。
- **別名/翻譯**：標籤格式為「`正規名<空格>翻譯`」，例如 `"ときのそら 時乃空"`。程式自動拆：下拉/膠囊**顯示完整字串**，但**比對只用空格前的正規名**（必須一字不差等於卡片 `name`，否則篩不到）。沒翻譯就單寫正規名。
- 相關函式：`talentsOf(card)`→正規名陣列；`canonicalTalent(entry)`；`talentLabel(canonical)`；`buildTalentIndex()`（init 時建 `knownTalents` 與 `talentLabel`）。
- 編輯方式：① 直接改 JSON；② 用 `tag-talents.html`，兩模式：「卡片→藝人」指派、「藝人→分類」設分類+別名欄，匯出對應 JSON 覆蓋專案檔。

### 法律 / 聯絡
- 頂部版權列：© COVER Corp. / hololive production，非官方粉絲工具。
- 進站聲明（每 session 一次）：「個人非營利專案，僅供玩家測試自用，內容僅供參考，不供官方大賽使用。」
- 「關於／問題反饋」對話框：聯絡資訊在 `app.js` 最上方的 `CONTACT` 物件 —— email `paul91809@gmail.com`、Discord 使用者名 `shinonome_inne`（非連結，純文字）、X `https://x.com/paul91809`。空欄位自動隱藏；discord 若填 http 開頭會變連結。

## 慣例 / 注意事項
- 純 vanilla JS，無框架/build/套件管理；CDN 也沒用（dHash 取代了原本的 Tesseract.js）。
- 自我測試：`python scrape.py selftest`、`python compute_hashes.py selftest`、`app.js` 開 `index.html#selftest`（console 印 hamming OK）。
- 數字現況：2446 張卡 / 1228 個 card_number / 80 位藝人 / 17 個藝人分類。
- 開發時 Claude Preview 的 screenshot 工具偶爾逾時；驗證多用 `preview_eval`（在頁面跑 JS 檢查狀態）。
- 改 UI 請改原始檔（不要只用 eval 改 DOM，那是暫時的）。

## 常見修改入口對照表
> 行號會隨改動漂移，以**函式名**為準。除非特別註明，函式都在 `app.js`。

### 收藏 / 篩選
| 想改什麼 | 改哪裡 |
|---|---|
| 新增/修改一個篩選軸 | `matchesFilters()`(~L367) 加判斷 ＋ `setupFilters()`(~L179) 綁 UI ＋ `index.html` 篩選面板 ＋ `state.filters` 預設(~L38) 與 reset-filters 預設 |
| 篩選分組摺疊行為 / 預設收哪些 | `setupFilterCollapse()`(~L303) |
| 卡片排序選項 | `sortCards()`(~L393) |
| 收藏格渲染 / 版面 | `renderCollection()`(~L405)、`cardItemEl()`(~L463)、`groupTileEl()`(~L487) |
| 結果統計文字 | `renderCollection()` 結尾 ＋ `updateCollectionTotal()`(~L434) |

### 摺疊同號卡 / 卡片互動
| 想改什麼 | 改哪裡 |
|---|---|
| 摺疊邏輯（primary 選哪張、合計） | `groupTileEl()`(~L487)、`rarityRank()`(~L24)、`RARITY_ORDER`(~L23) |
| 點圖加入 / 🔍 詳細 | `cardFaceHtml()`+`wireCardFace()`(~L441/451)；展開小卡 `variantChipEl()`(~L530) |
| +/- 數量變更與即時更新 | `adjust()`(~L571)、`refreshCounts()`(~L582)、`adjustGroupDown()`(~L560) |
| 卡片詳細 modal 內容 | `showCardModal()`(~L1453) |

### 牌組
| 想改什麼 | 改哪裡 |
|---|---|
| 牌組規則 / 段落上限（推し/主/應援、4 張） | `renderDeckEditor()`(~L628)、`deckSectionEl()`(~L687) |
| 挑卡面板（篩選/搜尋/加入/上限提示） | `pickerEl()`(~L745)、`newPickerFilter()`(~L740) |
| 缺卡 / 購物清單 | `shoppingListEl()`(~L885) |
| 牌組列表 / 新增 / 匯入鈕 | `renderDeckList()`(~L608)、`setupDeckList()`(~L597) |

### 掃描（dHash）
| 想改什麼 | 改哪裡 |
|---|---|
| 卡圖裁切比例 | `ART_CROP`(~L915) ⚠️ **必須同步改** `compute_hashes.py` 的 `dhash()` |
| 取景框位置/大小 | `layoutGuide()`(~L1040)、`guideRectInVideo()`(~L1058)、`.guide-frame` CSS |
| dHash 演算法 | `dhashFromSource()`(~L978) ⚠️ 必與 `compute_hashes.py dhash()` 一致 |
| 比對 / 候選數 / jitter | `captureAndMatch()`(~L1078)、`hammingHex()`(~L1020) |
| 候選結果 UI / 點選後行為 | `showScanResult()`(~L1122) |
| 相機開關 | `startCamera()`/`stopCamera()`(~L939/964) |

### 匯出 / 備份（可逆編碼）
| 想改什麼 | 改哪裡 |
|---|---|
| 牌組碼格式 | `encodeDeck()`/`decodeDeck()`(~L1194/1211)、前綴 `DECK_CODE_PREFIX`(~L1171) |
| 全部備份碼格式 | `encodeBackup()`/`decodeBackup()`(~L1283/1310)、前綴 `BACKUP_CODE_PREFIX`(~L1281) |
| 備份碼對話框 | `setupBackupCode()`(~L1342) |
| JSON 全部備份/還原 | `setupImportExport()`(~L1375) |

### 藝人
| 想改什麼 | 改哪裡 |
|---|---|
| 卡片→藝人歸屬 | `talents.json`（`tag-talents.html` 指派模式）；讀取邏輯 `talentsOf()`(~L53) |
| 下拉有哪些藝人 / 分組 | `talent-categories.json`（`tag-talents.html` 分類模式）；建下拉 `rebuildTalentList()`(~L326) |
| 別名/翻譯拆解規則 | `canonicalTalent()`(~L64)、`talentLabel()`(~L72)、`buildTalentIndex()`(~L77) |
| 藝人膠囊顯示/點擊 | `showCardModal()`(~L1453) 內 `.talent-pill` |

### 法律 / 聯絡 / 版面
| 想改什麼 | 改哪裡 |
|---|---|
| 聯絡資訊 | `CONTACT` 物件（`app.js` ~L6） |
| 進站聲明文字/頻率 | `setupDisclaimer()`(~L1415) ＋ `index.html` `#disclaimer` |
| 關於對話框 | `setupDisclaimer()` 內 about 區 ＋ `index.html` `#about` |
| 頂部版權列 | `index.html` `.copyright-bar` ＋ `style.css` |
| 配色 / 主題 | `style.css` 的 `:root` 變數 |
| 分頁切換 | `setupTabs()`/`switchTab()`(~L149/155) |

### 資料管線（一次性腳本）
| 想改什麼 | 改哪裡 |
|---|---|
| 重爬卡表 | `scrape.py`（刪 `scrape-cache/index.html`、`search_*.html` 再跑） |
| 解析欄位 / 新卡型 | `scrape.py` 的 `parse_card()` |
| 補算新卡雜湊 | `compute_hashes.py`（自動跳過已算的） |
| 卡圖裁切（雜湊端） | `compute_hashes.py` 的 `dhash()` ⚠️ 必與 `app.js` 的 `ART_CROP`/`dhashFromSource()` 一致 |

## 已知可加（尚未做，非必要）
- 把 talents/分類也納入備份（目前備份只含 collection + decks）。
- 藝人下拉做成「可中文搜尋」（目前是分組 `<select>`）。
- 掃描多幀擷取 / 邊緣偵測自動抓卡框。
- PWA 安裝 / 跨裝置雲端同步（YAGNI，要時用 Supabase，別自己寫 server）。
