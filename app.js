const yen = (n) => n.toLocaleString("ja-JP");
const fmtDate = (iso) =>
  new Date(iso).toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = "none"), 3200);
}

function switchTab(name) {
  document.querySelectorAll("section.tab").forEach((s) => s.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function renderHome() {
  const s = Storage.get();
  document.getElementById("totalAmount").textContent = yen(Storage.unsettledTotal());

  const breakdown = document.getElementById("breakdown");
  const byCard = Storage.unsettledByCard();
  breakdown.innerHTML = "";
  for (const [name, amount] of Object.entries(byCard)) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = `${name}: ¥${yen(amount)}`;
    breakdown.appendChild(chip);
  }

  const txList = document.getElementById("txList");
  const unsettled = Storage.unsettledTransactions();
  if (unsettled.length === 0) {
    txList.innerHTML = '<div class="empty-hint">未精算の利用はありません</div>';
  } else {
    txList.innerHTML = "";
    for (const t of unsettled) {
      txList.appendChild(txRow(t, { removable: true }));
    }
  }

  const btnRefresh = document.getElementById("btnRefresh");
  btnRefresh.disabled = unsettled.length === 0;

  const status = document.getElementById("syncStatus");
  status.textContent = s.meta.lastSyncAt
    ? `最終同期: ${fmtDate(s.meta.lastSyncAt)}`
    : "未同期";
}

function txRow(t, { removable = false } = {}) {
  const row = document.createElement("div");
  row.className = "tx-row";
  row.innerHTML = `
    <div>
      <div>${escapeHtml(t.cardName)}</div>
      <div class="meta">${fmtDate(t.dateISO)} ・ ${escapeHtml(t.subject || "")}</div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <div class="amount">¥${yen(t.amount)}</div>
      ${removable ? `<button class="danger-outline small" data-remove-tx="${t.id}" type="button">削除</button>` : ""}
    </div>
  `;
  if (removable) {
    row.querySelector("[data-remove-tx]").addEventListener("click", () => {
      if (confirm("この取引を削除しますか?")) {
        Storage.removeTransaction(t.id);
        renderAll();
        toast("削除しました");
      }
    });
  }
  return row;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function renderCards() {
  const s = Storage.get();
  const list = document.getElementById("cardList");
  if (s.settings.cards.length === 0) {
    list.innerHTML = '<div class="empty-hint">まだカードが登録されていません</div>';
    return;
  }
  list.innerHTML = "";
  for (const c of s.settings.cards) {
    const item = document.createElement("div");
    item.className = "card-item";
    item.innerHTML = `
      <div class="name">${escapeHtml(c.name)}</div>
      <div class="query">${escapeHtml(c.query)}</div>
      <div class="regex">${escapeHtml(c.amountRegex)}</div>
      <div class="row-actions">
        <button class="secondary small" data-edit="${c.id}" type="button">編集</button>
        <button class="danger-outline small" data-remove="${c.id}">削除</button>
      </div>
    `;
    list.appendChild(item);
  }
  list.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (confirm("このカードの設定を削除しますか?(すでに取り込んだ履歴は残ります)")) {
        Storage.removeCard(btn.dataset.remove);
        renderCards();
      }
    });
  });
  list.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      startEditCard(btn.dataset.edit);
    });
  });
}

let editingCardId = null;

function startEditCard(id) {
  const c = Storage.get().settings.cards.find((c) => c.id === id);
  if (!c) return;
  editingCardId = id;
  document.getElementById("newCardName").value = c.name;
  document.getElementById("newCardQuery").value = c.query;
  document.getElementById("newCardRegex").value = c.amountRegex;
  document.getElementById("btnAddCard").textContent = "変更を保存";
  document.getElementById("btnCancelEdit").style.display = "block";
  document.getElementById("newCardName").scrollIntoView({ behavior: "smooth", block: "center" });
}

