// 雲端儲存壓力測試 (k6)  —  用法見 TEST_PLAN.md
// k6 run -e BASE_URL=https://staging.example.com -e SCENARIO=load cloud-storage.k6.js
import http from 'k6/http';
import { check, sleep, group, fail } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { randomItem, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import crypto from 'k6/crypto';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const SCENARIO = __ENV.SCENARIO || 'load';
const PASSWORD = __ENV.PASSWORD || 'Test@1234';

// ---- 依實際系統調整的 API 路徑 ----
const API = {
  login: '/api/login',
  files: '/api/files',            // POST 上傳 / GET 列表
  download: (id) => `/api/files/${id}/download`,
  videos: '/api/videos',
  videoStream: (id) => `/api/videos/${id}/stream`,
  photos: '/api/photos',          // POST 上傳 / GET 列表
  thumb: (id, size) => `/api/photos/${id}/thumbnail?size=${size}`,
  photoStatus: (id) => `/api/photos/${id}/status`,
  photoOriginal: (id) => `/api/photos/${id}/original`,
};

// ---- 自訂指標 ----
const uploadSmall = new Trend('upload_1mb_ms', true);
const uploadMid = new Trend('upload_50mb_ms', true);
const uploadLarge = new Trend('upload_500mb_ms', true);
const downloadTime = new Trend('download_ms', true);
const videoRange = new Trend('video_range_ttfb_ms', true);
const thumbLoad = new Trend('thumbnail_load_ms', true);
const thumbReady = new Trend('photo_upload_to_thumb_ms', true);
const integrityFail = new Counter('integrity_failures');
const errRate = new Rate('business_errors');
const bytesUp = new Counter('bytes_uploaded');
const bytesDown = new Counter('bytes_downloaded');

// ---- 測試資料(在 init 階段產生,避免執行中耗 CPU)----
const mk = (mb) => new Uint8Array(mb * 1024 * 1024).fill(97).buffer;
const BIN_1MB = mk(1);
const BIN_50MB = SCENARIO === 'smoke' ? mk(1) : mk(50);
const BIN_500MB = __ENV.ENABLE_LARGE === '1' ? mk(500) : null;
const PHOTO = open(__ENV.PHOTO_FILE || './sample.jpg', 'b'); // 請放一張 3~8MB 的 JPEG

// 所有 user 同時開始,不做爬升;每個情境只決定總人數與時間
const plans = {
  smoke: { users: 5,   duration: '2m' },
  load:  { users: 100, duration: '30m' },
  soak:  { users: 100, duration: '4h' },
};
const S = plans[SCENARIO];
if (!S) fail(`unknown SCENARIO ${SCENARIO}`);

// 總人數依角色平分成 4 組(各約 25%),以 exec 區分行為
const perRole = Math.max(1, Math.round(S.users * 0.25));
const scenario = (exec) => ({ executor: 'constant-vus', vus: perRole, duration: S.duration,
                              gracefulStop: '2m', exec });

export const options = {
  scenarios: {
    file_user: scenario('fileUser'),
    video_viewer: scenario('videoViewer'),
    photo_browser: scenario('photoBrowser'),
    photo_uploader: scenario('photoUploader'),
  },
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '1m' }],
    business_errors: ['rate<0.01'],
    'http_req_duration{kind:api}': ['p(95)<500'],
    upload_1mb_ms: ['p(95)<2000'],
    upload_50mb_ms: ['p(95)<20000'],
    download_ms: ['p(95)<2000'],
    video_range_ttfb_ms: ['p(95)<1000'],
    thumbnail_load_ms: ['p(95)<300'],
    photo_upload_to_thumb_ms: ['p(95)<10000'],
    integrity_failures: ['count==0'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

// ---- 共用 ----
function login() {
  const n = String(((__VU - 1) % 100) + 1).padStart(3, '0');
  const r = http.post(`${BASE_URL}${API.login}`,
    JSON.stringify({ username: `user${n}`, password: PASSWORD }),
    { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'api', name: 'login' } });
  const ok = check(r, { 'login 200': (x) => x.status === 200 });
  errRate.add(!ok);
  if (!ok) return null;
  return { headers: { Authorization: `Bearer ${r.json('token')}` } };
}
let auth;
const A = (extra = {}) => ({ ...auth, ...extra });

function upload(buf, name, trend, label) {
  const r = http.post(`${BASE_URL}${API.files}`,
    { file: http.file(buf, name, 'application/octet-stream') },
    A({ timeout: '300s', tags: { kind: 'transfer', name: label } }));
  const ok = check(r, { [`${label} 2xx`]: (x) => x.status >= 200 && x.status < 300 });
  errRate.add(!ok);
  if (ok) { trend.add(r.timings.duration); bytesUp.add(buf.byteLength); }
  return ok ? r.json('id') : null;
}

function downloadAndVerify(id, expectedSha) {
  const r = http.get(`${BASE_URL}${API.download(id)}`,
    A({ responseType: 'binary', timeout: '300s', tags: { kind: 'transfer', name: 'download' } }));
  const ok = check(r, { 'download 200': (x) => x.status === 200 });
  errRate.add(!ok);
  if (!ok) return;
  downloadTime.add(r.timings.duration);
  bytesDown.add(r.body.byteLength);
  if (expectedSha && crypto.sha256(r.body, 'hex') !== expectedSha) integrityFail.add(1); // TC-11
}

