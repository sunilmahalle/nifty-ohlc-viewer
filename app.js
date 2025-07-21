




let socket = new WebSocket("ws://" + window.location.host + "/ws");



const priceLabel = document.getElementById("priceLabel");
const callLabel = document.getElementById("callLabel");
const putLabel = document.getElementById("putLabel");

const tfButtons = document.querySelectorAll('#timeframeButtons button');

const chart = LightweightCharts.createChart(document.getElementById("niftyChart"), {
  layout: { background: { color: "#111" }, textColor: "#DDD" },
  grid: { vertLines: { visible: false }, horzLines: { visible: false } },
  timeScale: {
    timeVisible: true,
    secondsVisible: false,
    timeFormatter: (time) => {
      const date = new Date((time + 19800) * 1000);
      return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    }
  },
  priceScale: { borderColor: "#555" }
});
const candleSeries = chart.addCandlestickSeries();
// Add this
const countdownLabel = document.createElement("div");
countdownLabel.style.position = "absolute";
countdownLabel.style.padding = "2px 6px";
countdownLabel.style.fontSize = "12px";
countdownLabel.style.background = "rgba(0,0,0,0.6)";
countdownLabel.style.color = "#fff";
countdownLabel.style.borderRadius = "4px";
countdownLabel.style.pointerEvents = "none";
countdownLabel.style.zIndex = "10";
countdownLabel.style.transition = "top 0.2s ease";
countdownLabel.innerText = "Next: --:--";

const chartBox = document.getElementById("niftyChart").closest(".chart-box");
chartBox.style.position = "relative"; // Ensure parent is relative
chartBox.appendChild(countdownLabel);

const callChart = LightweightCharts.createChart(document.getElementById("callChart"), {
  layout: { background: { color: "#222" }, textColor: "#DDD" },
  grid: { vertLines: { visible: false }, horzLines: { visible: false } },
  timeScale: { timeVisible: true },
  priceScale: { borderColor: "#444" }
});
const callSeries = callChart.addCandlestickSeries();

const putChart = LightweightCharts.createChart(document.getElementById("putChart"), {
  layout: { background: { color: "#222" }, textColor: "#DDD" },
  grid: { vertLines: { visible: false }, horzLines: { visible: false } },
  timeScale: { timeVisible: true },
  priceScale: { borderColor: "#444" }
});
const putSeries = putChart.addCandlestickSeries();

let raw1mCandles = [];
let currentTimeframe = 1;
let currentCandle = null;
let projectedLines = [];
let liveHighLine = null;
let liveLowLine = null;
let openUpperLine = null;
let openLowerLine = null;
let lastOpenPlotted = null; // ✅ Cache last plotted open
let bullBearLinesDrawn = false;  // ✅ This prevents re-creating the lines on every tick

let lastLiveHigh = null;
let lastLiveLow = null;
let callCandles = [];
let putCandles = [];
let callHighLine = null;
let callLowLine = null;
let putHighLine = null;
let putLowLine = null;
let lastCallHigh = null;
let lastCallLow = null;
let lastPutHigh = null;
let lastPutLow = null;
let lastATM = null;
let fetchedStrikesKey = null;
let callPrevHighLine = null;
let callPrevLowLine = null;
let putPrevHighLine = null;
let callPrevLines = [];
let putPrevLines = [];
let atmCallCandles = [];
let itmCallCandles = [];
let showingITMCall = false;
let oneDayCandles = [];

let call5mLines = {
  atm: { high: null, low: null, avg: null },
  itm: { high: null, low: null, avg: null }
};

let put5mLines = {
  atm: { high: null, low: null, avg: null },
  itm: { high: null, low: null, avg: null }
};

const fiveMinDataCache = {
  "call-atm": null,
  "call-itm": null,
  "put-atm": null,
  "put-itm": null
};


let atmPutCandles = [];
let itmPutCandles = [];
let showingITMPut = false;


let putPrevLowLine = null;




