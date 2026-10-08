# 雲端儲存系統壓力測試計畫(100 併發使用者)

## 1. 目的與範圍
驗證雲端儲存服務在 **100 位使用者同時在線** 時,執行上傳/下載檔案、影片串流、照片瀏覽、照片上傳並產生縮圖等混合負載下,是否滿足效能、穩定性與資源使用目標,並找出瓶頸。

**範圍內**:API / 物件儲存 / 縮圖(影像處理)worker / 影片串流(HTTP Range)/ 資料庫 / 快取 / 網路。
**範圍外**:第三方 CDN 本身、客戶端 UI 渲染效能、登入供應商(SSO)容量。

## 2. 測試環境與前置條件
| 項目 | 要求 |
|---|---|
| 環境 | 與正式環境同規格的 staging(禁止直接打 production) |
| 壓測機 | 獨立機器(≥4 vCPU / 8GB),與被測 server 同區網,避免壓測機成為瓶頸 |
| 測試帳號 | 100 組(`user001`~`user100`)+ 1 組 admin,預先建立 |
| 測試資料 | 照片 5,000 張(1~8MB)、影片 50 部(50MB~1GB,含 H.264/MP4)、一般檔案 1KB~500MB |
| 工具 | k6(負載)、伺服器上的系統工具(`htop`/`top`、`free`、`iostat`、`nload`/`iftop`、`ss`),手動觀察與記錄 |
| 時鐘 | 壓測機與 server 皆 NTP 同步,方便對齊時間序列 |

## 3. 使用者行為模型(100 VU 比例)
| 角色 | VU 數 | 行為 | Think time |
|---|---|---|---|
| 一般檔案使用者 | 25 | 登入 → 列表 → 上傳(1MB/50MB/500MB 依 60/30/10%)→ 下載 | 1~3s |
| 影片觀看者 | 25 | 取得影片 → Range 串流(每次 1~4MB,連續 30~60s)、隨機 seek | 依播放節奏 |
| 照片瀏覽者 | 25 | 相簿列表 → 縮圖載入(每頁 30 張)→ 開原圖 | 0.5~2s |
| 照片上傳者 | 25 | 上傳 3~8MB 照片 → 輪詢縮圖狀態 → 取得縮圖(3 種尺寸) | 2~5s |

總計 100 VU;所有 VU 共用同一服務,混合執行。

## 4. 測試情境(Test Cases)
| ID | 名稱 | 負載 | 持續 | 通過標準 |
|---|---|---|---|---|
| TC-01 | Smoke 冒煙 | 5 VU | 2 min | 0 錯誤,各 API 可用 |
| TC-02 | 基準 Baseline | 10 VU | 10 min | 建立效能基準值 |
| TC-03 | 目標負載 Load | 0→100 VU(5 min 爬升)維持 30 min | 40 min | 見 §6 全部 SLO |
| TC-04 | 壓力 Stress | 100→150→200 VU,每階段 10 min | 30 min | 找出崩潰點;服務過載後可優雅降級(429/503,不 crash) |
| TC-05 | 尖峰 Spike | 10→100 VU 於 10 秒內 | 10 min | 錯誤率 <2%,2 min 內恢復 |
| TC-06 | 浸泡 Soak | 100 VU(或 70%)| 4~8 hr | 無記憶體洩漏、無 FD/連線洩漏、延遲不漂移 |
| TC-07 | 縮圖佇列飽和 | 僅照片上傳者 100 VU | 15 min | 佇列可消化,縮圖完成延遲 P95 < 10s,無遺失 |
| TC-08 | 大檔併發 | 100 VU 同時上傳 500MB | 10 min | 無 timeout,記憶體不隨檔案數線性暴增(需串流處理) |
| TC-09 | 影片串流頻寬 | 100 VU 全看影片 | 15 min | 無 rebuffer(Range 回應 <1s),頻寬 ≤ 網卡 80% |
| TC-10 | 故障恢復 | Load 中重啟 app / 斷 DB 30s / 儲存節點變慢 | 15 min | 錯誤有界,恢復後自動回到基準 |
| TC-11 | 資料完整性 | 全程 | — | 上傳後下載 SHA-256 100% 一致;縮圖數量 = 上傳照片數 |

## 5. 監控指標(伺服器端)
**手動**於伺服器上觀察並記錄(見 §7 手動監控步驟與 `manual-record-sheet.csv`),記錄時一併寫下時間,以便對照 k6 時間軸。

