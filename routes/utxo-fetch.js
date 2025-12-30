const express = require('express');
const axios = require('axios');
const router = express.Router();

const MEMPOOL_APIS = {
  testnet: 'https://mempool.space/testnet/api',
  mainnet: 'https://mempool.space/api',
};

// Cache to reduce API calls
const utxo_cache = {};
const CACHE_TTL = 30 * 1000; // 30 seconds

// Live exchange rate (auto-fetched or manually set)
let currentUsdRate = null;
let lastRateFetch = null;

// ========== Live USD Rate Fetcher (CoinGecko) ==========
const fetchLiveUsdRate = async () => {
  try {
    const res = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { timeout: 5000 }
    );
    currentUsdRate = res.data.bitcoin.usd;
    lastRateFetch = new Date().toISOString();
    console.log(`[ExchangeRate] Updated BTC/USD: $${currentUsdRate}`);
  } catch (err) {
    console.error('[ExchangeRate] Failed to fetch live BTC/USD:', err.message);
  }
};

// Auto-refresh every 5 minutes
setInterval(fetchLiveUsdRate, 5 * 60 * 1000);
fetchLiveUsdRate(); // Fetch once on startup

// Helper to compute aggregates for a utxo array
function computeAggregates(utxos) {
  const total_value = utxos.reduce((s, u) => s + (u.value_sat || 0), 0);
  const confirmed_value = utxos
    .filter((u) => u.is_confirmed)
    .reduce((s, u) => s + (u.value_sat || 0), 0);
  const pending_value = utxos
    .filter((u) => u.is_pending)
    .reduce((s, u) => s + (u.value_sat || 0), 0);
  const spendable_value = utxos
    .filter((u) => u.is_spendable)
    .reduce((s, u) => s + (u.value_sat || 0), 0);

  return {
    total_value,
    confirmed_value,
    pending_value,
    spendable_value,
    confirmed_count: utxos.filter((u) => u.is_confirmed).length,
    pending_count: utxos.filter((u) => u.is_pending).length,
  };
}

// ========== Get UTXOs for Address ==========
router.get('/utxos', async (req, res) => {
  try {
    const { address, network = 'testnet' } = req.query;
    const onlySpendable =
      req.query.onlySpendable === 'true' || req.query.onlySpendable === true;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address required' });
    }

    if (!MEMPOOL_APIS[network]) {
      return res.status(400).json({ error: 'Invalid network' });
    }

    // Check cache
    const cache_key = `${network}:${address}`;
    if (utxo_cache[cache_key] && Date.now() - utxo_cache[cache_key].timestamp < CACHE_TTL) {
      // Use cached utxos, but apply onlySpendable filter on-the-fly
      let cached_utxos = utxo_cache[cache_key].data;
      if (onlySpendable) cached_utxos = cached_utxos.filter((u) => u.is_spendable);

      const aggr = computeAggregates(cached_utxos);

      return res.json({
        address,
        network,
        utxo_count: cached_utxos.length,
        total_value: aggr.total_value,
        confirmed_value: aggr.confirmed_value,
        pending_value: aggr.pending_value,
        spendable_value: aggr.spendable_value,
        confirmed_count: aggr.confirmed_count,
        pending_count: aggr.pending_count,
        utxos: cached_utxos,
        cached: true,
        cache_age_ms: Date.now() - utxo_cache[cache_key].timestamp,
        fetched_at: new Date().toISOString(),
      });
    }

    const api = MEMPOOL_APIS[network];
    const response = await axios.get(`${api}/address/${address}/utxo`, {
      timeout: 10000,
    });

    // Transform mempool API response
    let utxos = response.data.map((utxo) => {
      const isConfirmed = Boolean(utxo.status && utxo.status.confirmed);
      const valueSat = typeof utxo.value === 'number' ? utxo.value : Number(utxo.value || 0);

      return {
        txid: utxo.txid,
        vout: utxo.vout,
        value_sat: valueSat,
        value_btc: valueSat / 1e8,

        // status info
        status: utxo.status || {},
        confirmations: isConfirmed ? 1 : 0,
        block_height: utxo.status && utxo.status.block_height ? utxo.status.block_height : null,
        block_time: utxo.status && utxo.status.block_time ? utxo.status.block_time : null,

        // clarity flags
        is_confirmed: isConfirmed,
        is_pending: !isConfirmed,

        // spendability
        is_spendable: isConfirmed,
        spendable_value: isConfirmed ? valueSat : 0,
        pending_value: !isConfirmed ? valueSat : 0,

        // fee-adjusted value for attack logic
        effective_value: Math.max(0, valueSat - 150),

        // optional fiat
        ...(currentUsdRate !== null
          ? { fiat_usd: (valueSat / 1e8) * currentUsdRate }
          : {}),
      };
    });

    // Optional: Filter only spendable UTXOs if requested
    if (onlySpendable) {
      utxos = utxos.filter((u) => u.is_spendable);
    }

    // Cache result (store the canonical utxos list for this address+network)
    utxo_cache[cache_key] = {
      data: utxos,
      timestamp: Date.now(),
    };

    const aggr = computeAggregates(utxos);

    res.json({
      address,
      network,
      utxo_count: utxos.length,
      total_value: aggr.total_value,
      confirmed_value: aggr.confirmed_value,
      pending_value: aggr.pending_value,
      spendable_value: aggr.spendable_value,
      confirmed_count: aggr.confirmed_count,
      pending_count: aggr.pending_count,
      utxos,
      cached: false,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.json({
        address: req.query.address,
        network: req.query.network || 'testnet',
        error: 'Address not found or has no UTXOs',
        utxo_count: 0,
        utxos: [],
      });
    }
    res.status(500).json({ error: String(err.message) });
  }
});