function drawProjectionLinesFromCSV(candles) {
  projectedLines.forEach(line => line?.remove?.());
  projectedLines = [];

  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const first5 = sorted.slice(0, 5);
  if (first5.length < 5) return;

  const maxHigh = Math.max(...first5.map(c => c.high));
  const minLow = Math.min(...first5.map(c => c.low));

  projectedLines.push(candleSeries.createPriceLine({ price: maxHigh * 1.002611, color: 'red', lineWidth: 1, title: 'H+26.11%' }));
  projectedLines.push(candleSeries.createPriceLine({ price: maxHigh * 1.001306, color: 'red', lineWidth: 1, lineStyle: 2, title: 'H+13.06%' }));
  projectedLines.push(candleSeries.createPriceLine({ price: minLow * (1 - 0.002611), color: 'green', lineWidth: 1, title: 'L-26.11%' }));
  projectedLines.push(candleSeries.createPriceLine({ price: minLow * (1 - 0.001306), color: 'green', lineWidth: 1, lineStyle: 2, title: 'L-13.06%' }));
}

function drawLiveHighLow(high, low) {
  if (high !== lastLiveHigh) {
    liveHighLine?.remove?.();
    liveHighLine = candleSeries.createPriceLine({ price: high, color: 'red', lineWidth: 1, lineStyle: 0, title: 'Live High' });
    lastLiveHigh = high;
  }

  if (low !== lastLiveLow) {
    liveLowLine?.remove?.();
    liveLowLine = candleSeries.createPriceLine({ price: low, color: 'blue', lineWidth: 1, lineStyle: 0, title: 'Live Low' });
    lastLiveLow = low;
  }
}

function drawCallHighLow(high, low) {
  if (high !== lastCallHigh) {
    callHighLine?.remove?.();
    callHighLine = callSeries.createPriceLine({
      price: high,
      color: 'red',
      lineWidth: 1,
      lineStyle: 0
    });
    lastCallHigh = high;
  }

  if (low !== lastCallLow) {
    callLowLine?.remove?.();
    callLowLine = callSeries.createPriceLine({
      price: low,
      color: 'blue',
      lineWidth: 1,
      lineStyle: 0
    });
    lastCallLow = low;
  }
}

function drawPutHighLow(high, low) {
  if (high !== lastPutHigh) {
    putHighLine?.remove?.();
    putHighLine = putSeries.createPriceLine({
      price: high,
      color: 'red',
      lineWidth: 1,
      lineStyle: 0
    });
    lastPutHigh = high;
  }

  if (low !== lastPutLow) {
    putLowLine?.remove?.();
    putLowLine = putSeries.createPriceLine({
      price: low,
      color: 'blue',
      lineWidth: 1,
      lineStyle: 0
    });
    lastPutLow = low;
  }
}
// ✅ Add this here
async function draw5mLines(strike, type, series, mode) {
  const key = `${type.toLowerCase()}-${mode}`;
  const allLines = type === "CALL" ? call5mLines : put5mLines;
  const linesToShow = allLines[mode];
  const linesToHide = allLines[mode === "atm" ? "itm" : "atm"];

  // 🧹 Hide opposite mode’s lines (fully remove and nullify)
  if (linesToHide.high?.remove) { linesToHide.high.remove(); linesToHide.high = null; }
  if (linesToHide.low?.remove)  { linesToHide.low.remove();  linesToHide.low  = null; }
  if (linesToHide.avg?.remove)  { linesToHide.avg.remove();  linesToHide.avg  = null; }

  // 🧹 Clear this mode’s existing lines too before redrawing
  if (linesToShow.high?.remove) { linesToShow.high.remove(); linesToShow.high = null; }
  if (linesToShow.low?.remove)  { linesToShow.low.remove();  linesToShow.low  = null; }
  if (linesToShow.avg?.remove)  { linesToShow.avg.remove();  linesToShow.avg  = null; }

  // ✅ Already cached → reuse
  if (fiveMinDataCache[key]) {
    const { high, low, avg } = fiveMinDataCache[key];
    linesToShow.high = series.createPriceLine({ price: high, color: '#ffaa00', title: '5m HIGH', lineWidth: 1 });
    linesToShow.low  = series.createPriceLine({ price: low,  color: '#00aaff', title: '5m LOW', lineWidth: 1 });
    linesToShow.avg  = series.createPriceLine({ price: avg,  color: '#ff00ff', title: '5m AVG', lineWidth: 1 });
    return;
  }

  // 🧪 Not cached → fetch
  const expiry = "24 JUL";
  const buildSymbol = (e, s, t) => `NIFTY ${e} ${s} ${t}`.replace(/\s+/g, ' ').trim();
  const centerSymbol = buildSymbol(expiry, strike, type);
  const near1Symbol = buildSymbol(expiry, strike - 50, type);
  const near2Symbol = buildSymbol(expiry, strike + 50, type);

  try {
    const [c1res, c2res, cCres] = await Promise.all([
      fetch(`/option_5min_agg?symbol=${encodeURIComponent(near1Symbol)}`).then(r => r.json()),
      fetch(`/option_5min_agg?symbol=${encodeURIComponent(near2Symbol)}`).then(r => r.json()),
      fetch(`/option_5min_agg?symbol=${encodeURIComponent(centerSymbol)}`).then(r => r.json())
    ]);

    const c1 = c1res?.[0], c2 = c2res?.[0], cC = cCres?.[0];
    if (!c1 || !c2 || !cC) return;

    const high  = type === "CALL" ? c1.high : c2.high;
    const low   = type === "CALL" ? c2.low  : c1.low;
    const close = cC.close;
    const avg   = +((high + low + close) / 3).toFixed(2);

    fiveMinDataCache[key] = { high, low, avg };

    linesToShow.high = series.createPriceLine({ price: high, color: '#ffaa00', title: '5m HIGH', lineWidth: 1 });
    linesToShow.low  = series.createPriceLine({ price: low,  color: '#00aaff', title: '5m LOW', lineWidth: 1 });
    linesToShow.avg  = series.createPriceLine({ price: avg,  color: '#ff00ff', title: '5m AVG', lineWidth: 1 });

  } catch (err) {
    console.error("❌ draw5mLines error:", err);
  }
}






