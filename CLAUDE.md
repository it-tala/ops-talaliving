# CLAUDE.md — konvensi kerja per sesi

## Satu sesi, satu fitur

Setiap sesi Claude fokus ke **satu fitur/perbaikan**, di satu branch. Jangan
menumpuk beberapa perubahan yang tidak berkaitan ke satu branch/sesi yang sama
— kalau muncul permintaan lain yang lepas dari task berjalan, itu branch baru
(dan sesi baru), bukan tambahan di branch yang sedang berjalan.

## Begitu fitur siap: PR, merge, hapus branch

1. Verifikasi perubahan (typecheck/lint/test/build yang relevan — `npm run
   verify` kalau memungkinkan) sebelum membuka PR.
2. Buka PR ke `main`.
3. Setelah PR di-merge (dan hanya setelah itu — jangan hapus branch yang
   PR-nya masih open atau masih ditinjau CI/reviewer), **langsung hapus
   branch-nya saat itu juga**:
   ```bash
   git push origin --delete <nama-branch>
   ```
   atau lewat tombol "Delete branch" di halaman PR GitHub setelah merge.
4. PR yang ditutup TANPA merge (superseded, dibatalkan, salah arah) juga
   dihapus branch-nya — jangan dibiarkan nyangkut sebagai riwayat mati.

Kalau ada akses ke pengaturan repo, aktifkan **"Automatically delete head
branches"** di GitHub Settings → General, supaya langkah 3 terjadi otomatis
begitu tombol merge ditekan dan tidak bergantung diingat manual.

Tujuannya: daftar branch di repo ini hanya berisi branch yang benar-benar
sedang berjalan, bukan puluhan branch mati dari sesi-sesi lama yang bikin
`git branch -r` / halaman branch GitHub penuh dan sulit dibaca.