function cancelEditCard() {
  editingCardId = null;
  document.getElementById("newCardName").value = "";
  document.getElementById("newCardQuery").value = "";
  document.getElementById("newCardRegex").value = "";
  document.getElementById("testBody").value = "";
  document.getElementById("testResult").textContent = "";
  document.getElementById("btnAddCard").textContent = "カードを追加";
  document.getElementById("btnCancelEdit").style.display = "none";
}

function renderHistory() {
  const s = Storage.get();
  const sList = document.getElementById("settlementList");
  if (s.settlements.length === 0) {
    sList.innerHTML = '<div class="empty-hint">精算履歴はまだありません</div>';
  } else {
    sList.innerHTML = "";
    for (const r of s.settlements) {
      const row = document.createElement("div");
      row.className = "settlement-row";
      row.innerHTML = `
        <div>
          <div>${fmtDate(r.dateISO)}</div>
          <div class="meta">${r.count}件</div>
        </div>
        <div class="amount">¥${yen(r.amount)}</div>
      `;
      sList.appendChild(row);
    }
  }

  const allList = document.getElementById("allTxList");
  const all = [...s.transactions].sort((a, b) => (a.dateISO < b.dateISO ? 1 : -1));
  if (all.length === 0) {
    allList.innerHTML = '<div class="empty-hint">取引ログはまだありません</div>';
  } else {
    allList.innerHTML = "";
    for (const t of all) {
      const row = txRow(t);
      if (t.settled) row.style.opacity = "0.5";
      allList.appendChild(row);
    }
  }
}

function renderDebugSamples(samples) {
  const el = document.getElementById("debugSamples");
  if (!el) return;
  if (!samples || samples.length === 0) {
    el.innerHTML = '<div class="empty-hint">未マッチはありません</div>';
    return;
  }
  el.innerHTML = "";
  for (const s of samples) {
    const box = document.createElement("div");
    box.style.marginBottom = "10px";
    box.innerHTML = `
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:4px;">${escapeHtml(s.cardName)} ・ ${escapeHtml(s.subject || "")}</div>
      <textarea readonly style="min-height:140px;">${escapeHtml(s.bodySample)}</textarea>
    `;
    el.appendChild(box);
  }
}

function renderSettings() {
  const s = Storage.get();
  document.getElementById("clientIdInput").value = s.settings.clientId;
  document.getElementById("searchDaysInput").value = s.settings.searchDays;
  const pill = document.getElementById("signInStatus");
  if (isSignedIn()) {
    pill.textContent = "Google接続中";
    pill.className = "status-pill on";
  } else {
    pill.textContent = "未接続";
    pill.className = "status-pill off";
  }
}

function renderAll() {
  renderHome();
  renderCards();
  renderHistory();
  renderSettings();
}

// --- events ---

document.getElementById("btnRefresh").addEventListener("click", () => {
  const total = Storage.unsettledTotal();
  if (total === 0) return;
  const ok = confirm(
    `¥${yen(total)} を振込口座に振り込み済みですか?\nこの操作で合計が¥0にリセットされます。`
  );
  if (!ok) return;
  Storage.settleAll();
  renderAll();
  toast("精算しました。合計を¥0にリセットしました");
});

document.getElementById("btnManualAdd").addEventListener("click", () => {
  const amountInput = document.getElementById("manualAmount");
  const labelInput = document.getElementById("manualLabel");
  const amount = Number(amountInput.value);
  if (!amount || amount <= 0) {
    toast("金額を正しく入力してください");
    return;
  }
  Storage.addManualTransaction({ label: labelInput.value, amount });
  amountInput.value = "";
  labelInput.value = "";
  renderAll();
  toast(`¥${yen(amount)} を追加しました`);
});

