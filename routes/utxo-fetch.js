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

// ========== Get UTXOs for Address ==========
router.get('/utxos', async (req, res) => {
  try {
    const { address, network = 'testnet' } = req.query;

    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address required' });
    }

    if (! MEMPOOL_APIS[network]) {
      return res.status(400).json({ error: 'Invalid network' });
    }

    // Check cache
    const cache_key = `${network}:${address}`;
    if (utxo_cache[cache_key] && Date.now() - utxo_cache[cache_key]. timestamp < CACHE_TTL) {
      return res.json({ 
        utxos: utxo_cache[cache_key].data,
        cached: true,
        cache_age_ms: Date.now() - utxo_cache[cache_key].timestamp,
      });
    }

    const api = MEMPOOL_APIS[network];
    const response = await axios.get(`${api}/address/${address}/utxo`, {
      timeout: 10000,
    });

    // Transform mempool API response
    const utxos = response.data.map((utxo) => ({
      txid: utxo.txid,
      vout: utxo.vout,
      value: utxo.value,
      status: utxo.status,
      confirmations: utxo.status. confirmed ?  1 : 0,
      block_height: utxo. status.block_height || null,
      block_time: utxo.status.block_time || null,
      is_confirmed: utxo.status.confirmed,
      is_pending: ! utxo.status.confirmed,
      is_spendable: utxo.status.confirmed, // Can be spent
    }));

    // Cache result
    utxo_cache[cache_key] = {
      data: utxos,
      timestamp: Date.now(),
    };

    res.json({ 
      address,
      network,
      utxo_count: utxos.length,
      total_value: utxos.reduce((sum, u) => sum + u.value, 0),
      confirmed_count: utxos.filter(u => u.is_confirmed).length,
      pending_count: utxos.filter(u => u.is_pending).length,
      utxos,
      cached: false,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err.response?. status === 404) {
      return res.json({ 
        address:  req.query.address,
        network:  req.query.network || 'testnet',
        error: 'Address not found or has no UTXOs',
        utxo_count: 0,
        utxos: [],
      });
    }
    res.status(500).json({ error: String(err. message) });
  }
});

// ========== Get UTXO Details ==========
router.get('/utxo/:txid/:vout', async (req, res) => {
  try {
    const { txid, vout } = req.params;
    const { network = 'testnet' } = req.query;

    if (! MEMPOOL_APIS[network]) {
      return res.status(400).json({ error: 'Invalid network' });
    }

    const api = MEMPOOL_APIS[network];
    const response = await axios.get(`${api}/tx/${txid}`, {
      timeout: 10000,
    });

    const tx = response.data;
    const output = tx.vout[vout];

    if (!output) {
      return res.status(404).json({ error: `Output ${vout} not found in transaction ${txid}` });
    }

    res.json({
      txid,
      vout:  parseInt(vout),
      value: output.value,
      address: output.scriptpubkey_address,
      scriptpubkey: output.scriptpubkey,
      scriptpubkey_type: output.scriptpubkey_type,
      tx_status: tx.status,
      is_confirmed: tx.status.confirmed,
      block_height: tx.status.block_height,
      block_time: tx.status.block_time,
      is_coinbase: tx.is_coinbase,
      fee: tx.fee,
      vsize: tx.vsize,
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

    res.json({
      address,
      network,
      balance: {
        confirmed: data.chain_stats?. funded_txo_sum - data.chain_stats?.spent_txo_sum || 0,
        unconfirmed: data.mempool_stats?.funded_txo_sum - data.mempool_stats?.spent_txo_sum || 0,
        total:  (data.chain_stats?.funded_txo_sum - data.chain_stats?.spent_txo_sum || 0) +
               (data.mempool_stats?.funded_txo_sum - data.mempool_stats?. spent_txo_sum || 0),
      },
      transaction_count: {
        confirmed: data.chain_stats?.tx_count || 0,
        unconfirmed: data.mempool_stats?.tx_count || 0,
      },
      is_active: data.chain_stats?.tx_count > 0 || data.mempool_stats?. tx_count > 0,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return res. json({
        address: req.query. address,
        balance: { confirmed: 0, unconfirmed: 0, total: 0 },
        is_active: false,
      });
    }
    res.status(500).json({ error: String(err.message) });
  }
});

// ========== Clear Cache Endpoint ==========
router.post('/clear-cache', (req, res) => {
  try {
    const before = Object.keys(utxo_cache).length;
    Object.keys(utxo_cache).forEach(key => delete utxo_cache[key]);
    res.json({
      success: true,
      entries_cleared: before,
      message: 'UTXO cache cleared',
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

module.exports = router;