function aggregateCandles(data, tf) {
  const grouped = {};
  data.forEach(c => {
    const bucket = Math.floor(c.time / (60 * tf)) * 60 * tf;
    if (!grouped[bucket]) {
      grouped[bucket] = { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close };
    } else {
      grouped[bucket].high = Math.max(grouped[bucket].high, c.high);
      grouped[bucket].low = Math.min(grouped[bucket].low, c.low);
      grouped[bucket].close = c.close;
    }
  });
  return Object.values(grouped).sort((a, b) => a.time - b.time);
}

function applyTimeframe(tf) {
  currentTimeframe = tf;
  const aggregated = aggregateCandles(raw1mCandles, tf);
  candleSeries.setData(aggregated);
  currentCandle = aggregated.at(-1) || null;

  tfButtons.forEach(btn => btn.classList.remove("active"));
  document.querySelector(`button[data-tf="${tf}m"]`)?.classList.add("active");
}

fetch("/historical")
  .then(res => res.json())
  .then(data => {
    raw1mCandles = data.map(d => ({
      time: Number(d.time),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close
    }));

    // ✅ group by day after raw1mCandles is ready
    oneDayCandles = groupCandlesByDay(raw1mCandles);

    applyTimeframe(currentTimeframe);  // render to chart
  });


fetch("/nifty-csv")
  .then(res => res.json())
  .then(data => {
    const parsed = data.map(d => ({
      time: Number(d.time),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close
    }));
    drawProjectionLinesFromCSV(parsed);
  });

function updateLiveCandle(ltp) {
  const now = Math.floor(Date.now() / 1000);
  const minute = Math.floor(now / 60) * 60;

  let last = raw1mCandles.at(-1);
  if (!last || last.time !== minute) {
    last = { time: minute, open: ltp, high: ltp, low: ltp, close: ltp };
    raw1mCandles.push(last);
  } else {
    last.high = Math.max(last.high, ltp);
    last.low = Math.min(last.low, ltp);
    last.close = ltp;
  }

  const updated = aggregateCandles(raw1mCandles.slice(-100), currentTimeframe).at(-1);
  if (updated) {
    currentCandle = updated;
    candleSeries.update(currentCandle);
  }
}
function drawPrevDayHighLow(candles, series, color = 'gray') {
  const oneDayCandles = groupCandlesByDay(candles);
  if (oneDayCandles.length < 2) return;

  const prevDay = oneDayCandles.at(-2); // previous trading day
  const high = Math.max(...prevDay.map(c => c.high));
  const low  = Math.min(...prevDay.map(c => c.low));

  series.createPriceLine({ price: high, color, lineStyle: 2, lineWidth: 2});
  series.createPriceLine({ price: low,  color, lineStyle: 2, lineWidth: 2 });
}




