// Isi dengan URL /exec deployment Apps Script yang sudah terbukti bekerja.
// CONTOH:
// const BM42_API_URL = "https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxx/exec";
const BM42_API_URL = "PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE";

// Scanner ID untuk perangkat ini.
// Gunakan SCN-01 ... SCN-05 sesuai pembagian panitia.
const BM42_DEFAULT_SCANNER_ID = "SCN-01";

// Polling status checkpoint.
const BM42_STATE_POLL_MS = 5000;

// Delay untuk mencegah QR yang sama terbaca berkali-kali.
const BM42_SCAN_COOLDOWN_MS = 2500;
