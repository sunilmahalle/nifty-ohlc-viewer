# main.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
import asyncio, requests, csv, os
from datetime import datetime, timedelta, timezone , time
import pytz
from feed import FeedManager
from utils.option_csv_utils import generate_option_csvs
from utils.option_csv_utils import download_instrument_csv, copy_to_frontend
from feed import TabsFeedManager
from fastapi import Request
from email_utils import send_email_html
from fastapi.responses import JSONResponse

from dhanhq import dhanhq
from fastapi import Body
from fastapi.middleware.cors import CORSMiddleware
import random
import httpx



app = FastAPI()
feed_manager = FeedManager()

# Constants
ACCESS_TOKEN = "
SECURITY_ID = "13"
DHAN_CLIENT_ID = ""

EXCHANGE_SEGMENT = "IDX_I"
INSTRUMENT = "INDEX"
INTERVAL = 1
OPTION_CSV_DIR = "option_csvs"
IST = pytz.timezone("Asia/Kolkata")
dhan = dhanhq(DHAN_CLIENT_ID, ACCESS_TOKEN)

# Mount frontend
app.mount("/static", StaticFiles(directory="../frontend"), name="static")

@app.get("/")
async def root():
    return FileResponse("../frontend/index.html")
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("✅ Client connected")

    await feed_manager.connect()
    feed_task = asyncio.create_task(feed_manager.stream_data(websocket))

    try:
        while True:
            await asyncio.sleep(1)  # Keep the connection alive
    except WebSocketDisconnect:
        print("❌ WebSocket disconnected")
        await feed_manager.disconnect()
        feed_task.cancel()
        await feed_task

@app.websocket("/ws-tabs")
async def websocket_tabs(websocket: WebSocket):
    await websocket.accept()
    print("✅ Tabs WebSocket connected")

    tabs_feed = TabsFeedManager()
    await tabs_feed.connect()
    tick_task = asyncio.create_task(tabs_feed.stream_data(websocket))

    try:
        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        print("❌ Tabs WebSocket disconnected")
        await tabs_feed.disconnect()
        tick_task.cancel()
        await tick_task

from fastapi import Request

@app.post("/place-dhan-order")
async def place_dhan_order(request: Request):
    data = await request.json()

    try:
        security_id = str(data["security_id"])
        side = data["side"].upper()
        order_type = data.get("order_type", "MARKET").upper()
        trigger_price = float(data.get("trigger_price") or 0.0)
        price = float(data.get("price", 0.0))
        quantity = int(data.get("quantity", 75))

        # 🧠 Validate SL-M
        if order_type in ["STOP_LOSS", "STOP_LOSS_MARKET"] and not trigger_price:
            return {"error": "❌ trigger_price is required for SL/SL-M orders"}

        # ✅ Dhan Enums
        txn_type = dhan.BUY if side == "BUY" else dhan.SELL
        ord_type = {
            "MARKET": dhan.MARKET,
            "LIMIT": dhan.LIMIT,
            "STOP_LOSS": dhan.SL,
            "STOP_LOSS_MARKET": dhan.SLM
        }.get(order_type, dhan.MARKET)

        # ✅ HARD CODED AMO FLAGS
        after_market_order = True

        # ✅ Construct and print payload
        payload = {
            "security_id": security_id,
            "exchange_segment": dhan.NSE_FNO,
            "transaction_type": txn_type,
            "quantity": quantity,
            "order_type": ord_type,
            "price": price,
            "product_type": dhan.MARGIN,
            "validity": "DAY",
            "trigger_price": trigger_price,
            "after_market_order": after_market_order,
        }

        print("📤 Payload to Dhan:", payload)

        # ✅ Place order
        order = dhan.place_order(**payload)

        print("📦 Raw Dhan Response:", order)

        return {
            "orderId": order.get("orderId", "UNKNOWN"),
            "orderStatus": order.get("orderStatus", "FAILED")
        }

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": str(e)}

@app.get("/order-trade/{order_id}")
async def get_trade(order_id: str):
    url = f"https://api.dhan.co/v2/trades/{order_id}"
    headers = {
        "Content-Type": "application/json",
        "access-token": ACCESS_TOKEN
    }

    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)

    return response.json()