document.getElementById("btnSync").addEventListener("click", async () => {
  const s = Storage.get();
  if (s.settings.cards.length === 0) {
    toast("先に「カード」タブでカードを登録してください");
    return;
  }
  const btn = document.getElementById("btnSync");
  btn.disabled = true;
  const status = document.getElementById("syncStatus");
  const prevStatus = status.textContent;
  try {
    const result = await syncAllCards(
      s.settings.clientId,
      s.settings.cards,
      s.settings.searchDays,
      (msg) => (status.textContent = msg)
    );
    renderAll();
    renderDebugSamples(result.debugSamples);
    const detail = result.perCard
      .map((c) => `${c.name}: ヒット${c.scanned}/追加${c.added}/未マッチ${c.unmatched}`)
      .join(" ・ ");
    if (result.errors.length) {
      toast(`一部エラー: ${result.errors.join(" / ")}`);
    } else {
      toast(`新規 ${result.totalAdded} 件 (${detail})`);
    }
  } catch (e) {
    status.textContent = prevStatus;
    toast("同期に失敗しました: " + e.message);
  } finally {
    btn.disabled = false;
    renderHome();
  }
});

document.getElementById("btnTestRegex").addEventListener("click", () => {
  const body = document.getElementById("testBody").value;
  const regexStr = document.getElementById("newCardRegex").value;
  const resultEl = document.getElementById("testResult");
  if (!body.trim()) {
    resultEl.className = "test-result nomatch";
    resultEl.textContent = "テスト用のメール本文を貼り付けてください";
    return;
  }
  const amount = parseAmountFromText(body, regexStr);
  if (amount === null) {
    resultEl.className = "test-result nomatch";
    resultEl.textContent = "マッチしませんでした。正規表現を見直してください";
  } else {
    resultEl.className = "test-result match";
    resultEl.textContent = `抽出成功: ¥${yen(amount)}`;
  }
});

document.getElementById("btnAddCard").addEventListener("click", () => {
  const name = document.getElementById("newCardName").value.trim();
  const query = document.getElementById("newCardQuery").value.trim();
  const amountRegex = document.getElementById("newCardRegex").value.trim();
  if (!name || !query || !amountRegex) {
    toast("カード名・検索クエリ・正規表現をすべて入力してください");
    return;
  }
  try {
    new RegExp(amountRegex);
  } catch (e) {
    toast("正規表現が不正です: " + e.message);
    return;
  }
  if (editingCardId) {
    Storage.updateCard(editingCardId, { name, query, amountRegex });
    cancelEditCard();
    renderCards();
    toast("カード設定を更新しました");
  } else {
    Storage.addCard({ name, query, amountRegex });
    document.getElementById("newCardName").value = "";
    document.getElementById("newCardQuery").value = "";
    document.getElementById("newCardRegex").value = "";
    document.getElementById("testBody").value = "";
    document.getElementById("testResult").textContent = "";
    renderCards();
    toast("カードを追加しました");
  }
});

document.getElementById("btnCancelEdit").addEventListener("click", cancelEditCard);

document.getElementById("btnSaveClientId").addEventListener("click", () => {
  Storage.setClientId(document.getElementById("clientIdInput").value);
  toast("クライアントIDを保存しました");
});

document.getElementById("btnSaveSearchDays").addEventListener("click", () => {
  Storage.setSearchDays(document.getElementById("searchDaysInput").value);
  toast("検索期間を保存しました");
});

document.getElementById("btnSignIn").addEventListener("click", async () => {
  const clientId = Storage.get().settings.clientId;
  try {
    await ensureToken(clientId);
    renderSettings();
    toast("サインインしました");
  } catch (e) {
    toast("サインインに失敗しました: " + e.message);
  }
});

document.getElementById("btnSignOut").addEventListener("click", () => {
  signOut();
  renderSettings();
  toast("サインアウトしました");
});

document.getElementById("btnResetAll").addEventListener("click", () => {
  if (confirm("すべてのデータ(カード設定・取引履歴・精算履歴)を削除します。よろしいですか?")) {
    localStorage.removeItem("kakeibo.v1");
    location.reload();
  }
});

renderAll();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