function groupCandlesByDay(candles) {
  const grouped = {};
  candles.forEach(c => {
    // Convert UTC to IST
    const ist = new Date((c.time + 19800) * 1000);
    const date = ist.toISOString().slice(0, 10); // YYYY-MM-DD
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push(c);
  });
  return Object.values(grouped);
}


function calculateATMStrike(openPrice) {
  const interval = 50;
  return Math.round(openPrice / interval) * interval;
}

socket.onmessage = async function (event) {
  try {
    const msg = JSON.parse(event.data);

    if (msg.type === "tick") {
    const ltp   = parseFloat(msg.ltp);
    const open  = parseFloat(msg.open);
    

    // ✅ Send NIFTY LTP to the chart tab if open




    if (open !== lastOpenPlotted && open > 0) {
      lastOpenPlotted = open;

      const openUpper = +(open * (1 + 0.001306)).toFixed(2);
      const openLower = +(open * (1 - 0.001306)).toFixed(2);

      openUpperLine?.remove?.();
      openLowerLine?.remove?.();

      openUpperLine = candleSeries.createPriceLine({
        price: openUpper,
        color: "purple",
        lineWidth: 1,
        lineStyle: 2,
        title: "Open +0.13%"
      });

      openLowerLine = candleSeries.createPriceLine({
        price: openLower,
        color: "purple",
        lineWidth: 1,
        lineStyle: 2,
        title: "Open -0.13%"
      });

      console.log(`📌 Open Projection Lines Plotted: ₹${openUpper} / ₹${openLower}`);
    }

    const high  = parseFloat(msg.high);
    const low   = parseFloat(msg.low);
    const close = parseFloat(msg.close);

    // 🔼 Update label and chart immediately
    const diff = ltp - close;
    priceLabel.className = diff > 0 ? "green" : diff < 0 ? "red" : "gray";
    priceLabel.innerText = `LTP: ₹${ltp.toFixed(2)} (${diff >= 0 ? "+" : ""}${diff.toFixed(2)}) | O: ₹${open.toFixed(2)} H: ₹${high.toFixed(2)} L: ₹${low.toFixed(2)} C: ₹${close.toFixed(2)}`;

    // === Bullish / Bearish Calculation ===
    if (!bullBearLinesDrawn && oneDayCandles.length >= 2 && open > 0) {
        const prevDay = oneDayCandles.at(-2);  // Previous trading day
        const prevDayHigh = Math.max(...prevDay.map(c => c.high));
        const prevDayLow  = Math.min(...prevDay.map(c => c.low));

        const step1 = (prevDayHigh - prevDayLow) * 0.2611;
        const bullishAbove = open + step1;
        const bearishBelow = open - step1;

        candleSeries.createPriceLine({
            price: bullishAbove,
            color: 'green',
            lineWidth: 2,
            title: `Bullish Above ₹${bullishAbove.toFixed(2)}`
        });

        candleSeries.createPriceLine({
            price: bearishBelow,
            color: 'red',
            lineWidth: 2,
            title: `Bearish Below ₹${bearishBelow.toFixed(2)}`
        });

        console.log(`✅ Bullish Above: ₹${bullishAbove.toFixed(2)}, Bearish Below: ₹${bearishBelow.toFixed(2)}`);
        bullBearLinesDrawn = true;
    }





    drawLiveHighLow(high, low);
    updateLiveCandle(ltp);

    // 🔁 Continue to ATM logic
    const atmStrike = calculateATMStrike(open);
    const atmChanged = atmStrike !== lastATM;
    if (!atmChanged) return;
    lastATM = atmStrike;
    


    // 🔲 Open popup windows for CALL and PUT


    if (!window.tabbedChartTab || window.tabbedChartTab.closed) {
      window.tabbedChartTab = window.open(`/static/option_chart_tabs.html?strike=${atmStrike}`, "_blank");
    }
    if (!window.positionsTab || window.positionsTab.closed) {
      window.positionsTab = window.open("/static/positions.html", "_blank");
    }


    const expiry = "24 JUL";
    const callSymbol = `NIFTY ${expiry} ${atmStrike} CALL`;
    
    const putSymbol  = `NIFTY ${expiry} ${atmStrike} PUT`;
    const callITMSymbol = `NIFTY ${expiry} ${atmStrike - 100} CALL`;
    const putITMSymbol  = `NIFTY ${expiry} ${atmStrike + 100} PUT`;


    const getId = async (symbol) => {
      const res = await fetch(`/get-security-id?symbol=${encodeURIComponent(symbol)}`);
      const json = await res.json();
      return json.security_id || null;
    };

    const fetchById = async (symbol) => {
      const res = await fetch(`/option_history_live?symbol=${encodeURIComponent(symbol)}`);

      return res.ok ? res.json() : [];
    };

    fetch(`/option_history_live?symbol=${encodeURIComponent(callITMSymbol)}`)
    .then(res => res.json())
    .then(data => {
      itmCallCandles = data.map(d => ({ time: +d.time, ...d }));
      console.log("✅ itmCallCandles loaded:", itmCallCandles.length);

    });

  fetch(`/option_history_live?symbol=${encodeURIComponent(putITMSymbol)}`)
    .then(res => res.json())
    .then(data => {
      itmPutCandles = data.map(d => ({ time: +d.time, ...d }));
      console.log("✅ itmPutCandles loaded:", itmPutCandles.length);

    });

    const callId = await getId(callSymbol);
    const putId  = await getId(putSymbol);
    
    const callITMId = await getId(callITMSymbol);
    const putITMId  = await getId(putITMSymbol);

    








    socket.send(JSON.stringify({
      type: "subscribe_options",
      callId,
      putId,
      callITMId,
      putITMId
    }));

    fetch(`/option_history_live?symbol=${encodeURIComponent(callSymbol)}`)

      .then(res => res.json())
      .then(data => {
        const parsed = data.map(d => ({ time: +d.time, open: d.open, high: d.high, low: d.low, close: d.close }));
        callSeries.setData(parsed);
        callCandles = parsed;
        atmCallCandles = parsed;

        drawPrevDayHighLow(callCandles, callSeries, '#aaa'); // ✅
        callChart.timeScale().fitContent(); // ⬅️ ADD THIS

        updateLiveOptionCandle(callSeries, callCandles, parsed.at(-1)?.close || 0, callLabel, "CALL");
        setTimeout(() => {
        call5mLines.atm.high?.remove?.();
        call5mLines.atm.low?.remove?.();
        call5mLines.atm.avg?.remove?.();

        draw5mLines(atmStrike, "CALL", callSeries, "atm");
      }, 200);




      });

    fetch(`/option_history_live?symbol=${encodeURIComponent(putSymbol)}`)

      .then(res => res.json())
      .then(data => {
        const parsed = data.map(d => ({ time: +d.time, open: d.open, high: d.high, low: d.low, close: d.close }));
        putSeries.setData(parsed);
        putCandles = parsed;
        atmPutCandles = parsed;

        drawPrevDayHighLow(putCandles, putSeries, '#aaa');
        putChart.timeScale().fitContent(); // ⬅️ ADD THIS

        updateLiveOptionCandle(putSeries, putCandles, parsed.at(-1)?.close || 0, putLabel, "PUT");
        setTimeout(() => {
        put5mLines.atm.high?.remove?.();
        put5mLines.atm.low?.remove?.();
        put5mLines.atm.avg?.remove?.();

        draw5mLines(atmStrike, "PUT", putSeries, "atm");
      }, 200);





      });



      const strikeList = [];
      for (let i = -300; i <= 300; i += 50) strikeList.push(atmStrike + i);

      console.log("⏳ Fetching historical data for all 26 options...");
      await Promise.all(strikeList.flatMap(strike => {
        return ["CALL", "PUT"].map(async (type) => {
          const symbol = `NIFTY ${expiry} ${strike} ${type}`;
          const id = await getId(symbol);
          if (id) {
            const data = await fetchById(id);
            console.log(`✅ ${symbol} (${id}) → ${data.length} candles`);
          } else {
            console.warn(`❌ No ID for ${symbol}`);
          }
        });
      }));

      // const diff = ltp - close;
      priceLabel.className = diff > 0 ? "green" : diff < 0 ? "red" : "gray";
      priceLabel.innerText = `LTP: ₹${ltp.toFixed(2)} (${diff >= 0 ? "+" : ""}${diff.toFixed(2)}) | O: ₹${open.toFixed(2)} H: ₹${high.toFixed(2)} L: ₹${low.toFixed(2)} C: ₹${close.toFixed(2)} | ATM: ${atmStrike}`;
      drawLiveHighLow(high, low);
      updateLiveCandle(ltp);
    }

    else if (msg.type === "call_tick") {
      const { ltp, open, high, low, close } = msg;
      const diff = ltp - close;

      callLabel.classList.remove("green", "red", "gray");
      callLabel.classList.add(diff > 0 ? "green" : diff < 0 ? "red" : "gray");

      const strike = showingITMCall ? lastATM - 100 : lastATM;
      const tag = showingITMCall ? "ITM" : "ATM";
      const labelText = `CALL ₹${strike} (${tag}): LTP: ₹${ltp.toFixed(2)} | O: ₹${open.toFixed(2)} H: ₹${high.toFixed(2)} L: ₹${low.toFixed(2)} C: ₹${close.toFixed(2)}`;
      callLabel.innerText = labelText;



      const candles = showingITMCall ? itmCallCandles : atmCallCandles;
      drawCallHighLow(high, low);
      updateLiveOptionCandle(callSeries, candles, ltp);
    }






    else if (msg.type === "put_tick") {
      const { ltp, open, high, low, close } = msg;
      const diff = ltp - close;

      putLabel.classList.remove("green", "red", "gray");
      putLabel.classList.add(diff > 0 ? "green" : diff < 0 ? "red" : "gray");

      const strike = showingITMPut ? lastATM + 100 : lastATM;
      const tag = showingITMPut ? "ITM" : "ATM";
      const labelText = `PUT ₹${strike} (${tag}): LTP: ₹${ltp.toFixed(2)} | O: ₹${open.toFixed(2)} H: ₹${high.toFixed(2)} L: ₹${low.toFixed(2)} C: ₹${close.toFixed(2)}`;
      putLabel.innerText = labelText;



      const candles = showingITMPut ? itmPutCandles : atmPutCandles;
      drawPutHighLow(high, low);
      updateLiveOptionCandle(putSeries, candles, ltp);
    }




  } catch (e) {
    console.error("❌ Tick parse error:", e);
  }
};