@app.get("/historical")
async def get_intraday_history():
    try:
        now = datetime.now(IST)
        from_date = now - timedelta(days=30)
        to_date = now

        payload = {
            "securityId": SECURITY_ID,
            "exchangeSegment": EXCHANGE_SEGMENT,
            "instrument": INSTRUMENT,
            "interval": INTERVAL,
            "oi": False,
            "fromDate": from_date.strftime("%Y-%m-%d %H:%M:%S"),
            "toDate": to_date.strftime("%Y-%m-%d %H:%M:%S")
        }

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "access-token": ACCESS_TOKEN
        }

        response = requests.post("https://api.dhan.co/v2/charts/intraday", headers=headers, json=payload)

        if response.status_code != 200:
            return JSONResponse(status_code=500, content={"error": "Failed to fetch historical data"})

        data = response.json()
        candles = []
        for i in range(len(data["timestamp"])):
            candles.append({
                "time": int(data["timestamp"][i]),  # already in UTC seconds
                "open": data["open"][i],
                "high": data["high"][i],
                "low": data["low"][i],
                "close": data["close"][i]
            })

        return candles

    except Exception as e:
        print("❌ Exception in /historical:", e)
        return JSONResponse(status_code=500, content={"error": "Internal server error"})


@app.get("/nifty-csv")
async def get_today_first5_nifty():
    try:
        now_ist = datetime.now(IST)
        weekday = now_ist.weekday()  # 0 = Monday, 6 = Sunday

        # If today is Saturday (5) or Sunday (6), go back to Friday
        if weekday == 5:
            target_day = now_ist - timedelta(days=1)  # Saturday → Friday
        elif weekday == 6:
            target_day = now_ist - timedelta(days=2)  # Sunday → Friday
        else:
            target_day = now_ist

        # Define the 5-minute window: 9:14 AM to 9:19 AM IST
        start_ist = target_day.replace(hour=9, minute=14, second=0, microsecond=0)
        end_ist = start_ist + timedelta(minutes=5)

        payload = {
            "securityId": SECURITY_ID,
            "exchangeSegment": EXCHANGE_SEGMENT,
            "instrument": INSTRUMENT,
            "interval": 1,
            "oi": False,
            "fromDate": start_ist.strftime("%Y-%m-%d %H:%M:%S"),
            "toDate": end_ist.strftime("%Y-%m-%d %H:%M:%S")
        }

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "access-token": ACCESS_TOKEN
        }

        response = requests.post("https://api.dhan.co/v2/charts/intraday", headers=headers, json=payload)

        if response.status_code != 200:
            print("❌ Failed to fetch from Dhan:", response.status_code, response.text)
            return JSONResponse(status_code=500, content={"error": "Failed to fetch today's 5 candles"})

        data = response.json()

        if not data.get("timestamp"):
            print("❌ No data received from Dhan:", data)
            return JSONResponse(status_code=500, content={"error": "Empty candle data"})

        candles = []
        for i in range(len(data["timestamp"])):
            candles.append({
                "time": int(data["timestamp"][i]),
                "open": data["open"][i],
                "high": data["high"][i],
                "low": data["low"][i],
                "close": data["close"][i]
            })

        candles_sorted = sorted(candles, key=lambda x: x["time"])

        return candles_sorted[:5]

    except Exception as e:
        print("❌ Exception in /nifty-csv:", str(e))
        return JSONResponse(status_code=500, content={"error": "Internal server error", "details": str(e)})


@app.post("/generate-option-csvs")
async def generate_csvs(background_tasks: BackgroundTasks):
    background_tasks.add_task(run_csv_generation)
    return {"status": "CSV generation started in background"}

async def run_csv_generation():
    try:
        await generate_option_csvs()
        print("✅ CSV generation completed.")
    except Exception as e:
        print("❌ CSV generation failed:", e)

@app.on_event("startup")
def ensure_instruments_csv():
    try:
        download_instrument_csv()
        copy_to_frontend()
        print("🚀 Instrument CSV ready – backend start‑up complete.")
    except Exception as e:
        print("⚠️  Could not prepare instruments.csv:", e)