// ---- 角色 1:一般檔案使用者 ----
export function fileUser() {
  if (!auth) auth = login();
  if (!auth) { sleep(5); return; }
  group('file', () => {
    http.get(`${BASE_URL}${API.files}`, A({ tags: { kind: 'api', name: 'list_files' } }));
    const p = Math.random();
    let id, buf, trend, label;
    if (p < 0.6) { buf = BIN_1MB; trend = uploadSmall; label = 'upload_1mb'; }
    else if (p < 0.9) { buf = BIN_50MB; trend = uploadMid; label = 'upload_50mb'; }
    else if (BIN_500MB) { buf = BIN_500MB; trend = uploadLarge; label = 'upload_500mb'; }
    else { buf = BIN_50MB; trend = uploadMid; label = 'upload_50mb'; }
    id = upload(buf, `f_${__VU}_${__ITER}.bin`, trend, label);
    if (id) downloadAndVerify(id, crypto.sha256(buf, 'hex'));
  });
  sleep(randomIntBetween(1, 3));
}

// ---- 角色 2:影片觀看者(HTTP Range 串流 + 隨機 seek)----
export function videoViewer() {
  if (!auth) auth = login();
  if (!auth) { sleep(5); return; }
  group('video', () => {
    const list = http.get(`${BASE_URL}${API.videos}`, A({ tags: { kind: 'api', name: 'list_videos' } }));
    const videos = list.status === 200 ? list.json() : [];
    if (!videos.length) { errRate.add(true); sleep(5); return; }
    const v = randomItem(videos);
    const chunk = 2 * 1024 * 1024;
    let pos = 0;
    const segments = randomIntBetween(10, 20);               // ≈30~60s 播放
    for (let i = 0; i < segments; i++) {
      if (Math.random() < 0.1) pos = randomIntBetween(0, 200) * chunk; // seek
      const r = http.get(`${BASE_URL}${API.videoStream(v.id)}`,
        A({ headers: { ...auth.headers, Range: `bytes=${pos}-${pos + chunk - 1}` },
            responseType: 'none', tags: { kind: 'stream', name: 'video_range' } }));
      const ok = check(r, { 'range 206/200': (x) => x.status === 206 || x.status === 200 });
      errRate.add(!ok);
      if (ok) { videoRange.add(r.timings.waiting); bytesDown.add(chunk); }
      pos += chunk;
      sleep(randomIntBetween(2, 4));                         // 模擬播放緩衝間隔
    }
  });
}

// ---- 角色 3:照片瀏覽者 ----
export function photoBrowser() {
  if (!auth) auth = login();
  if (!auth) { sleep(5); return; }
  group('photo_browse', () => {
    const list = http.get(`${BASE_URL}${API.photos}?limit=30`, A({ tags: { kind: 'api', name: 'list_photos' } }));
    const photos = list.status === 200 ? list.json() : [];
    if (!photos.length) { errRate.add(true); sleep(3); return; }
    const reqs = photos.map((p) => ['GET', `${BASE_URL}${API.thumb(p.id, 'medium')}`, null,
      A({ responseType: 'none', tags: { kind: 'thumb', name: 'thumbnail' } })]);
    for (const r of http.batch(reqs)) {
      const ok = check(r, { 'thumb 200': (x) => x.status === 200 });
      errRate.add(!ok);
      if (ok) thumbLoad.add(r.timings.duration);
    }
    const o = http.get(`${BASE_URL}${API.photoOriginal(randomItem(photos).id)}`,
      A({ responseType: 'none', tags: { kind: 'transfer', name: 'photo_original' } }));
    errRate.add(o.status !== 200);
  });
  sleep(randomIntBetween(1, 2));
}

// ---- 角色 4:照片上傳 + 縮圖 ----
export function photoUploader() {
  if (!auth) auth = login();
  if (!auth) { sleep(5); return; }
  group('photo_upload', () => {
    const t0 = Date.now();
    const r = http.post(`${BASE_URL}${API.photos}`,
      { file: http.file(PHOTO, `p_${__VU}_${__ITER}.jpg`, 'image/jpeg') },
      A({ timeout: '120s', tags: { kind: 'transfer', name: 'photo_upload' } }));
    const ok = check(r, { 'photo upload 2xx': (x) => x.status >= 200 && x.status < 300 });
    errRate.add(!ok);
    if (!ok) return;
    bytesUp.add(PHOTO.byteLength);
    const id = r.json('id');
    // 輪詢縮圖完成(最多 30s)
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      const s = http.get(`${BASE_URL}${API.photoStatus(id)}`, A({ tags: { kind: 'api', name: 'thumb_status' } }));
      ready = s.status === 200 && s.json('thumbnail_ready') === true;
      if (!ready) sleep(0.5);
    }
    errRate.add(!ready);
    if (ready) {
      thumbReady.add(Date.now() - t0);
      for (const size of ['small', 'medium', 'large']) {
        const t = http.get(`${BASE_URL}${API.thumb(id, size)}`,
          A({ responseType: 'none', tags: { kind: 'thumb', name: 'thumbnail' } }));
        errRate.add(t.status !== 200);
        if (t.status === 200) thumbLoad.add(t.timings.duration);
      }
    }
  });
  sleep(randomIntBetween(2, 5));
}
