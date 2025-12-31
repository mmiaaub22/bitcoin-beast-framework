const express = require('express');
const router = express.Router();
const bitcoin = require('bitcoinjs-lib');
const axios = require('axios');

const NETWORKS = {
  testnet: bitcoin.networks.testnet,
  mainnet: bitcoin.networks.bitcoin,
};

const MEMPOOL_API = {
  testnet: 'https://mempool.space/testnet/api',
  mainnet: 'https://mempool.space/api',
};

const AXIOS_TIMEOUT = 8000; // ms

// -------------------------------
//  ADD ADDRESS TO MONITOR
// -------------------------------
let monitoredAddresses = [];

router.post('/wallet/add-address', (req, res) => {
  const { address, network = 'testnet' } = req.body;

  if (!address) {
    return res.status(400).json({ error: 'Address required' });
  }

  monitoredAddresses.push({ address, network });
  res.json({
    status: 'ADDED',
    address,
    network,
    monitored_count: monitoredAddresses.length,
  });
});

// -------------------------------
//  GET WALLET BALANCE
// -------------------------------
router.get('/wallet/balance', async (req, res) => {
  try {
    const { address, network = 'testnet' } = req.query;
    if (!address) return res.status(400).json({ error: 'Address required' });

    const api = MEMPOOL_API[network] || MEMPOOL_API.testnet;
    const url = `${api}/address/${encodeURIComponent(address)}`;

    const resp = await axios.get(url, { timeout: AXIOS_TIMEOUT }).catch(err => {
      // propagate helpful error
      throw new Error(err.response?.data?.error || err.message || 'Upstream error');
    });

    const data = resp.data || {};

    const chain = data.chain_stats || {};
    const mempool = data.mempool_stats || {};

    const confirmed = (chain.funded_txo_sum || 0) - (chain.spent_txo_sum || 0);
    const unconfirmed = (mempool.funded_txo_sum || 0) - (mempool.spent_txo_sum || 0);

    res.json({
      address,
      network,
      balance_confirmed_sat: confirmed,
      balance_unconfirmed_sat: unconfirmed,
      balance_confirmed_btc: confirmed / 1e8,
      balance_unconfirmed_btc: unconfirmed / 1e8,
      tx_count: chain.tx_count || 0,
      mempool_txs: mempool.tx_count || 0,
    });

  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

// -------------------------------
//  GET UTXOS FOR ADDRESS
// -------------------------------
router.get('/wallet/utxos', async (req, res) => {
  try {
    const { address, network = 'testnet' } = req.query;

    if (!address) return res.status(400).json({ error: 'Address required' });

    const api = MEMPOOL_API[network] || MEMPOOL_API.testnet;
    const resp = await axios.get(`${api}/address/${encodeURIComponent(address)}/utxo`, { timeout: AXIOS_TIMEOUT });

    const rawUtxos = Array.isArray(resp.data) ? resp.data : [];

    // Normalize and enrich UTXO objects for frontend
    const utxos = rawUtxos.map((u) => {
      const isConfirmed = Boolean(u.status && u.status.confirmed);
      const valueSat = typeof u.value === 'number' ? u.value : Number(u.value || 0);
      return {
        txid: u.txid,
        vout: u.vout,
        value_sat: valueSat,
        value_btc: valueSat / 1e8,
        status: u.status || {},
        confirmations: isConfirmed ? 1 : 0,
        block_height: (u.status && u.status.block_height) || null,
        block_time: (u.status && u.status.block_time) || null,
        is_confirmed: isConfirmed,
        is_pending: !isConfirmed,
        is_spendable: isConfirmed,
        spendable_value: isConfirmed ? valueSat : 0,
        pending_value: !isConfirmed ? valueSat : 0,
        effective_value: Math.max(0, valueSat - 150),
      };
    });

    res.json({
      address,
      network,
      utxos,
      utxo_count: utxos.length,
      total_value_sat: utxos.reduce((s, x) => s + (x.value_sat || 0), 0),
      fetched_at: new Date().toISOString(),
    });

  } catch (e) {
    // If upstream returns 404 for unknown address, pass a graceful message
    if (e.response?.status === 404) {
      return res.status(404).json({ error: 'Address not found or has no UTXOs', utxos: [] });
    }
    res.status(500).json({ error: String(e.message) });
  }
});

// -------------------------------
//  GET MEMPOOL TXS FOR ADDRESS
// -------------------------------
router.get('/wallet/mempool', async (req, res) => {
  try {
    const { address, network = 'testnet' } = req.query;

    if (!address) return res.status(400).json({ error: 'Address required' });

    const api = MEMPOOL_API[network] || MEMPOOL_API.testnet;
    const resp = await axios.get(`${api}/address/${encodeURIComponent(address)}`, { timeout: AXIOS_TIMEOUT });

    const mempoolStats = resp.data?.mempool_stats || {};

    res.json({
      address,
      network,
      mempool_txs: mempoolStats,
    });

  } catch (e) {
    res.status(500).json({ error: String(e.message) });
  }
});

module.exports = router;