| 類別 | 指標 | 來源 |
|---|---|---|
| CPU | 總使用率、user/sys/iowait/steal、load average、per-core | `mpstat` / `/proc/stat` |
| Memory | used / available / cache / swap in-out、OOM 事件 | `free` / `vmstat` / `dmesg` |
| Network | RX/TX Mbps、packets/s、errors/drops、TCP 連線數(ESTABLISHED/TIME_WAIT)、retrans | `/proc/net/dev` / `ss` / `netstat -s` |
| Disk | IOPS、throughput MB/s、await、%util、佇列深度 | `iostat -x` |
| Process | app 與縮圖 worker 的 CPU%、RSS、thread 數、FD 數 | `ps` / `/proc/<pid>` |
| 應用層 | 縮圖佇列長度、DB 連線池使用、慢查詢、GC pause、5xx 數 | app metrics / DB log |
| 用戶端 | 回應時間 P50/P90/P95/P99、req/s、錯誤率、上下傳吞吐 | k6 summary |

## 6. SLO / 通過準則(100 VU,TC-03)
| 項目 | 目標 |
|---|---|
| 一般 API(列表、metadata)P95 | < 500 ms |
| 小檔(≤1MB)上傳/下載 P95 | < 2 s |
| 50MB 檔案上傳/下載 P95 | < 20 s |
| 影片首位元組(TTFB / Range 請求)P95 | < 1 s |
| 縮圖載入 P95 | < 300 ms |
| 照片上傳→縮圖完成 P95 | < 10 s |
| 整體錯誤率(HTTP 5xx / timeout) | < 1% |
| CPU 平均 / 峰值 | < 70% / < 90% |
| 記憶體 | available > 20%,無 swap 持續換入,無 OOM |
| 網路 | 持續使用率 < 80% 網卡頻寬,retrans < 1% |
| Disk %util | < 80%,await < 20ms(SSD) |
| 資料完整性 | 100% 雜湊一致 |

> 門檻為建議預設值,請依實際 SLA 調整 `thresholds`(見 `cloud-storage.k6.js`)。

## 7. 執行步驟
1. 部署與正式相同版本至 staging,清空快取,記錄版本/設定(instance 規格、worker 數、連線池)。
2. 在 server 上開好監控視窗(手動,不需腳本),例如:
   - CPU / 程序:`htop`(或 `top`)
   - 記憶體 / swap:`watch -n1 free -m`
   - 網路:`nload` 或 `iftop`;連線數 `ss -s`
   - 磁碟:`iostat -x 1`
   - OOM:`dmesg -T | grep -i oom`
   並在壓測期間依「手動監控時間點」把數值填入 `manual-record-sheet.csv`。
3. 在壓測機執行:
   ```bash
   k6 run -e BASE_URL=https://staging.example.com \
          -e SCENARIO=load \
          --summary-export results/run1/k6-summary.json \
          --out json=results/run1/k6-raw.json \
          cloud-storage.k6.js
   ```
   `SCENARIO` 可選:`smoke` | `load` | `stress` | `spike` | `soak`。
4. 結束後彙整手動記錄表與 k6 報告,繪圖(Excel 即可)。

**手動監控時間點(建議)**:測試開始前(基線)、爬升中、達到目標負載後每 5 分鐘、峰值時刻、降載後 2 分鐘;每次記錄 CPU、記憶體、網路、磁碟、連線數與時間。出現延遲突增或錯誤時,立即多記一筆。
5. 比對 §6 準則,填寫 §9 報告。

## 8. 風險與注意事項
- 壓測前通知相關團隊,避免觸發告警/配額/計費;雲端儲存請確認出站流量費用。
- 測試資料需獨立 bucket/租戶,測後清理。
- 壓測機本身 CPU/網路若飽和會造成假性延遲,請同時監控壓測機。
- 影片/大檔測試可能先打滿頻寬,需分辨是「應用瓶頸」或「網路上限」。
- 先 smoke 再逐步加壓;異常即中止(錯誤率 >20% 連續 1 分鐘自動 abort,已設定於 k6 thresholds)。

## 9. 報告模板
- 測試日期 / 版本 / 環境規格
- 各情境結果表(VU、req/s、P50/P95/P99、錯誤率、吞吐)
- 資源曲線:CPU、Memory、Network、Disk(含與延遲的相關性)
- 瓶頸分析(第一個先飽和的資源)與證據
- 缺陷清單與優化建議(例:縮圖 worker 水平擴充、上傳串流化、CDN 快取、連線池調整)
- 容量結論:目前架構可支撐的最大併發與建議安全水位(≤70%)

## 10. 需依實際系統調整的項目
`cloud-storage.k6.js` 內的 API 路徑(`/api/login`、`/api/files`、`/api/photos`…)為假設的範例,請依實際介面修改 `API` 常數與驗證方式。
