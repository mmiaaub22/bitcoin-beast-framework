const express = require('express');
const bitcoin = require('bitcoinjs-lib');
const router = express.Router();

const NETWORKS = {
  testnet:  bitcoin.networks.testnet,
  mainnet: bitcoin.networks.bitcoin,
};

// ========== Create OP_RETURN Transaction ==========
router.post('/create-opreturn-tx', (req, res) => {
  try {
    const { wif, utxo, to_address, opreturn_data, network = 'testnet', fee = 2000 } = req.body;

    // Validation
    if (!wif || ! utxo || !opreturn_data) {
      return res.status(400).json({ 
        error: 'Missing required fields:  wif, utxo, opreturn_data' 
      });
    }

    if (!NETWORKS[network]) {
      return res.status(400).json({ error: 'Invalid network' });
    }

    // Validate OP_RETURN data size (max 80 bytes)
    const data_buffer = Buffer.from(opreturn_data, 'utf-8');
    if (data_buffer.length > 80) {
      return res.status(400).json({ 
        error: `OP_RETURN data too large: ${data_buffer.length} bytes (max 80)` 
      });
    }

    const net = NETWORKS[network];

    // Validate WIF
    let keyPair;
    try {
      keyPair = bitcoin.ECPair.fromWIF(wif, net);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid WIF for network' });
    }

    // Validate address if provided
    if (to_address) {
      try {
        bitcoin.address. toOutputScript(to_address, net);
      } catch (e) {
        return res.status(400).json({ error: 'Invalid recipient address' });
      }
    }

    const psbt = new bitcoin. Psbt({ network:  net });

    // Add input
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(
          to_address || bitcoin.payments.p2wpkh({ pubkey: keyPair.publicKey, network: net }).address,
          net
        ),
        value: utxo. value,
      },
    });

    // Add output to recipient (if provided)
    if (to_address && utxo.value > fee) {
      psbt.addOutput({
        address: to_address,
        value: utxo.value - fee,
      });
    }

    // OP_RETURN output with data
    const dataScript = bitcoin.script.compile([
      bitcoin.opcodes.OP_RETURN,
      data_buffer,
    ]);
    psbt.addOutput({ script: dataScript, value: 0 });

    // Sign
    psbt.signInput(0, keyPair);
    psbt.finalizeAllInputs();
    const tx = psbt.extractTransaction();

    res.json({
      success: true,
      txid: tx.getId(),
      hex: tx.toHex(),
      size: tx.byteLength(),
      vsize: tx.virtualSize(),
      opreturn_data: opreturn_data,
      opreturn_hex: data_buffer.toString('hex'),
      fee: fee,
      network,
      outputs: [
        to_address ? { type: 'payment', address: to_address, value: utxo.value - fee } : null,
        { type: 'OP_RETURN', value:  0, data: opreturn_data, hex: data_buffer.toString('hex') },
      ].filter(Boolean),
      note: 'OP_RETURN outputs are permanently unspendable and appear on-chain forever',
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== OP_RETURN Data Encoder ==========
router.post('/encode-opreturn', (req, res) => {
  try {
    const { data, encoding = 'utf-8' } = req.body;

    if (!data) {
      return res.status(400).json({ error: 'data required' });
    }

    let buffer;
    try {
      buffer = Buffer.from(data, encoding);
    } catch (e) {
      return res.status(400).json({ error: `Invalid encoding: ${encoding}` });
    }

    if (buffer.length > 80) {
      return res.status(400).json({ 
        error: `Data too large: ${buffer.length} bytes (max 80)` 
      });
    }

    res.json({
      data,
      encoding,
      hex: buffer.toString('hex'),
      bytes: buffer.length,
      fits_opreturn: buffer.length <= 80,
      script:  `OP_RETURN ${buffer. toString('hex')}`,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ========== Decode OP_RETURN Transaction ==========
router.post('/decode-opreturn', (req, res) => {
  try {
    const { tx_hex, network = 'testnet' } = req.body;

    if (! tx_hex) {
      return res.status(400).json({ error: 'tx_hex required' });
    }

    const net = NETWORKS[network];
    const tx = bitcoin.Transaction.fromHex(tx_hex);

    const opreturn_outputs = [];

    tx.outs.forEach((out, idx) => {
      try {
        const script = out. script;
        if (script. length > 0 && script[0] === bitcoin.opcodes.OP_RETURN) {
          const data = script.slice(2); // Skip OP_RETURN and length byte
          opreturn_outputs.push({
            index: idx,
            data: data.toString('utf-8'),
            hex: data.toString('hex'),
            bytes: data.length,
          });
        }
      } catch (e) {
        // Not OP_RETURN
      }
    });

    res.json({
      txid: tx.getId(),
      network,
      total_outputs: tx. outs.length,
      opreturn_count: opreturn_outputs.length,
      opreturn_outputs,
      raw_tx_size: tx.byteLength(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Invalid TX hex or format' });
  }
});

module.exports = router;