@app.get("/option_csv_data")
async def option_csv_data(symbol: str = Query(...)):
    filename = symbol.replace(" ", "_") + ".csv"
    filepath = os.path.join(OPTION_CSV_DIR, filename)

    if not os.path.exists(filepath):
        return JSONResponse(content=[], status_code=404)

    candles = []
    try:
        with open(filepath, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                ist_dt = datetime.strptime(row["Time"], "%Y-%m-%d %H:%M").replace(tzinfo=IST)
                utc_ts = int(ist_dt.astimezone(timezone.utc).timestamp())
                candles.append({
                    "time": utc_ts,
                    "open": float(row["Open"]),
                    "high": float(row["High"]),
                    "low": float(row["Low"]),
                    "close": float(row["Close"])
                })
        return candles
    except Exception as e:
        print(f"❌ Error reading {filename}:", e)
        return JSONResponse(content=[], status_code=500)

# @app.on_event("startup")
# def ensure_instruments_csv():
#     try:
#         download_instrument_csv()
#         copy_to_frontend()
#         print("🚀 Instrument CSV ready – backend start‑up complete.")
        


#     except Exception as e:
#         print("⚠️  Could not prepare instruments.csv:", e)


@app.get("/get-security-id")
def api_get_security_id(symbol: str = Query(...)):
    from utils.option_csv_utils import get_security_id
    sid = get_security_id(symbol)
    if sid:
        return {"symbol": symbol, "security_id": sid}
    return {"error": "Symbol not found"}, 404
@app.get("/option_history_live")
async def option_history_live(symbol: str = Query(...)):
    from utils.option_csv_utils import get_security_id
    from datetime import datetime, timedelta
    import requests

    sec_id = get_security_id(symbol)
    if not sec_id:
        return {"error": "Symbol not found"}, 404

    # NSE 2025 Trading Holidays (from your image) in YYYY-MM-DD format
    exchange_holidays = {
        "2025-02-01", "2025-02-19", "2025-02-26",
        "2025-03-14", "2025-03-31", "2025-04-01", "2025-04-10",
        "2025-04-14", "2025-04-18", "2025-05-01", "2025-05-12",
        "2025-08-15", "2025-08-27", "2025-09-05", "2025-10-02",
        "2025-10-21", "2025-10-22", "2025-11-05", "2025-12-25"
    }

    def is_trading_day(date):
        # Skip weekends
        if date.weekday() >= 5:  # Saturday=5, Sunday=6
            return False
        # Skip listed exchange holidays
        if date.strftime("%Y-%m-%d") in exchange_holidays:
            return False
        return True



    # ✅ Use the latest valid trading day
    # ✅ Get last 5 valid trading days
    def get_last_n_trading_days(n):
        days = []
        date = datetime.now().date()
        while len(days) < n:
            if is_trading_day(date):
                days.append(date)
            date -= timedelta(days=1)
        return sorted(days)

    trading_days = get_last_n_trading_days(2)
    from_date = datetime.combine(trading_days[0], time(9, 14))
    to_date   = datetime.combine(trading_days[-1], time(15, 30))


    print(f"📌 Fetching intraday for {symbol} (ID: {sec_id})")
    print(f"⏱️ From: {from_date} → To: {to_date}")

    payload = {
        "securityId": sec_id,
        "exchangeSegment": "NSE_FNO",  # or NSE_FNO if that's what works
        "instrument": "OPTIDX",
        "interval": 1,
        "oi": False,
        "fromDate": from_date.strftime("%Y-%m-%d %H:%M:%S"),
        "toDate": to_date.strftime("%Y-%m-%d %H:%M:%S")
    }

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "access-token": ACCESS_TOKEN
    }

    try:
        response = requests.post("https://api.dhan.co/v2/charts/intraday", headers=headers, json=payload)
        if response.status_code != 200:
            print("❌ Dhan API Error:", response.text)
            return {"error": "Failed to fetch data"}, 500

        data = response.json()
        candles = []
        for i in range(len(data["timestamp"])):
            candles.append({
                "time": int(data["timestamp"][i]),
                "open": data["open"][i],
                "high": data["high"][i],
                "low":  data["low"][i],
                "close": data["close"][i]
            })

        print(f"✅ {len(candles)} candles fetched.")
        return candles

    except Exception as e:
        print("❌ Exception fetching option history:", e)
        return {"error": "Exception occurred"}, 500