function updateLiveOptionCandle(series, dataArray, ltp) {
  const now = Math.floor(Date.now() / 1000);
  const minute = Math.floor(now / 60) * 60;

  let last = dataArray.at(-1);
  if (!last || last.time !== minute) {
    last = { time: minute, open: ltp, high: ltp, low: ltp, close: ltp };
    dataArray.push(last);
  } else {
    last.high = Math.max(last.high, ltp);
    last.low = Math.min(last.low, ltp);
    last.close = ltp;
  }

  const updated = aggregateCandles(dataArray.slice(-100), currentTimeframe).at(-1);
  if (updated) {
    series.update(updated);
  }
}


tfButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const tf = parseInt(btn.dataset.tf);
    applyTimeframe(tf);
  });
});

// === Double-click full-window support for main, call, put ===
let expandedBox = null;

function enableDoubleClickFullscreen(chartCanvasEl, chartObj) {
  const box = chartCanvasEl.closest(".chart-box");
  const surface = chartCanvasEl;

  box.addEventListener("dblclick", () => {
    const allBoxes = document.querySelectorAll(".chart-box");
    const grid = document.getElementById("chartGrid");

    if (expandedBox === box) {
      // ━━━━━━━ COLLAPSE ━━━━━━━
      document.body.classList.remove("fullscreen-mode");
      box.classList.remove("fullscreen-chart");

      allBoxes.forEach(b => {
        b.classList.remove("hidden-chart");

        // 🧠 Restore original size
        const boxW = b.dataset.origBoxW;
        const boxH = b.dataset.origBoxH;
        const surfW = b.dataset.origSurfW;
        const surfH = b.dataset.origSurfH;

        if (boxW && boxH) {
          b.style.width = boxW;
          b.style.height = boxH;
        } else {
          b.style.removeProperty("width");
          b.style.removeProperty("height");
        }

        const s = b.querySelector(".chart-surface") || b;
        if (surfW && surfH) {
          s.style.width = surfW;
          s.style.height = surfH;
        } else {
          s.style.removeProperty("width");
          s.style.removeProperty("height");
        }

        b.style.removeProperty("position");
        b.style.removeProperty("top");
        b.style.removeProperty("left");
        b.style.removeProperty("z-index");

        void b.offsetHeight;

        const w = s.clientWidth;
        const h = s.clientHeight;
        b._chart?.resize(w, h);
        b._chart?.timeScale()?.scrollToPosition(0, false);
      });

      // 🔁 Force grid layout to reflow properly
      grid.style.display = "none";
      void grid.offsetHeight;
      grid.style.display = "grid";

      expandedBox = null;
    } else {
      // ━━━━━━━ EXPAND ━━━━━━━
      document.body.classList.add("fullscreen-mode");

      allBoxes.forEach(b => {
        if (b !== box) b.classList.add("hidden-chart");

        // 🧠 Store original size before fullscreen
        const boxRect = b.getBoundingClientRect();
        const surf = b.querySelector(".chart-surface") || b;
        const surfRect = surf.getBoundingClientRect();

        b.dataset.origBoxW = `${boxRect.width}px`;
        b.dataset.origBoxH = `${boxRect.height}px`;
        b.dataset.origSurfW = `${surfRect.width}px`;
        b.dataset.origSurfH = `${surfRect.height}px`;
      });

      box.classList.add("fullscreen-chart");
      Object.assign(box.style, {
        position: "fixed",
        inset: "0",
        width: "100vw",
        height: "100vh",
        zIndex: "9999"
      });

      surface.style.width = "100%";
      surface.style.height = "calc(100% - 30px)";

      chartObj.resize(window.innerWidth, window.innerHeight - 30);
      chartObj.timeScale().scrollToPosition(0, false);

      expandedBox = box;
    }
  });

  box._chart = chartObj;
}