// ========== Get UTXO Summary (Lightweight) ==========
router.get('/utxos/summary', (req, res) => {
  try {
    const { address, network = 'testnet' } = req.query;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address required' });
    }

    const cache_key = `${network}:${address}`;

    if (!utxo_cache[cache_key]) {
      return res.status(404).json({ error: 'No cached data available. Call /utxos first.' });
    }

    const utxos = utxo_cache[cache_key].data;
    const aggr = computeAggregates(utxos);

    res.json({
      address,
      network,
      utxo_count: utxos.length,
      confirmed_value: aggr.confirmed_value,
      pending_value: aggr.pending_value,
      spendable_value: aggr.spendable_value,
      total_value: aggr.total_value,
      confirmed_count: aggr.confirmed_count,
      pending_count: aggr.pending_count,
      cached: true,
      cache_age_ms: Date.now() - utxo_cache[cache_key].timestamp,
      ...(currentUsdRate !== null
        ? {
            confirmed_usd: (aggr.confirmed_value / 1e8) * currentUsdRate,
            pending_usd: (aggr.pending_value / 1e8) * currentUsdRate,
            spendable_usd: (aggr.spendable_value / 1e8) * currentUsdRate,
            total_usd: (aggr.total_value / 1e8) * currentUsdRate,
          }
        : {}),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// ========== Get UTXO Details ==========
router.get('/utxo/:txid/:vout', async (req, res) => {
  try {
    const { txid, vout } = req.params;
    const { network = 'testnet' } = req.query;

    if (!MEMPOOL_APIS[network]) {
      return res.status(400).json({ error: 'Invalid network' });
    }

    const api = MEMPOOL_APIS[network];
    const response = await axios.get(`${api}/tx/${txid}`, {
      timeout: 10000,
    });

    const tx = response.data;
    const idx = parseInt(vout, 10);
    const output = tx.vout[idx];

    if (!output) {
      return res.status(404).json({ error: `Output ${vout} not found in transaction ${txid}` });
    }

    const valueSat = typeof output.value === 'number' ? output.value : Number(output.value || 0);

    res.json({
      txid,
      vout: idx,
      value_sat: valueSat,
      value_btc: valueSat / 1e8,
      address: output.scriptpubkey_address || null,
      scriptpubkey: output.scriptpubkey || null,
      scriptpubkey_type: output.scriptpubkey_type || null,
      tx_status: tx.status || {},
      is_confirmed: Boolean(tx.status && tx.status.confirmed),
      block_height: tx.status && tx.status.block_height ? tx.status.block_height : null,
      block_time: tx.status && tx.status.block_time ? tx.status.block_time : null,
      is_coinbase: tx.is_coinbase || false,
      fee: tx.fee || null,
      vsize: tx.vsize || null,
      ...(currentUsdRate !== null
        ? { fiat_usd: (valueSat / 1e8) * currentUsdRate }
        : {}),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// ========== Get Address Balance ==========
router.get('/address-balance', async (req, res) => {
  try {
    const { address, network = 'testnet' } = req.query;

    if (!address) {
      return res.status(400).json({ error: 'address required' });
    }

    if (!MEMPOOL_APIS[network]) {
      return res.status(400).json({ error: 'Invalid network' });
    }

    const api = MEMPOOL_APIS[network];
    const response = await axios.get(`${api}/address/${address}`, {
      timeout: 10000,
    });

    const data = response.data;

    const confirmed =
      (data.chain_stats?.funded_txo_sum || 0) - (data.chain_stats?.spent_txo_sum || 0);
    const unconfirmed =
      (data.mempool_stats?.funded_txo_sum || 0) - (data.mempool_stats?.spent_txo_sum || 0);

    res.json({
      address,
      network,
      balance: {
        confirmed_sat: confirmed,
        confirmed_btc: confirmed / 1e8,
        unconfirmed_sat: unconfirmed,
        unconfirmed_btc: unconfirmed / 1e8,
        total_sat: confirmed + unconfirmed,
        total_btc: (confirmed + unconfirmed) / 1e8,
        ...(currentUsdRate !== null
          ? {
              confirmed_usd: (confirmed / 1e8) * currentUsdRate,
              unconfirmed_usd: (unconfirmed / 1e8) * currentUsdRate,
              total_usd: ((confirmed + unconfirmed) / 1e8) * currentUsdRate,
            }
          : {}),
      },
      transaction_count: {
        confirmed: data.chain_stats?.tx_count || 0,
        unconfirmed: data.mempool_stats?.tx_count || 0,
      },
      is_active: (data.chain_stats?.tx_count || 0) > 0 || (data.mempool_stats?.tx_count || 0) > 0,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.json({
        address: req.query.address,
        balance: { confirmed: 0, unconfirmed: 0, total: 0 },
        is_active: false,
      });
    }
    res.status(500).json({ error: String(err.message) });
  }
});

// ========== Set Exchange Rate (Manual Override) ==========
router.post('/set-exchange-rate', (req, res) => {
  try {
    const { usd_rate } = req.body;

    if (typeof usd_rate !== 'number' || usd_rate <= 0) {
      return res.status(400).json({ error: 'usd_rate must be a positive number' });
    }

    currentUsdRate = usd_rate;
    lastRateFetch = new Date().toISOString();

    res.json({
      success: true,
      message: `Exchange rate manually set to $${usd_rate} per BTC`,
      current_rate: currentUsdRate,
      last_fetch: lastRateFetch,
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// ========== Get Current Exchange Rate ==========
router.get('/exchange-rate', (req, res) => {
  res.json({
    current_rate: currentUsdRate,
    available: currentUsdRate !== null,
    last_fetch: lastRateFetch,
    auto_fetch_interval: '5 minutes',
  });
});

// ========== Cache Stats (debugging) ==========
router.get('/cache-stats', (req, res) => {
  try {
    const keys = Object.keys(utxo_cache);
    if (keys.length === 0) {
      return res.json({ total_entries: 0, cache_keys: [], oldest_timestamp: null, newest_timestamp: null });
    }
    const timestamps = keys.map((k) => utxo_cache[k].timestamp || 0);
    res.json({
      total_entries: keys.length,
      cache_keys: keys,
      oldest_timestamp: Math.min(...timestamps),
      newest_timestamp: Math.max(...timestamps),
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

// ========== Clear Cache Endpoint ==========
router.post('/clear-cache', (req, res) => {
  try {
    const before = Object.keys(utxo_cache).length;
    Object.keys(utxo_cache).forEach((key) => delete utxo_cache[key]);

    res.json({
      success: true,
      entries_cleared: before,
      message: 'UTXO cache cleared',
    });
  } catch (err) {
    res.status(500).json({ error: String(err.message) });
  }
});

module.exports = router;