@app.get("/option_5min_agg")
async def option_5min_agg(symbol: str = Query(...)):
    from utils.option_csv_utils import get_security_id
    from datetime import datetime, timedelta, time
    from zoneinfo import ZoneInfo

    IST = ZoneInfo("Asia/Kolkata")
    now = datetime.now(IST)
    
    # ✅ If today is Saturday (5) or Sunday (6), use last Friday
    if now.weekday() == 5:
        date_today = now.date() - timedelta(days=1)  # Saturday → Friday
    elif now.weekday() == 6:
        date_today = now.date() - timedelta(days=2)  # Sunday → Friday
    else:
        date_today = now.date()

    start_ist = datetime.combine(date_today, time(9, 14), tzinfo=IST)
    end_ist = start_ist + timedelta(minutes=5)

    sec_id = get_security_id(symbol)
    if not sec_id:
        print(f"❌ Security ID not found for symbol: {symbol}")
        return {"error": "Symbol not found"}, 404

    print(f"🔍 Resolved symbol: '{symbol}' → Security ID: {sec_id}")

    payload = {
        "securityId": sec_id,
        "exchangeSegment": "NSE_FNO",
        "instrument": "OPTIDX",
        "interval": 1,
        "oi": False,
        "fromDate": start_ist.strftime("%Y-%m-%d %H:%M:%S"),
        "toDate": end_ist.strftime("%Y-%m-%d %H:%M:%S")
    }

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "access-token": ACCESS_TOKEN
    }

    try:
        res = requests.post("https://api.dhan.co/v2/charts/intraday", headers=headers, json=payload)
        if res.status_code != 200:
            print("❌ Dhan API Error:", res.text)
            return {"error": "Failed to fetch 1-min data"}, 500

        raw = res.json()
        if not raw.get("timestamp"):
            print(f"⚠️ No 1-min candles found for {symbol}")
            return []

        candles = [
            {
                "time": int(raw["timestamp"][i]),
                "open": raw["open"][i],
                "high": raw["high"][i],
                "low": raw["low"][i],
                "close": raw["close"][i]
            }
            for i in range(len(raw["timestamp"]))
        ]

        candles.sort(key=lambda x: x["time"])
        candles = candles[:5]

        o = candles[0]["open"]
        h = max(c["high"] for c in candles)
        l = min(c["low"] for c in candles)
        c = candles[-1]["close"]
        t = candles[0]["time"]

        print(f"📊 Aggregated 5-min for {symbol} (ID: {sec_id}) → O:{o} H:{h} L:{l} C:{c} @ {datetime.fromtimestamp(t, tz=IST)}")

        return [{
            "time": t,
            "open": o,
            "high": h,
            "low": l,
            "close": c
        }]

    except Exception as e:
        print("❌ Exception in /option_5min_agg:", e)
        return {"error": "Exception"}, 500




@app.get("/option_history_by_id")
async def option_history_by_id(security_id: str = Query(...)):
    from datetime import datetime, timedelta, time

    # NSE 2025 Trading Holidays (from your image) in YYYY-MM-DD format
    exchange_holidays = {
        "2025-02-01", "2025-02-19", "2025-02-26",
        "2025-03-14", "2025-03-31", "2025-04-01", "2025-04-10",
        "2025-04-14", "2025-04-18", "2025-05-01", "2025-05-12",
        "2025-08-15", "2025-08-27", "2025-09-05", "2025-10-02",
        "2025-10-21", "2025-10-22", "2025-11-05", "2025-12-25"
    }

    def is_trading_day(date):
        # Skip weekends
        if date.weekday() >= 5:  # Saturday=5, Sunday=6
            return False
        # Skip listed exchange holidays
        if date.strftime("%Y-%m-%d") in exchange_holidays:
            return False
        return True

    def get_latest_trading_day():
        date = datetime.now().date()
        while not is_trading_day(date):
            date -= timedelta(days=1)
        return date

    # ✅ Use the latest valid trading day
    target_date = get_latest_trading_day()

    from_date = datetime.combine(target_date, time(9, 14))
    to_date   = datetime.combine(target_date, time(15, 30))

    payload = {
        "securityId": security_id,
        "exchangeSegment": "NSE_FNO",
        "instrument": "OPTIDX",
        "interval": 1,
        "oi": False,
        "fromDate": from_date.strftime("%Y-%m-%d %H:%M:%S"),
        "toDate": to_date.strftime("%Y-%m-%d %H:%M:%S")
    }

    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "access-token": ACCESS_TOKEN
    }

    try:
        response = requests.post("https://api.dhan.co/v2/charts/intraday", headers=headers, json=payload)
        if response.status_code != 200:
            print("❌ Dhan Error:", response.text)
            return {"error": "Failed to fetch"}, 500

        data = response.json()
        candles = []
        for i in range(len(data["timestamp"])):
            candles.append({
                "time": int(data["timestamp"][i]),
                "open": data["open"][i],
                "high": data["high"][i],
                "low":  data["low"][i],
                "close": data["close"][i]
            })

        return candles
    except Exception as e:
        print("❌ Error:", e)
        return {"error": "Exception"}, 500

