# backend/feed.py
import asyncio
import datetime
import json
import time  # at the top if not already

from dhanhq import marketfeed

CLIENT_ID = ""
ACCESS_TOKEN = ""  # keep this secure
VERSION = "v2"

class FeedManager:
    def __init__(self):
        self.current_instruments = [(marketfeed.IDX, "13", marketfeed.Quote)]  # Default: NIFTY
        self.feed = None
        self.connected = False
        self.tick_task = None  # 🆕 track tick loop task
        self.last_subscribe_time = 0  # ✅ debounce lock

    async def connect(self):
        if self.connected:
            print("⚠️ Already connected to Dhan feed")
            return
        self.feed = marketfeed.DhanFeed(CLIENT_ID, ACCESS_TOKEN, self.current_instruments, VERSION)
        await self.feed.connect()
        self.connected = True
        print("🟢 Connected to Dhan live feed")

    async def reconnect(self, instruments):
        print("🔁 Reconnecting with instruments:", instruments)
        try:
            if self.feed:
                await self.feed.disconnect()
        except Exception as e:
            print("⚠️ Error disconnecting feed:", e)

        try:
            self.feed = marketfeed.DhanFeed(CLIENT_ID, ACCESS_TOKEN, instruments, VERSION)
            await self.feed.connect()
            self.current_instruments = instruments
            # print("🆕 Subscribed to new option instruments")
        except Exception as e:
            print("❌ Reconnect failed:", e)

    async def subscribe_options(self, call_id, put_id):
        try:
            # ✅ Debounce: Skip if too soon
            now = time.time()
            if now - self.last_subscribe_time < 2:
                print("⏳ Skipping reconnect: Called too quickly")
                return
            self.last_subscribe_time = now

            if not call_id or not put_id:
                print(f"⚠️ Skipping subscribe_options due to missing IDs → CALL: {call_id}, PUT: {put_id}")
                return

            new_instruments = [
                (marketfeed.IDX, "13", marketfeed.Quote),
                (marketfeed.NSE_FNO, str(call_id), marketfeed.Quote),
                (marketfeed.NSE_FNO, str(put_id), marketfeed.Quote),
            ]

            print("🔁 [subscribe_options] Reconnecting to feed with instruments:", new_instruments)

            # ✅ Disconnect current feed safely
            if self.feed:
                try:
                    await self.feed.disconnect()
                    print("✅ Previous feed disconnected")
                except Exception as e:
                    print("⚠️ Error disconnecting old feed:", e)

            await asyncio.sleep(2.0)  # ✅ Delay before reconnecting

            self.feed = marketfeed.DhanFeed(CLIENT_ID, ACCESS_TOKEN, new_instruments, VERSION)
            await self.feed.connect()
            self.current_instruments = new_instruments
            self.connected = True
            print("🟢 Reconnected successfully with new CALL/PUT instruments")

        except Exception as e:
            print("❌ Reconnect failed in subscribe_options:", e)


    async def stream_data(self, websocket):
        async def tick_loop():
            while True:
                data = await self.feed.get_instrument_data()
                if data.get("type") == "Quote Data":
                    security_id = str(data.get("security_id", ""))
                    tick = {
                        "time": datetime.datetime.now().strftime("%H:%M:%S"),
                        "ltp": float(data.get("LTP", 0)),
                        "open": float(data.get("open", 0)),
                        "high": float(data.get("high", 0)),
                        "low": float(data.get("low", 0)),
                        "close": float(data.get("close", 0)),
                        "volume": float(data.get("volume", 0)),

                    }

                    if security_id == "13":
                        tick["type"] = "tick"
                        # print(f"📈 NIFTY Tick → LTP: {tick['ltp']} | O: {tick['open']} H: {tick['high']} L: {tick['low']} C: {tick['close']}")
                    elif len(self.current_instruments) > 1 and security_id == self.current_instruments[1][1]:
                        tick["type"] = "call_tick"
                        # print(f"📞 CALL Tick  → LTP: {tick['']}")
                    elif len(self.current_instruments) > 2 and security_id == self.current_instruments[2][1]:
                        tick["type"] = "put_tick"
                        # print(f"📉 PUT Tick   → LTP: {tick['ltp']} | O: {tick['open']} H: {tick['high']} L: {tick['low']} C: {tick['close']}")
                    else:
                        tick["type"] = "unknown"

                    await websocket.send_json(tick)

        # Start initial tick loop
        self.tick_task = asyncio.create_task(tick_loop())

        try:
            while True:
                msg = await websocket.receive_text()
                try:
                    data = json.loads(msg)
                    if data.get("type") == "subscribe_options":
                        call_id = data.get("callId")
                        put_id = data.get("putId")
                        # print(f"📩 Received subscription: CALL={call_id}, PUT={put_id}")

                        # Cancel old tick loop
                        if self.tick_task:
                            self.tick_task.cancel()
                            try:
                                await self.tick_task
                            except asyncio.CancelledError:
                                pass

                        # Reconnect with new instruments and start new loop
                        await self.subscribe_options(call_id, put_id)
                        self.tick_task = asyncio.create_task(tick_loop())

                except Exception as e:
                    print("⚠️ Error parsing message:", e)

        except asyncio.CancelledError:
            print("🛑 Feed cancelled.")
            if self.tick_task:
                self.tick_task.cancel()
                try:
                    await self.tick_task
                except asyncio.CancelledError:
                    pass
        except Exception as e:
            print("❌ Feed error:", e)

