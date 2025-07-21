# 📈 NIFTY Options OHLC Viewer — Personal Trading Dashboard

This is a **free, non-commercial trading dashboard** currently under development.  
It integrates real-time NIFTY 50 Options data from the **Dhan API** and will feature the **TradingView HTML5 Advanced Charting Library**.

> ⚠️ This project is under development. A live version will be hosted publicly for free access on GitHub Pages or Vercel once integration is complete.

---

## 🔧 Project Purpose

- To visualize real-time NIFTY 50 Options data (OHLC + LTP)
- For personal analysis, education, and open access to traders
- Non-commercial: no ads, payments, or user tracking

---

## 🧩 Features (In Progress)

- Real-time data feed using Dhan API (REST + WebSocket)
- Advanced HTML5 Chart (TradingView)
- Strike, expiry, and call/put selection
- Telegram alerts, RR/LL indicators (internal features)
- Fast, mobile-friendly UI (coming soon)

---

## 🔐 API Key Security

⚠️ **No API keys, access tokens, or client credentials are stored in this repository.**

To run locally:

1. Create a `.env` file based on `.env.example`
2. Add your personal credentials there.

```env
# .env.example
DHAN_CLIENT_ID=your_client_id
DHAN_ACCESS_TOKEN=your_token