@app.websocket("/ws-mini")
async def websocket_mini(websocket: WebSocket):
    await websocket.accept()
    print("✅ Mini WebSocket connected")

    from feed import MiniFeedManager  # see next step
    mini_feed = MiniFeedManager()
    await mini_feed.connect()
    tick_task = asyncio.create_task(mini_feed.stream_data(websocket))

    try:
        while True:
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        print("❌ Mini socket disconnected")
        await mini_feed.disconnect()
        tick_task.cancel()
        await tick_task

@app.post("/batch_option_history")
async def batch_option_history(symbols: list[str]):
    from utils.option_csv_utils import get_security_id
    from datetime import datetime, timedelta, time

    # Trading days logic
    def is_trading_day(date):
        holidays = {
            "2025-02-01", "2025-02-19", "2025-02-26",
            "2025-03-14", "2025-03-31", "2025-04-01", "2025-04-10",
            "2025-04-14", "2025-04-18", "2025-05-01", "2025-05-12",
            "2025-08-15", "2025-08-27", "2025-09-05", "2025-10-02",
            "2025-10-21", "2025-10-22", "2025-11-05", "2025-12-25"
        }
        return date.weekday() < 5 and date.strftime("%Y-%m-%d") not in holidays

    def get_trading_range():
        date = datetime.now().date()
        days = []
        while len(days) < 5:
            if is_trading_day(date):
                days.insert(0, date)
            date -= timedelta(days=1)
        return (
            datetime.combine(days[0], time(9, 14)),
            datetime.combine(days[-1], time(15, 30))
        )

    from_date, to_date = get_trading_range()

    results = {}
    for symbol in symbols:
        sec_id = get_security_id(symbol)
        if not sec_id:
            results[symbol] = {"error": "ID not found"}
            continue

        payload = {
            "securityId": sec_id,
            "exchangeSegment": "NSE_FNO",
            "instrument": "OPTIDX",
            "interval": 1,
            "oi": False,
            "fromDate": from_date.strftime("%Y-%m-%d %H:%M:%S"),
            "toDate": to_date.strftime("%Y-%m-%d %H:%M:%S")
        }

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "access-token": ACCESS_TOKEN
        }

        try:
            res = requests.post("https://api.dhan.co/v2/charts/intraday", headers=headers, json=payload)
            if res.status_code == 200:
                data = res.json()
                candles = [
                    {
                        "time": int(data["timestamp"][i]),
                        "open": data["open"][i],
                        "high": data["high"][i],
                        "low": data["low"][i],
                        "close": data["close"][i],
                        "volume": data["volume"][i]

                    } for i in range(len(data["timestamp"]))
                ]
                results[symbol] = candles
            else:
                results[symbol] = {"error": "API error", "status": res.status_code}
        except Exception as e:
            results[symbol] = {"error": str(e)}

    return results