class MiniFeedManager:
    def __init__(self):
        self.feed = None
        self.instruments = []
        self.connected = False
        self.tick_task = None

    async def connect(self):
        if self.connected:
            return
        self.feed = marketfeed.DhanFeed(CLIENT_ID, ACCESS_TOKEN, self.instruments, VERSION)
        await self.feed.connect()
        self.connected = True

    async def disconnect(self):
        try:
            if self.feed:
                await self.feed.disconnect()
        except:
            pass

    async def stream_data(self, websocket):
        try:
            while True:
                msg = await websocket.receive_text()
                data = json.loads(msg)

                if data.get("type") == "subscribe_many":
                    ids = [str(i) for i in data.get("ids", [])]
                    self.instruments = [(marketfeed.NSE_FNO, i, marketfeed.Quote) for i in ids]
                    print(f"📨 MINI subscription received → {ids}")

                    await self.disconnect()
                    await asyncio.sleep(0.5)

                    self.feed = marketfeed.DhanFeed(CLIENT_ID, ACCESS_TOKEN, self.instruments, VERSION)
                    await self.feed.connect()

                    # Cancel old loop if it exists
                    if self.tick_task:
                        self.tick_task.cancel()
                        try:
                            await self.tick_task
                        except asyncio.CancelledError:
                            pass

                    # ✅ Start tick loop only now
                    async def tick_loop():
                        while True:
                            data = await self.feed.get_instrument_data()
                            if data.get("type") == "Quote Data":
                                tick = {
                                    "type": "mini_tick",
                                    "security_id": str(data.get("security_id")),
                                    "ltp": float(data.get("LTP", 0)),
                                    "open": float(data.get("open", 0)),
                                    "high": float(data.get("high", 0)),
                                    "low": float(data.get("low", 0)),
                                    "close": float(data.get("close", 0)),
                                }
                                # print(f"📥 Mini Tick: {tick}")
                                await websocket.send_json(tick)

                    self.tick_task = asyncio.create_task(tick_loop())

        except Exception as e:
            print("❌ MiniFeed error:", e)   



# backend/feed.py

class TabsFeedManager:
    def __init__(self):
        self.feed = None
        self.instruments = []
        self.tick_task = None
        self.connected = False

    async def connect(self):
        if self.connected:
            return
        self.feed = marketfeed.DhanFeed(CLIENT_ID, ACCESS_TOKEN, self.instruments, VERSION)
        await self.feed.connect()
        self.connected = True

    async def disconnect(self):
        if self.feed:
            await self.feed.disconnect()
            self.connected = False

    async def stream_data(self, websocket):
        try:
            while True:
                msg = await websocket.receive_text()
                data = json.loads(msg)

                if data.get("type") == "subscribe_tabs":
                    ids = [str(i) for i in data.get("ids", [])]
                    print(f"📨 TABS subscription received → {ids}")

                    self.instruments = [(marketfeed.NSE_FNO, i, marketfeed.Quote) for i in ids]

                    await self.disconnect()
                    await asyncio.sleep(0.5)

                    self.feed = marketfeed.DhanFeed(CLIENT_ID, ACCESS_TOKEN, self.instruments, VERSION)
                    await self.feed.connect()

                    if self.tick_task:
                        self.tick_task.cancel()
                        try:
                            await self.tick_task
                        except asyncio.CancelledError:
                            pass

                    # ✅ Fast tick loop — sends data as soon as received
                    async def tick_loop():
                        while True:
                            data = await self.feed.get_instrument_data()
                            if data.get("type") == "Quote Data":
                                tick = {
                                    "type": "tab_tick",
                                    "security_id": str(data.get("security_id")),
                                    "ltp": float(data.get("LTP", 0)),
                                    "open": float(data.get("open", 0)),
                                    "high": float(data.get("high", 0)),
                                    "low": float(data.get("low", 0)),
                                    "close": float(data.get("close", 0)),
                                }
                                await websocket.send_json(tick)  # 🔥 Send immediately

                    self.tick_task = asyncio.create_task(tick_loop())

        except Exception as e:
            print("❌ TabsFeed error:", e)


