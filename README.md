# NIFTY Options OHLC Viewer (Personal Trading Dashboard)

This is a **personal-use trading dashboard** that integrates the **HTML5 Advanced Charting Library** with live market data from the **Dhan API**.

---

## 📌 Purpose

- 🔍 Built solely for personal options trading analysis
- 🔄 Uses real-time OHLC and LTP data from Dhan API (WebSocket + REST)
- 🔒 Hosted locally or internally, **not available publicly**
- 🧪 Intended for internal usage only, not monetized or client-facing

---

## ⚙️ Features

- Real-time NIFTY 50 Options OHLC tracking via Dhan API
- Interactive chart using HTML5 Advanced Charting Library
- Strike price & expiry selection
- RR / LL custom indicators (internally used)
- Telegram alerts and sound notifications (in full version)
- Dark UI, optimized for personal trading flow

---

## 🗂️ Project Structure



nifty-ohlc-viewer/
├── frontend/
│ ├── index.html # HTML5 chart integration page
│ └── charting_library/ # Placeholder for TradingView chart library
├── backend/
│ └── server.py 
├── .env.example # Sample env file for API keys
├── README.md # This file
└── requirements.txt # Python dependencies (FastAPI, etc.)