document.querySelectorAll('.chart-tf button').forEach(btn => {
  btn.addEventListener('click', () => {
    const tf = parseInt(btn.dataset.tf, 10);
    const target = btn.dataset.target; // 'call' or 'put'

    // Visual highlight
    document.querySelectorAll(`.chart-tf button[data-target="${target}"]`)
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (target === "call" && callCandles && callSeries) {
      const aggregated = aggregateCandles(callCandles, tf);
      callSeries.setData(aggregated);

      callPrevLines.forEach(l => l.remove?.());
      callPrevLines = drawPrevDayHighLow(callCandles, callChart, '#aaa');
    } else if (target === "put" && putCandles && putSeries) {
      const aggregated = aggregateCandles(putCandles, tf);
      putSeries.setData(aggregated);
     
      putPrevLines.forEach(l => l.remove?.());
      putPrevLines = drawPrevDayHighLow(putCandles, putChart, '#aaa');
    }

  });
});

// ⎋ ESC to collapse
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && expandedBox) {
    expandedBox.dispatchEvent(new Event("dblclick"));
  }
});

// Attach to all three charts
enableDoubleClickFullscreen(document.getElementById("niftyChart"), chart);
enableDoubleClickFullscreen(document.getElementById("callChart"), callChart);
enableDoubleClickFullscreen(document.getElementById("putChart"), putChart);

