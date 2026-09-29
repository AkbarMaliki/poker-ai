# Poker 3D

Texas Hold'em No-Limit 3D (Three.js) untuk browser, dengan mode **Lawan Bot** dan **Online** (Firebase Realtime Database). Maksimal 6 kursi per meja.

## Menjalankan

```bash
cd poker
npx serve .        # atau: python -m http.server
```

Buka `http://localhost:3000` (atau port yang ditampilkan). Firebase tidak bisa dipakai dari `file://`, jadi harus lewat server lokal.

Test engine (evaluator tangan, side pot, alur taruhan, simulasi game antar bot):

```bash
node tests/engine.test.js
```

## Cara main

- **Lawan Bot**: pilih jumlah bot (1–5), level (Mudah / Sedang / Sulit / Campur), chip awal, blind, dan kenaikan blind.
- **Online**:
  - **Buat Room Baru** → dapat kode 5 karakter + link undangan (`?room=KODE`). Host bisa menambah/menghapus bot di lobby, lalu tekan **Mulai Game**.
  - **Gabung** dengan kode, atau klik room di daftar "Room terbuka".
  - Pemain yang masuk saat game berjalan duduk di kursi kosong dan ikut mulai hand berikutnya. Jika meja penuh, pemain jadi penonton.
  - Ada timer giliran (15/25/40 detik). Kalau habis: otomatis check, atau fold kalau harus bayar.
  - Pemain yang terputus otomatis check/fold di gilirannya dan bisa masuk lagi lewat link yang sama.
  - **Host pindah otomatis**: kalau host keluar atau terputus lebih dari ~6 detik, pemain lain otomatis jadi host dan game lanjut dari state terakhir.
  - Ada chat di panel 📜.
- Kontrol: drag untuk memutar kamera, scroll/pinch untuk zoom. Keyboard **F** = fold, **C**/spasi = check/call, **R** = raise.

## Aturan yang diterapkan

- Blind SB/BB, heads-up (dealer = SB dan bertindak pertama preflop).
- Min-raise = raise terakhir. All-in yang kurang dari min-raise tidak membuka ulang aksi.
- Side pot untuk banyak all-in, split pot, chip ganjil ke pemenang pertama di kiri dealer.
- Taruhan yang tidak di-call dikembalikan.
- Saat semua pemain all-in, kartu dibuka dan board dibagikan sampai river.
- Blind naik (opsional) mengikuti jadwal ×1, ×2, ×3, ×4, ×6, ×8, ×10, …

## Bot

Bot menghitung equity dengan simulasi Monte Carlo (220 / 450 / 900 iterasi tergantung level) melawan jumlah lawan yang masih aktif, lalu membandingkannya dengan pot odds. Tiap bot punya tingkat agresivitas acak. Bot bisa slowplay tangan kuat, bluff sesekali, dan lebih hati-hati terhadap taruhan besar. Bot level Mudah lebih sering call dan jarang raise.

## Arsitektur

| File | Isi |
| --- | --- |
| `engine.js` | Logika murni (tanpa DOM): evaluator 7 kartu, state mesin taruhan, side pot, AI bot. Dipakai browser & test Node. |
| `scene.js` | Scene Three.js: meja, kartu dan chip bertekstur canvas, avatar, dealer button, nameplate, animasi. |
| `game.js` | Kontroler: loop host/lokal, Firebase (room, presence, aksi, host pindah, chat), HUD, suara WebAudio. |
| `firebase-config.js` | Config Firebase (`window.POKER_FIREBASE_CONFIG`). |

**Online memakai model host-authoritative.** Browser host menjalankan engine dan bot. Pemain lain hanya mengirim aksi (`act`), dan host memvalidasi aksi berdasarkan giliran dan nomor urut state.

Struktur data di `/poker/rooms/{KODE}`:

- `host`, `hn` (nama host), `created`, `status` (`lobby` / `playing` / `ended`), `n` (pemain online), `cfg`
- `players/{uid}`: `{name, conn, t}`. `conn` otomatis jadi `false` saat terputus (onDisconnect).
- `pub`: state publik (JSON string). Kartu tertutup ditulis sebagai `-1`.
- `priv/{uid}`: kartu hole milik pemain itu.
- `full`: state lengkap untuk host pengganti.
- `act/{push}`: antrean aksi dari pemain ke host.
- `chat/{push}`

Room yang lebih tua dari 3 jam dibersihkan otomatis saat ada yang membuka daftar room.

## Firebase Rules

Saat ini database mengizinkan baca/tulis node `poker` (sudah dicek). Jika nanti rules diperketat, tambahkan node `poker` **tanpa menghapus** rules lain (`tetris`, `chess`, `frontier`, …):

```json
"poker": {
  ".read": true,
  ".write": true,
  "rooms": { ".indexOn": ["created"] }
}
```

## Keterbatasan

- Tanpa server dan tanpa Auth, siapa pun yang membaca database secara langsung (bukan lewat game) bisa melihat kartu hole di `priv/` dan `full`, dan host bisa curang. Kartu board berikutnya **tidak** pernah tersimpan di mana pun, karena kartu diambil acak saat dibagikan. Untuk poker uang sungguhan dibutuhkan server otoritatif. Game ini untuk main santai dengan teman.
- Di HP, mode landscape lebih nyaman untuk melihat meja.
