# Blitz Beer Game Simulator (DRP Version)

Aplikasi web interaktif *real-time* untuk mensimulasikan fenomena *Bullwhip Effect* (Efek Cambuk) pada rantai pasok multi-eselon, didesain persis dengan standar Modul 1: Pengantar Distribution Requirement Planning (Skenario Krisis Kerupuk Palembang).

## 🎯 Fitur & Pembaruan
- **Giliran Serentak (Simultan):** Seluruh pemain memasukkan pesanan di waktu yang sama, mensimulasikan lingkungan rantai pasok di mana informasi tidak bergerak instan ke seluruh rantai, melainkan diputuskan bersama berdasarkan *demand* periode tersebut.
- **Pipeline Delay:** Terdapat *Shipping/Production delay* selama 2 minggu (barang tiba di SD2, lalu SD1, lalu masuk ke inventori).
- **Backlog & Costing:** Melacak tumpukan backlog dan biaya secara akurat per minggunya (Rp500 untuk *Holding Cost* dan Rp1000 untuk *Backlog Cost*).
- **Dashboard Analitik Lengkap:** Di akhir 25 minggu, menampilkan *Inventory Records Sheet* (IRS), grafik Bullwhip, total biaya, dan KPI lainnya.

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
4. Buka browser dan arahkan ke: `http://localhost:3001` (atau port lain yang tertera di log terminal jika 3001 sedang dipakai).

## 👥 Alur Permainan
1. **Asisten Lab (Host)** membuka aplikasi, menekan **"Create New Room"**, dan membagikan *Room Code*.
2. **4 Mahasiswa** bergabung menggunakan *Room Code* dan memilih peran: Retailer, Wholesaler, Distributor, atau Factory.
3. Setelah semua tergabung, Host menekan **"Mulai Game"**.
4. **Giliran (Minggu 1 hingga 25):**
   - Host (berperan sebagai Customer) memasukkan jumlah permintaan. Secara *default*, minggu 1-4 stabil di angka 4 unit, dan minggu 5 ke atas menjadi 8 unit.
   - Ke-4 pemain (Eselon 1-4) melihat layar dasbor mereka yang menampilkan **Inventori, Backlog, Barang di Perjalanan (SD1, SD2), dan Pesanan Masuk (Incoming Order)**.
   - Semua pemain memasukkan jumlah "Pesanan Keluar" dan menekan **Kirim**.
   - Setelah 5 orang (termasuk Host) mengirimkan angkanya, server secara otomatis akan memproses siklus rantai pasok dan melompat ke minggu berikutnya.
5. Permainan selesai di Minggu ke-25 dan akan mengarahkan semua orang ke Dasbor Analitik Akhir.

Selamat Bermain!