@app.post("/auto-hedge-put")
async def auto_hedge_put(request: Request):
    data = await request.json()
    main_strike = float(data["strike"])
    expiry = "2025-07-10"

    try:
        response = dhan.option_chain(
            under_security_id=13,
            under_exchange_segment="IDX_I",
            expiry=expiry
        )

        oc = response.get("data", {}).get("data", {}).get("oc", {})
        if not oc:
            return {"error": "Option chain empty"}

        put_candidates = []
        for strike_str, strike_data in oc.items():
            strike = float(strike_str)
            if strike < main_strike:
                pe_data = strike_data.get("pe", {})
                ltp = float(pe_data.get("last_price", 0))
                if 3 <= ltp <= 7:
                    put_candidates.append({
                        "strike": strike,
                        "ltp": ltp
                    })

        if not put_candidates:
            return {"error": "No suitable hedge PUT found"}

        best = sorted(put_candidates, key=lambda x: abs(x["ltp"] - 5))[0]
        return {
            "hedge_strike": best["strike"],
            "ltp": best["ltp"]
        }

    except Exception as e:
        return {"error": str(e)}
from fastapi.responses import JSONResponse

@app.get("/hedge-suggestion")
def hedge_suggestion(
    strike: int = Query(...),
    type: str = Query(...),   # "CALL" or "PUT"
):
    expiry = "2025-07-10"

    try:
        response = dhan.option_chain(
            under_security_id=13,
            under_exchange_segment="IDX_I",
            expiry=expiry
        )

        oc = response.get("data", {}).get("data", {}).get("oc", {})
        candidates = []

        for strike_str, data in oc.items():
            s = float(strike_str)

            if type == "CALL":
                option = data.get("ce", {})
            elif type == "PUT":
                option = data.get("pe", {})
            else:
                continue

            ltp = float(option.get("last_price", 0))
            if 8 <= ltp <= 10:

                candidates.append({"strike": s, "ltp": ltp})

        if not candidates:
            return {"found": False, "reason": f"No suitable {type} hedge"}

        best = sorted(candidates, key=lambda x: abs(x["ltp"] - 9))[0]

        return {
            "found": True,
            "strike": best["strike"],
            "ltp": best["ltp"],
            "fallback": abs(best["ltp"] - 9) > 1

        }

    except Exception as e:
        print(f"⚠️ Hedge backend error ({type}):", e)
        return {"found": False, "reason": str(e)}
@app.get("/positions")
async def get_positions():
    url = "https://api.dhan.co/v2/positions"
    headers = {
        "Content-Type": "application/json",
        "access-token": ACCESS_TOKEN
    }
    response = requests.get(url, headers=headers)
    return response.json()

@app.get("/option-chain-summary")
def option_chain_summary():
    expiry = "2025-07-10"  # or make dynamic
    try:
        response = dhan.option_chain(
            under_security_id=13,
            under_exchange_segment="IDX_I",
            expiry=expiry
        )

        oc = response.get("data", {}).get("data", {}).get("oc", {})
        summary = []

        for strike_str, strike_data in oc.items():
            strike = float(strike_str)
            for type_key in ["ce", "pe"]:
                option = strike_data.get(type_key)
                if not option:
                    continue

                symbol = f"NIFTY 24 JUL {int(float(strike_str))} {'CALL' if type_key == 'ce' else 'PUT'}"


                summary.append({
                    "symbol": symbol,
                    "strike": strike,
                    "type": "CALL" if type_key == "ce" else "PUT",
                    "ltp": float(option.get("last_price", 0)),
                    "prev_ltp": float(option.get("prev_close_price", 0)),
                    "volume": float(option.get("volume", 0)),
                    "oi": float(option.get("oi", 0)),
                    "prev_oi": float(option.get("previous_oi", 0)),
                    "iv": float(option.get("implied_volatility", 0)),
                    "prevIV": float(option.get("prev_implied_volatility", 0)),

                    "delta": float(option.get("greeks", {}).get("delta", 0)),
                    "gamma": float(option.get("greeks", {}).get("gamma", 0)),
                    "vega": float(option.get("greeks", {}).get("vega", 0))
                })

        return summary

    except Exception as e:
        print("❌ Error in /option-chain-summary:", e)
        return {"error": str(e)}, 500

@app.post("/send-telegram")
async def send_telegram_alert(request: Request):
    try:
        data = await request.json()
        message = data.get("message", "📢 Alert: No content")

        TELEGRAM_BOT_TOKEN = "7916444984:AAGDZB8FAReEbz8XA55oyikhR_PSiDYdOOE"
        TELEGRAM_CHAT_ID = "1809840455"

        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message
        }

        res = requests.post(url, json=payload)
        print("📩 Telegram sent:", message)
        return {"status": "sent", "response": res.json()}
    except Exception as e:
        print("❌ Failed to send Telegram:", e)
        return {"error": str(e)}, 500

