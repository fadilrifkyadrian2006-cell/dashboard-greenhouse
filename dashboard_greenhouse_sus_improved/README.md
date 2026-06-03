# Dashboard Monitoring Greenhouse - Clean UI

Dashboard greenhouse berbasis localhost dengan backend Node.js dan frontend HTML/CSS/JavaScript.

## Cara menjalankan
1. Buka folder ini di VS Code.
2. Buka terminal di folder yang ada file `package.json`.
3. Jalankan:
   ```bash
   npm install
   npm start
   ```
4. Buka browser:
   ```text
   http://localhost:3000
   ```

## Fitur
- Monitoring suhu udara, kelembaban udara, kelembaban tanah, dan intensitas cahaya.
- 8 bed greenhouse dengan status Normal / Warning / Bahaya.
- Mode AUTO dan MANUAL.
- Kontrol aktuator: Pompa Air, Kipas Exhaust, Mist Sprayer, Grow Light.
- Logika otomatis mempertimbangkan batas minimum dan maksimum parameter.
- Tampilan frontend dibuat lebih bersih, tidak terlalu ramai, dan mudah dipresentasikan.


## Perbaikan berdasarkan hasil SUS
- Grafik tren diberi keterangan sumbu X dan Y agar tidak membingungkan.
- Legenda warna Normal / Warning / Bahaya dipisahkan dari rekap status sistem.
- Ditambahkan guideline fitur untuk mode AUTO, mode MANUAL, status bed, dan hubungan tombol aktuator dengan parameter sensor.
- Label pada peta bed dan detail RH/kelembaban tanah dibuat lebih eksplisit.
- Logika Grow Light diperbaiki: ketika Grow Light OFF, intensitas cahaya menurun bertahap; ketika ON, intensitas cahaya meningkat.
