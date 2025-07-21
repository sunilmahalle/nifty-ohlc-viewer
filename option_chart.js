/*********************************************************************
 *  Option mini‑chart popup with safe chart loading + WebSocket
 *********************************************************************/

const urlParams = new URLSearchParams(window.location.search);
const atm = parseInt(urlParams.get("strike"), 10);
const type = urlParams.get("type");
const chartsByStrike = {};
let loadedCount = 0;
const totalCharts = 12;
const subscribedIds = [];
const liveOptionMap = {};
const avgMap = {};  // ✅ strike → avg mapping

const first5Map = {};          // symbol → first 5 candles
const projectionDrawn = {};    // symbol → true/false

const miniHighLines = {};
const miniLowLines = {};
const lastMiniHigh = {};
const lastMiniLow = {};
const charts = {};


window.addEventListener("DOMContentLoaded", () => {
  console.log("✅ option_chart.js loaded");

  const grid = document.getElementById("chartGrid");
  const rawStrikes = [];
  for (let i = -400; i <= 450; i += 50) rawStrikes.push(atm + i); // ✅ now includes +450 → 25550


  const centerIndex = rawStrikes.indexOf(atm);
  const visibleStrikes = rawStrikes.slice(centerIndex - 6, centerIndex + 6); // 12 strikes shown

  // ✅ Ensure all strikes (even those not visible) are initialized
  rawStrikes.forEach(s => chartsByStrike[s] = null);


  console.log("✅ Visible strikes:", visibleStrikes);



  
  function groupCandlesByDay(candles) {
    const grouped = {};
    for (const c of candles) {
      const day = new Date(c.time * 1000).toISOString().slice(0, 10); // "YYYY-MM-DD"
      if (!grouped[day]) grouped[day] = [];
      grouped[day].push(c);
    }
    return Object.values(grouped).sort((a, b) => a[0].time - b[0].time);
  }

  function drawPrevDayHighLowLines(series, candles) {
    const days = groupCandlesByDay(candles);
    if (days.length < 2) return;  // Need at least two trading days
    const prevDay = days.at(-2);  // Second-last = yesterday

    const high = Math.max(...prevDay.map(c => c.high));
    const low = Math.min(...prevDay.map(c => c.low));

    series.createPriceLine({
      price: high,
      color: '#999',
      lineWidth: 2,
      lineStyle: 2,
      // title: 'PDH'
    });

    series.createPriceLine({
      price: low,
      color: '#999',
      lineWidth: 2,
      lineStyle: 2,
      // title: 'PDL'
    });
  }

  function makeLabel() {
    const el = document.createElement("div");
    el.className = "mini-label";
    el.style.cssText = `
      position: absolute; top: 6px; left: 6px;
      padding: 2px 6px; font: 11px monospace;
      background: rgba(0,0,0,.5); color: #fff;
      border-radius: 4px; pointer-events: none; z-index: 20;
    `;
    el.textContent = "Loading…";
    return el;
  }

  function updateLabelFromTick(label, msg, strike, type) {
    if (!label || !msg) return;

    const o = msg.open?.toFixed(2) ?? "--";
    const h = msg.high?.toFixed(2) ?? "--";
    const l = msg.low?.toFixed(2) ?? "--";
    const c = msg.close?.toFixed(2) ?? "--";
    const ltp = msg.ltp ?? msg.close;

    const avg = avgMap[strike];
    let hMinusAvgHTML = "";

    if (avg !== undefined && Number.isFinite(ltp)) {
      const hMinusAvg = (ltp - avg).toFixed(2);
      const hAvgColor = hMinusAvg >= 0 ? "lime" : "red";
      hMinusAvgHTML = `<span style="color:${hAvgColor};">LTP–AVG: ₹${hMinusAvg}</span>`;
    }

    label.innerHTML = `
      O:${o} H:${h} L:${l} C:${c} &nbsp;&nbsp;
      ${hMinusAvgHTML} &nbsp;&nbsp;
      ${strike} ${type}
    `.trim();

    label.style.color = msg.close > msg.open ? "#4caf50" : msg.close < msg.open ? "#f44336" : "#ccc";
  }


  async function loadChartsWithDelay() {
    for (let i = 0; i < visibleStrikes.length; i++) {
      const strike = visibleStrikes[i];
      const symbol = `NIFTY 17 JUL ${strike} ${type}`;

      const box = document.createElement("div");
      box.className = "chart-box";

      const canvas = document.createElement("div");
      canvas.className = "canvas";
      box.appendChild(canvas);

      const label = makeLabel();
      box.appendChild(label);

      const btnGroup = document.createElement("div");
      btnGroup.style.cssText = `
        position: absolute; top: 6px; right: 6px;
        display: flex; gap: 4px; z-index: 30;
      `;

      grid.appendChild(box);

      const chart = LightweightCharts.createChart(canvas, {
        layout: { background: { color: "#222" }, textColor: "#DDD" },
        grid: { vertLines: { visible: false }, horzLines: { visible: false } },
        timeScale: { timeVisible: true },
        priceScale: { borderColor: "#444" },
      });

      const series = chart.addCandlestickSeries();
      canvas._chart = chart;
      box._chart = chart;

      try {
        const idRes = await fetch(`/get-security-id?symbol=${encodeURIComponent(symbol)}`);
        const idJson = await idRes.json();
        const secId = idJson.security_id;
        if (!secId) throw new Error("No ID for " + symbol);
        subscribedIds.push(secId);
        console.log(`🎯 ${symbol} → SEC ID: ${secId}`);

        // Create buttons now
        ["Buy", "Sell"].forEach(action => {
          const btn = document.createElement("button");
          btn.textContent = action;
          btn.style.cssText = `
            background: ${action === "Buy" ? "#1a8f1a" : "#c62828"};
            border: none; color: white; padding: 2px 6px;
            font: 11px monospace; border-radius: 3px; cursor: pointer;
          `;

          btn.onclick = async () => {
            try {
              const res = await fetch("/place-dhan-order", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  security_id: secId,
                  side: action.toUpperCase()
                })
              });
              const data = await res.json();
              if (data.orderId) {
                alert(`✅ ${action.toUpperCase()} Order Placed for ${symbol}\nOrder ID: ${data.orderId}`);
              } else {
                alert(`❌ Order Failed: ${data.error || "Unknown error"}`);
              }
            } catch (err) {
              console.error("❌ Order error:", err);
              alert("❌ Failed to place order.");
            }
          };

          btnGroup.appendChild(btn);
        });

        box.appendChild(btnGroup);

        const histRes = await fetch(`/option_history_live?symbol=${encodeURIComponent(symbol)}`);
        const data = await histRes.json();

        const candles = data.map(c => ({
          time: Number(c.time),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close
        }));

        series.setData(candles);

        liveOptionMap[secId] = {
          series,
          dataArray: candles,
          label,
          strike,
          type,
          security_id: secId
        };

        charts[secId] = { chart, series, label, dataArray: candles, strike, type };
        chartsByStrike[strike] = { chart, series, type, candles };

        drawPrevDayHighLowLines(series, candles);
        chart.timeScale().fitContent();
        chart.timeScale().scrollToPosition(0, false);

        loadedCount++;
        console.log(`✅ Chart loaded: ${strike} (${loadedCount}/${totalCharts})`);
      } catch (err) {
        label.textContent = "❌ Load error";
        console.error(symbol, err);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // ✅ ✅ ✅ Move this OUTSIDE the loop — all charts ready now
    console.log("🚀 All charts loaded. Calculating AVG lines...");
    for (const s of visibleStrikes) {
      try {
        await computeRollingAvgFrom5Min(s);
      } catch (err) {
        console.warn("⚠️ 5-min AVG line failed for", s, err);
      }
    }

    connectMiniWebSocket();
    window.sharedChartsByStrike = chartsByStrike;
    window.optionChartsReady = true;
  }


  function drawMiniHighLow(secId, high, low) {
    if (!liveOptionMap[secId]) return;
    const { chart, series } = charts[secId] || {};


    if (!chart) return;

    if (high !== lastMiniHigh[secId]) {
      miniHighLines[secId]?.remove?.();
      miniHighLines[secId] = series.createPriceLine({
        price: high,
        color: 'red',
        lineStyle: 0,
        lineWidth: 1.5,
        title: 'High'
      });
      lastMiniHigh[secId] = high;
    }

    if (low !== lastMiniLow[secId]) {
      miniLowLines[secId]?.remove?.();
      miniLowLines[secId] = series.createPriceLine({
        price: low,
        color: 'blue',
        lineStyle: 0,
        lineWidth: 1.5,
        title: 'Low'
      });
      lastMiniLow[secId] = low;
    }
  }

  function connectMiniWebSocket() {
    console.log("📦 Connecting WebSocket and subscribing...");
    const socket = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws-mini");

    socket.onopen = () => {
      console.log("🟢 WebSocket connected (mini)");
      socket.send(JSON.stringify({ type: "subscribe_many", ids: subscribedIds }));
      console.log("📡 Sent subscription to backend:", subscribedIds);
    };

    socket.onmessage = event => {
      const msg = JSON.parse(event.data);
      if (msg.type === "mini_tick" && msg.security_id && liveOptionMap[msg.security_id]) {
        const { label, strike, type } = liveOptionMap[msg.security_id];
        updateLabelFromTick(label, msg, strike, type);
        drawMiniHighLow(msg.security_id, msg.high, msg.low);  // ✅ NEW

        updateLiveMiniCandle(msg.security_id, msg.ltp);
      }
    };
  }

  function updateLiveMiniCandle(secId, ltp) {
    const entry = liveOptionMap[secId];
    if (!entry) return;
    const now = Math.floor(Date.now() / 1000);
    const minute = Math.floor(now / 60) * 60;
    let last = entry.dataArray.at(-1);
    if (!last || last.time !== minute) {
      last = { time: minute, open: ltp, high: ltp, low: ltp, close: ltp };
      entry.dataArray.push(last);
    } else {
      last.high = Math.max(last.high, ltp);
      last.low = Math.min(last.low, ltp);
      last.close = ltp;
    }
    entry.series.update(last);
  }

  async function computeRollingAvgFrom5Min(strike) {
    const center = chartsByStrike[strike];
    const near1 = chartsByStrike[strike - 50];
    const near2 = chartsByStrike[strike + 50];

    if (!center || !near1 || !near2) return null;

    const buildSymbol = (s) => `NIFTY 17 JUL ${s} ${type}`.replace(/\s+/g, ' ').trim();
    const sym1 = buildSymbol(strike - 50);
    const sym2 = buildSymbol(strike + 50);
    const symC = buildSymbol(strike);

    try {
      console.log(`🔍 Looking for symbol: '${sym1}', '${sym2}', '${symC}'`);

      const [res1, res2, resC] = await Promise.all([
        fetch(`/option_5min_agg?symbol=${encodeURIComponent(sym1)}`).then(r => r.json()),
        fetch(`/option_5min_agg?symbol=${encodeURIComponent(sym2)}`).then(r => r.json()),
        fetch(`/option_5min_agg?symbol=${encodeURIComponent(symC)}`).then(r => r.json())
      ]);

      const c1 = res1?.[0];
      const c2 = res2?.[0];
      const cC = resC?.[0];

      if (
        !c1 || !c2 || !cC ||
        !Number.isFinite(c1.high) ||
        !Number.isFinite(c2.low) ||
        !Number.isFinite(cC.close)
      ) {
        console.warn(`⛔️ Invalid OHLC for ${strike}`, { c1, c2, cC });
        return null;
      }

      let high, low;

      if (type === "CALL") {
        high = c1.high;
        low = c2.low;
      } else if (type === "PUT") {
        high = c2.high;
        low = c1.low;
      }

      const close = cC.close;
      const avg = (high + low + close) / 3;
      avgMap[strike] = +avg.toFixed(2);  // ✅ Save avg for this strike


      // Log data
      console.log(`📦 ${strike - 50} HIGH: ${high}`);
      console.log(`📦 ${strike + 50} LOW: ${low}`);
      console.log(`📦 ${strike} CLOSE: ${close}`);
      console.log(`📏 AVG: ${avg.toFixed(2)}`);

      // Draw lines
      center.series.createPriceLine({ price: high, color: 'orange', lineWidth: 2 });
      center.series.createPriceLine({ price: low, color: 'orange', lineWidth: 2 });
      center.series.createPriceLine({
        price: +avg.toFixed(2),
        color: 'orange',
        title: `AVG`,
        lineStyle: 0,
        lineWidth: 2
      });

      return { strike, high, low, close, avg: +avg.toFixed(2) };

    } catch (err) {
      console.error(`❌ 5-min AVG line failed for ${strike}`, err);
      return null;
    }
  }










  loadChartsWithDelay();


    // Fullscreen logic
  let expandedBox = null;

  document.querySelectorAll(".chart-box").forEach(box => {
    box.addEventListener("dblclick", () => {
      if (expandedBox) {
        // Restore all boxes
        document.querySelectorAll(".chart-box").forEach(b => {
          b.style.position = "";
          b.style.top = "";
          b.style.left = "";
          b.style.width = "";
          b.style.height = "";
          b.style.zIndex = "";
          b.style.display = "block";
        });
        expandedBox._chart.resize(
          expandedBox.querySelector(".canvas").clientWidth,
          expandedBox.querySelector(".canvas").clientHeight
        );
        expandedBox = null;
      } else {
        // Expand current
        expandedBox = box;
        document.querySelectorAll(".chart-box").forEach(b => {
          if (b !== box) b.style.display = "none";
        });
        box.style.position = "fixed";
        box.style.top = "0";
        box.style.left = "0";
        box.style.width = "100vw";
        box.style.height = "100vh";
        box.style.zIndex = "100";
        box._chart.resize(window.innerWidth, window.innerHeight);
      }
    });
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && expandedBox) {
      expandedBox.dispatchEvent(new Event("dblclick"));
    }
  });

  window.addEventListener("resize", () => {
    document.querySelectorAll(".canvas").forEach(div => {
      div._chart?.resize(div.clientWidth, div.clientHeight);
    });
  });
});