@app.post("/send-email")
async def send_email(request: Request):
    data = await request.json()

    open_positions = data.get("openPositions", [])
    closed_positions = data.get("closedPositions", [])
    total_open_pnl = data.get("totalOpenPnl", "0.00")
    total_closed_pnl = data.get("totalClosedPnl", "0.00")
    date_str = datetime.now().strftime("%B %d, %Y – %I:%M %p")

    open_rows = ""
    for pos in open_positions:
        pnl_class = "profit" if "-" not in pos['pnl'] else "loss"
        open_rows += f"<tr><td>{pos['symbol']}</td><td>{pos['qty']}</td><td>{pos['buyAvg']}</td><td>{pos['sellAvg']}</td><td class='{pnl_class}'>{pos['pnl']}</td></tr>"

    closed_rows = ""
    for pos in closed_positions:
        pnl_class = "profit" if "-" not in pos['pnl'] else "loss"
        closed_rows += f"<tr><td>{pos['symbol']}</td><td>{pos['qty']}</td><td>{pos['buyAvg']}</td><td>{pos['sellAvg']}</td><td class='{pnl_class}'>{pos['pnl']}</td><td>{pos['returnPercent']}</td></tr>"

    open_color = "profit" if "-" not in total_open_pnl else "loss"

    html = f"""
    <html>
    <head>
      <style>
        body {{
          font-family: 'Segoe UI', sans-serif;
          background-color: #ffffff;
          color: #222;
          padding: 20px;
        }}
        h1 {{
          text-align: center;
          color: #0077cc;
        }}
        h2 {{
          margin-top: 40px;
          color: #444;
          border-bottom: 2px solid #eee;
          padding-bottom: 5px;
        }}
        p {{
          text-align: center;
          color: #888;
          font-size: 14px;
        }}
        table {{
          width: 100%;
          border-collapse: collapse;
          margin-top: 10px;
          margin-bottom: 30px;
        }}
        th {{
          background-color: #f4f4f4;
          color: #333;
          padding: 8px;
          text-align: center;
          border-bottom: 2px solid #ccc;
        }}
        td {{
          padding: 8px;
          text-align: center;
          border-bottom: 1px solid #eee;
        }}
        tr:nth-child(even) {{ background-color: #fafafa; }}

        .profit {{ color: green; font-weight: bold; }}
        .loss {{ color: red; font-weight: bold; }}

        .summary {{
          font-size: 16px;
          font-weight: bold;
          text-align: right;
          color: #444;
        }}

        .footer {{
          text-align: center;
          color: #888;
          font-size: 12px;
          margin-top: 40px;
        }}
      </style>
    </head>
    <body>

      <h1>📈 Daily Trading P&L Report</h1>
      <p>Generated by: <strong>Rugved Trading Technologies Pvt. Ltd. (Broker: Dhan)</strong></p>

      <h2>🔓 Open Positions</h2>
      <table>
        <tr><th>Symbol</th><th>Qty</th><th>Buy Avg</th><th>Sell Avg</th><th>P&L</th></tr>
        {open_rows}
        <tr><td colspan="4" class="summary">Total Open P&L</td><td class="{open_color}">{total_open_pnl}</td></tr>
      </table>

      <h2>✔️ Closed Positions</h2>
      <table>
        <tr><th>Symbol</th><th>Qty</th><th>Buy Avg</th><th>Sell Avg</th><th>P&L</th><th>% Return</th></tr>
        {closed_rows}
        <tr><td colspan="4" class="summary">Total Closed P&L</td><td class="profit">{total_closed_pnl}</td><td></td></tr>
      </table>

      <div class="footer">
        📢 Generated by: <strong>Rugved Trading Technologies Pvt. Ltd. (Broker: Dhan)</strong><br>
        📧 Contact: <a href="mailto:support@rugvedterminal.com">support@rugvedterminal.com</a><br>
        🕒 Report time: {date_str}

        <p style="font-size: 11px; color: #999; margin-top: 20px;">
          ⚠️ This report is system generated. No human verification is performed.<br>
          Always verify positions before acting on this data.
        </p>
      </div>

    </body>
    </html>
    """

    try:
        send_email_html("📋 Daily P&L Report", html)
        return JSONResponse({"message": "✅ Email sent successfully!"})
    except Exception as e:
        return JSONResponse({"message": f"❌ Failed to send email: {str(e)}"}, status_code=500)
    


