# Blitz Beer Game Simulator

Aplikasi web interaktif *real-time* untuk mensimulasikan fenomena *Bullwhip Effect* (Efek Cambuk) pada rantai pasok. Didesain secara khusus untuk durasi singkat (sekitar 8 menit) sebagai bagian dari kegiatan *lab tour* mahasiswa baru.

## 🎯 Fitur
- **Real-time Multiplayer:** Komunikasi instan antar node (peran) menggunakan Socket.io.
- **4 Ronde Cepat:** Skenario perubahan *demand* dirancang khusus oleh *Host* untuk memicu distorsi pesanan secara cepat.
- **Visualisasi Langsung:** Menampilkan grafik interaktif *Line Chart* di akhir permainan untuk membuktikan *Bullwhip Effect* secara instan.
- **Modern UI:** Antarmuka responsif dan bersih dengan Tailwind CSS.

## 🛠️ Prasyarat
- Node.js (versi 14 atau lebih baru)
- npm (Node Package Manager)

## 🚀 Instalasi & Menjalankan Aplikasi

1. Clone repositori ini atau buka direktori proyek di terminal.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Jalankan server:
   ```bash
   node server.js
   ```
4. Buka browser dan arahkan ke: `http://localhost:3001`

## 👥 Alur Permainan
1. **Asisten Lab (Host)** membuka aplikasi dan menekan **"Create New Room"**. Layar Host akan menampilkan *Room Code*.
2. **4 Mahasiswa** membuka aplikasi, memasukkan *Room Code*, dan masing-masing memilih satu peran:
   - Retailer (Pengecer)
   - Wholesaler (Grosir)
   - Distributor
   - Factory (Pabrik)
3. Setelah semua pemain bergabung, Host menekan **"Start Game"**.
4. **Giliran Berurutan (Ronde 1 - 4):**
   - **Customer (Host)** memasukkan demand.
   - Pesanan tersebut muncul di layar **Retailer**. Retailer lalu memasukkan pesanannya.
   - Pesanan Retailer muncul di layar **Wholesaler**, dan seterusnya hingga **Factory**.
   - Setelah Factory mengirim pesanan, Ronde selesai. Host dapat melanjutkan ke Ronde Berikutnya.
5. Setelah 4 ronde selesai, layar semua orang akan menampilkan **Dashboard Analitik** (*Aha! Moment*) berupa grafik lonjakan pesanan.

## 💡 Skenario Rekomendasi (Demand Host)
Untuk memicu *Bullwhip Effect* secara efektif, Host direkomendasikan memberi input demand:
- **Ronde 1:** 4
- **Ronde 2:** 8 (Lonjakan tajam)
- **Ronde 3:** 4 (Turun kembali, membuat pemain panik stok menumpuk)
- **Ronde 4:** 4 

Selamat bermain!