document.addEventListener("DOMContentLoaded", () => {
  const callLabel = document.getElementById("callLabel");
  const putLabel = document.getElementById("putLabel");

  callLabel.addEventListener("click", () => {
    showingITMCall = !showingITMCall;
    const modeNow = showingITMCall ? "itm" : "atm";
    const modeOld = showingITMCall ? "atm" : "itm";
    const candles = showingITMCall ? itmCallCandles : atmCallCandles;
    const strike = showingITMCall ? lastATM - 100 : lastATM;

    console.log("🔁 Toggled CALL chart:", modeNow.toUpperCase(), "Candles:", candles?.length);

    callSeries.setData(aggregateCandles(candles, currentTimeframe));
    drawPrevDayHighLow(candles, callSeries, '#aaa');

    // 🧹 Hide previous mode's lines
    call5mLines[modeOld].high?.remove?.();
    call5mLines[modeOld].low?.remove?.();
    call5mLines[modeOld].avg?.remove?.();

    draw5mLines(strike, "CALL", callSeries, modeNow);

    // ✅ Update label
    const last = candles.at(-1);
    if (last) {
      const { open, high, low, close } = last;
      const ltp = close;
      const diff = ltp - close;
      callLabel.classList.remove("green", "red", "gray");
      callLabel.classList.add(diff > 0 ? "green" : diff < 0 ? "red" : "gray");
      callLabel.innerText = `CALL ₹${strike} (${modeNow.toUpperCase()}): LTP: ₹${ltp.toFixed(2)} | O: ₹${open.toFixed(2)} H: ₹${high.toFixed(2)} L: ₹${low.toFixed(2)} C: ₹${close.toFixed(2)}`;
    }
  });


  putLabel.addEventListener("click", () => {
    showingITMPut = !showingITMPut;
    const modeNow = showingITMPut ? "itm" : "atm";
    const modeOld = showingITMPut ? "atm" : "itm";
    const candles = showingITMPut ? itmPutCandles : atmPutCandles;
    const strike = showingITMPut ? lastATM + 100 : lastATM;

    console.log("🔁 Toggled PUT chart:", modeNow.toUpperCase(), "Candles:", candles?.length);

    putSeries.setData(aggregateCandles(candles, currentTimeframe));
    drawPrevDayHighLow(candles, putSeries, '#aaa');

    // 🧹 Hide previous mode's lines
    put5mLines[modeOld].high?.remove?.();
    put5mLines[modeOld].low?.remove?.();
    put5mLines[modeOld].avg?.remove?.();

    draw5mLines(strike, "PUT", putSeries, modeNow);

    // ✅ Update label
    const last = candles.at(-1);
    if (last) {
      const { open, high, low, close } = last;
      const ltp = close;
      const diff = ltp - close;
      putLabel.classList.remove("green", "red", "gray");
      putLabel.classList.add(diff > 0 ? "green" : diff < 0 ? "red" : "gray");
      putLabel.innerText = `PUT ₹${strike} (${modeNow.toUpperCase()}): LTP: ₹${ltp.toFixed(2)} | O: ₹${open.toFixed(2)} H: ₹${high.toFixed(2)} L: ₹${low.toFixed(2)} C: ₹${close.toFixed(2)}`;
    }
  });

});
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("openCallPopup")?.addEventListener("click", () => {
    if (latestATMStrike) {
      window.callPopup = window.open(`/static/option_chart.html?strike=${latestATMStrike}&type=CALL`, "_blank", "width=1400,height=900");
    } else {
      alert("⚠️ Waiting for ATM data...");
    }
  });

  document.getElementById("openPutPopup")?.addEventListener("click", () => {
    if (latestATMStrike) {
      window.putPopup = window.open(`/static/option_chart.html?strike=${latestATMStrike}&type=PUT`, "_blank", "width=1400,height=900");
    } else {
      alert("⚠️ Waiting for ATM data...");
    }
  });
});

setInterval(() => {
  if (!currentCandle) return;

  const tfSec = (currentTimeframe || 1) * 60;
  const now = Math.floor(Date.now() / 1000);
  const anchor1m = Math.floor(now / 60) * 60;
  const currentBucket = Math.floor(anchor1m / tfSec) * tfSec;
  const nextCandleTime = currentBucket + tfSec;
  const remaining = nextCandleTime - now;

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');
  countdownLabel.innerText = `Next: ${mm}:${ss}`;

  // Position below price
  const price = currentCandle.close;
  const y = chart.priceScale("right").priceToCoordinate(price);
  if (y !== null) {
    countdownLabel.style.top = `${y + 20}px`;
    countdownLabel.style.left = `10px`; // you can center if needed
    countdownLabel.style.background = remaining < 10 ? "rgba(255,0,0,0.7)" : "rgba(0,0,0,0.6)";
  }
}, 1000);

document.addEventListener("DOMContentLoaded", () => {
  const profileImg = document.getElementById("profileLogo");
  if (profileImg) {
    profileImg.addEventListener("click", () => {
      window.open("/static/profile.html", "_blank");
    });
  } else {
    console.warn("⚠️ profileLogo not found in DOM");
  }
});