# Temporary in-memory store (use DB/Redis in production)
# Temporary in-memory OTP store
otp_store = {}

@app.post("/login-request")
async def login_request(data: dict = Body(...)):
    username = data.get("username")
    password = data.get("password")

    # Example hardcoded user authentication
    if username != "admin" or password != "12345":
        return JSONResponse(status_code=401, content={"detail": "Invalid credentials"})

    otp = random.randint(100000, 999999)
    otp_store[username] = otp

    send_email_html(
        "Your Rugved OTP Code",
        f"""
        <html>
        <head>
            <style>
                body {{
                    background-color: #0d1117;
                    color: #f0f6fc;
                    font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif;
                    padding: 0;
                    margin: 0;
                }}
                .container {{
                    max-width: 600px;
                    margin: 40px auto;
                    background-color: #161b22;
                    border-radius: 12px;
                    box-shadow: 0 0 12px rgba(0, 255, 255, 0.05);
                    overflow: hidden;
                }}
                .header {{
                    background-color: #0d1117;
                    padding: 30px 40px 10px;
                    border-left: 5px solid #58a6ff;
                }}
                .header h1 {{
                    margin: 0;
                    color: #58a6ff;
                    font-size: 24px;
                    font-weight: 700;
                }}
                .tagline {{
                    font-size: 13px;
                    color: #8b949e;
                    margin-top: 4px;
                }}
                .content {{
                    padding: 20px 40px;
                    font-size: 16px;
                    line-height: 1.6;
                    color: #c9d1d9;
                }}
                .otp {{
                    font-size: 36px;
                    font-weight: bold;
                    color: #00ffaa;
                    text-align: center;
                    margin: 20px 0;
                    letter-spacing: 2px;
                }}
                .footer {{
                    padding: 20px 40px;
                    font-size: 13px;
                    text-align: center;
                    color: #6e7681;
                    border-top: 1px solid #30363d;
                }}
                a {{
                    color: #58a6ff;
                    text-decoration: none;
                }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Rugved Trading Technologies</h1>
                    <div class="tagline">Built for Traders. Powered by Intelligence.</div>
                </div>
                <div class="content">
                    Hello,<br><br>
                    Use the following OTP to securely log in to your account:
                    <div class="otp">🔒 {otp}</div>
                    ⏳ This OTP will expire in <strong>5 minutes</strong>.<br><br>
                    ⚠️ <strong>Never share this OTP</strong> with anyone. We will never ask for it via phone, email, or chat.
                </div>
                <div class="footer">
                    Need help? Contact us at <a href="mailto:support@rugvedtrading.com">support@rugvedtrading.com</a><br>
                    © 2025 Rugved Trading Technologies Pvt. Ltd. All rights reserved.
                </div>
            </div>
        </body>
        </html>
        """
    )


@app.post("/verify-otp")
async def verify_otp(data: dict = Body(...)):
    username = data.get("username")
    otp = int(data.get("otp", 0))

    if otp_store.get(username) == otp:
        del otp_store[username]
        return {"access_token": "fake-jwt-token", "message": "Login successful"}
    return JSONResponse(status_code=400, content={"detail": "Invalid OTP"})


# Optional CORS (if frontend served separately)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/funds")
async def get_funds():
    headers = {
        "access-token": "",  # 🔒 Replace with real token securely
        "Content-Type": "application/json"
    }
    url = "https://api.dhan.co/v2/fundlimit"
    response = requests.get(url, headers=headers)
    return response.json()


@app.get("/trades")
async def get_trades(from_date: str, to_date: str, page: int = 0):
    headers = {
        "access-token": "",
        "Content-Type": "application/json"
    }
    url = f"https://api.dhan.co/v2/trades/{from_date}/{to_date}/{page}"
    response = requests.get(url, headers=headers)

    try:
        trades = response.json()
        if isinstance(trades, list):
            return trades
        else:
            return JSONResponse(status_code=500, content={"error": "Expected trade list, got object"})
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

